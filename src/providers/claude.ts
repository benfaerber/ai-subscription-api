import {
  BaseProvider,
  type ChatOptions,
  type ChatResponse,
  type LoginCallback,
  type LoginSession,
  type Message,
} from "../provider"
import type { CredentialStore, OAuthCredentials } from "../credentials"

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const TOKEN_ENDPOINT = "https://console.anthropic.com/v1/oauth/token"
const API_ENDPOINT = "https://api.anthropic.com/v1/messages"

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function generatePKCE() {
  const verifier = generateRandomString(43)
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return { verifier, challenge: base64UrlEncode(hash) }
}

export class ClaudeProvider extends BaseProvider {
  readonly name = "Claude"
  readonly id = "claude"
  readonly models = ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-sonnet-20241022"]
  readonly defaultModel = "claude-sonnet-4-20250514"

  constructor(store: CredentialStore) {
    super(store)
  }

  async startLogin(_method: "browser" | "headless"): Promise<{ session: LoginSession; complete: LoginCallback }> {
    // Claude only supports code-based login (copy/paste from browser)
    const pkce = await generatePKCE()

    const url = new URL("https://claude.ai/oauth/authorize")
    url.searchParams.set("code", "true")
    url.searchParams.set("client_id", CLIENT_ID)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", "https://console.anthropic.com/oauth/code/callback")
    url.searchParams.set("scope", "org:create_api_key user:profile user:inference")
    url.searchParams.set("code_challenge", pkce.challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("state", pkce.verifier)

    return {
      session: {
        url: url.toString(),
        instructions: "After authorizing, copy and paste the code shown.",
        method: "code",
      },
      complete: async (code?: string) => {
        if (!code) throw new Error("Authorization code required")

        const splits = code.split("#")
        const res = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: splits[0],
            state: splits[1],
            grant_type: "authorization_code",
            client_id: CLIENT_ID,
            redirect_uri: "https://console.anthropic.com/oauth/code/callback",
            code_verifier: pkce.verifier,
          }),
        })

        if (!res.ok) {
          throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
        }

        const json = (await res.json()) as { refresh_token: string; access_token: string; expires_in: number }
        const creds: OAuthCredentials = {
          type: "oauth",
          refresh: json.refresh_token,
          access: json.access_token,
          expires: Date.now() + json.expires_in * 1000,
        }
        await this.store.set(this.id, creds)
        return creds
      },
    }
  }

  protected async refreshToken(refreshToken: string): Promise<OAuthCredentials> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    })
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
    const json = (await res.json()) as { refresh_token: string; access_token: string; expires_in: number }
    return {
      type: "oauth",
      refresh: json.refresh_token,
      access: json.access_token,
      expires: Date.now() + json.expires_in * 1000,
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const creds = await this.getValidCredentials()
    const model = options?.model || this.defaultModel

    const headers = new Headers()
    headers.set("content-type", "application/json")
    headers.set("authorization", `Bearer ${creds.access}`)
    headers.set("anthropic-version", "2023-06-01")
    headers.set("anthropic-beta", "oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14")
    headers.set("user-agent", "claude-cli/2.1.2 (external, cli)")

    const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }))

    const streaming = options?.stream ?? false
    const onChunk = options?.onChunk

    const res = await fetch(`${API_ENDPOINT}?beta=true`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: options?.maxTokens || 4096,
        system: options?.system || "You are Claude Code, Anthropic's official CLI for Claude.",
        messages: apiMessages,
        stream: streaming,
      }),
    })

    if (!res.ok) {
      throw new Error(`Claude API error: ${res.status} ${await res.text()}`)
    }

    if (!streaming) {
      const data = (await res.json()) as {
        content: Array<{ type: string; text?: string }>
        usage?: { input_tokens: number; output_tokens: number }
      }
      const textContent = data.content.find((c) => c.type === "text")
      return {
        content: textContent?.text || JSON.stringify(data),
        model,
        usage: data.usage ? { input: data.usage.input_tokens, output: data.usage.output_tokens } : undefined,
      }
    }

    // Handle streaming response
    let content = ""
    let usage: { input: number; output: number } | undefined

    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body")

    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (!data) continue
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
            const delta = parsed.delta.text || ""
            content += delta
            if (onChunk) onChunk(delta)
          }
          if (parsed.type === "message_delta" && parsed.usage) {
            usage = {
              input: parsed.usage.input_tokens || 0,
              output: parsed.usage.output_tokens || 0,
            }
          }
          if (parsed.type === "message_start" && parsed.message?.usage) {
            usage = {
              input: parsed.message.usage.input_tokens || 0,
              output: 0,
            }
          }
        } catch {}
      }
    }

    return { content, model, usage }
  }
}
