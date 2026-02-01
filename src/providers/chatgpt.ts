import {
  BaseProvider,
  type ChatOptions,
  type ChatResponse,
  type LoginCallback,
  type LoginSession,
  type Message,
} from "../provider"
import type { CredentialStore, OAuthCredentials } from "../credentials"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OAUTH_PORT = 1455

type TokenResponse = {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

type IdTokenClaims = {
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string }
}

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

function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}

function extractAccountId(tokens: TokenResponse): string | undefined {
  for (const token of [tokens.id_token, tokens.access_token]) {
    if (!token) continue
    const claims = parseJwtClaims(token)
    if (!claims) continue
    const id =
      claims.chatgpt_account_id ||
      claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
      claims.organizations?.[0]?.id
    if (id) return id
  }
  return undefined
}

const HTML_SUCCESS = `<!doctype html>
<html><head><title>Success</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec">
<div style="text-align:center"><h1>Authorization Successful</h1><p>You can close this window.</p></div>
<script>setTimeout(()=>window.close(),2000)</script></body></html>`

const HTML_ERROR = (e: string) => `<!doctype html>
<html><head><title>Error</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#131010;color:#f1ecec">
<div style="text-align:center"><h1 style="color:#fc533a">Authorization Failed</h1>
<p style="color:#ff917b;font-family:monospace;padding:1rem;background:#3c140d;border-radius:0.5rem">${e}</p></div></body></html>`

export class ChatGPTProvider extends BaseProvider {
  readonly name = "ChatGPT"
  readonly id = "chatgpt"
  readonly models = ["gpt-5.2", "gpt-5.1-codex", "gpt-5.1-codex-mini", "gpt-5.1-codex-max", "gpt-5.2-codex"]
  readonly defaultModel = "gpt-5.2"

  constructor(store: CredentialStore) {
    super(store)
  }

  async startLogin(_method: "browser" | "headless"): Promise<{ session: LoginSession; complete: LoginCallback }> {
    const pkce = await generatePKCE()
    const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
    const redirectUri = `http://localhost:${OAUTH_PORT}/auth/callback`

    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access",
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      state,
      originator: "subscription-auth",
    })

    const url = `${ISSUER}/oauth/authorize?${params}`
    let resolver: (creds: OAuthCredentials) => void
    let rejecter: (err: Error) => void
    const promise = new Promise<OAuthCredentials>((res, rej) => {
      resolver = res
      rejecter = rej
    })

    const timeout = setTimeout(
      () => {
        server.stop()
        rejecter(new Error("Authorization timeout"))
      },
      5 * 60 * 1000,
    )

    const server = Bun.serve({
      port: OAUTH_PORT,
      fetch: async (req) => {
        const reqUrl = new URL(req.url)
        if (reqUrl.pathname !== "/auth/callback") return new Response("Not found", { status: 404 })

        const error = reqUrl.searchParams.get("error")
        if (error) {
          clearTimeout(timeout)
          server.stop()
          rejecter(new Error(reqUrl.searchParams.get("error_description") || error))
          return new Response(HTML_ERROR(error), { headers: { "Content-Type": "text/html" } })
        }

        const code = reqUrl.searchParams.get("code")
        if (!code || reqUrl.searchParams.get("state") !== state) {
          clearTimeout(timeout)
          server.stop()
          rejecter(new Error("Invalid callback"))
          return new Response(HTML_ERROR("Invalid callback"), { status: 400, headers: { "Content-Type": "text/html" } })
        }

        try {
          const tokens = await this.exchangeCode(code, redirectUri, pkce.verifier)
          const creds: OAuthCredentials = {
            type: "oauth",
            refresh: tokens.refresh_token,
            access: tokens.access_token,
            expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
            accountId: extractAccountId(tokens),
          }
          await this.store.set(this.id, creds)
          clearTimeout(timeout)
          server.stop()
          resolver(creds)
          return new Response(HTML_SUCCESS, { headers: { "Content-Type": "text/html" } })
        } catch (err) {
          clearTimeout(timeout)
          server.stop()
          rejecter(err as Error)
          return new Response(HTML_ERROR(String(err)), { status: 500, headers: { "Content-Type": "text/html" } })
        }
      },
    })

    return {
      session: { url, instructions: "Complete authorization in your browser.", method: "browser" },
      complete: async () => promise,
    }
  }

  private async exchangeCode(code: string, redirectUri: string, verifier: string): Promise<TokenResponse> {
    const res = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }).toString(),
    })
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
    return res.json()
  }

  protected async refreshToken(refreshToken: string): Promise<OAuthCredentials> {
    const res = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
    })
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
    const tokens: TokenResponse = await res.json()
    return {
      type: "oauth",
      refresh: tokens.refresh_token,
      access: tokens.access_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountId: extractAccountId(tokens),
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const creds = await this.getValidCredentials()
    const model = options?.model || this.defaultModel

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.access}`,
      originator: "subscription-auth",
      "User-Agent": "subscription-auth/0.0.1",
    }
    if (creds.accountId) headers["ChatGPT-Account-Id"] = creds.accountId

    const input = messages.map((m) => ({ role: m.role, content: m.content }))

    const res = await fetch(CODEX_API_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        instructions: options?.system || "You are a helpful assistant.",
        input,
        stream: true,
        store: false,
      }),
    })

    if (!res.ok) {
      throw new Error(`ChatGPT API error: ${res.status} ${await res.text()}`)
    }

    let content = ""
    let usage: { input: number; output: number } | undefined
    const onChunk = options?.onChunk

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
        const data = line.slice(6)
        if (data === "[DONE]") break
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === "response.output_text.delta") {
            const delta = parsed.delta || ""
            content += delta
            if (onChunk) onChunk(delta)
          }
          if (parsed.type === "response.completed" && parsed.response?.usage) {
            usage = {
              input: parsed.response.usage.input_tokens,
              output: parsed.response.usage.output_tokens,
            }
          }
        } catch {}
      }
    }

    return { content, model, usage }
  }
}
