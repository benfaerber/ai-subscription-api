import {
  BaseProvider,
  type ChatOptions,
  type ChatResponse,
  type LoginCallback,
  type LoginSession,
  type Message,
} from "../provider"
import type { CredentialStore, OAuthCredentials } from "../credentials"

const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const CLIENT_SECRET = "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"
const REDIRECT_URI = "http://localhost:8085/oauth2callback"
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const OAUTH_PORT = 8085

const CODE_ASSIST_HEADERS = {
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
} as const

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

type GeminiCredentials = OAuthCredentials & {
  email?: string
}

type LoadCodeAssistResponse = {
  cloudaicompanionProject?: string | { id?: string }
  currentTier?: { id?: string }
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>
}

type OnboardResponse = {
  name?: string
  done?: boolean
  response?: { cloudaicompanionProject?: { id?: string } }
}

export class GeminiProvider extends BaseProvider {
  readonly name = "Gemini"
  readonly id = "gemini"
  readonly models = [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ]
  readonly defaultModel = "gemini-2.5-flash"

  private configuredProjectId?: string
  private resolvedProjectId?: string

  constructor(store: CredentialStore, options?: { projectId?: string }) {
    super(store)
    this.configuredProjectId = options?.projectId
  }

  async startLogin(method: "browser" | "headless"): Promise<{ session: LoginSession; complete: LoginCallback }> {
    if (method === "browser") return this.browserLogin()
    throw new Error("Gemini only supports browser-based login")
  }

  private async browserLogin(): Promise<{ session: LoginSession; complete: LoginCallback }> {
    const pkce = await generatePKCE()
    const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.searchParams.set("client_id", CLIENT_ID)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", REDIRECT_URI)
    url.searchParams.set("scope", SCOPES.join(" "))
    url.searchParams.set("code_challenge", pkce.challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("state", state)
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "consent")
    url.hash = "subscription-auth"

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
        if (reqUrl.pathname !== "/oauth2callback") return new Response("Not found", { status: 404 })

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
          const creds = await this.exchangeCode(code, pkce.verifier)
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
      session: { url: url.toString(), instructions: "Complete authorization in your browser.", method: "browser" },
      complete: async () => promise,
    }
  }

  private async exchangeCode(code: string, verifier: string): Promise<GeminiCredentials> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Token exchange failed: ${res.status} ${errorText}`)
    }

    const tokens = (await res.json()) as { access_token: string; expires_in: number; refresh_token: string }

    if (!tokens.refresh_token) {
      throw new Error("Missing refresh token in response")
    }

    const userInfo = await this.fetchUserInfo(tokens.access_token)

    return {
      type: "oauth",
      refresh: tokens.refresh_token,
      access: tokens.access_token,
      expires: Date.now() + tokens.expires_in * 1000,
      email: userInfo?.email,
    }
  }

  private async fetchUserInfo(accessToken: string): Promise<{ email?: string } | undefined> {
    try {
      const res = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (res.ok) {
        return (await res.json()) as { email?: string }
      }
    } catch {}
    return undefined
  }

  protected async refreshToken(refreshToken: string): Promise<OAuthCredentials> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Token refresh failed: ${res.status} ${errorText}`)
    }

    const tokens = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string }

    return {
      type: "oauth",
      refresh: tokens.refresh_token || refreshToken,
      access: tokens.access_token,
      expires: Date.now() + tokens.expires_in * 1000,
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const creds = await this.getValidCredentials()
    const model = options?.model || this.defaultModel

    const projectId = await this.ensureProjectId(creds.access)

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }))

    const streaming = options?.stream ?? false
    const onChunk = options?.onChunk

    const requestBody = {
      project: projectId,
      model,
      request: {
        contents,
        systemInstruction: options?.system ? { parts: [{ text: options.system }] } : undefined,
        generationConfig: {
          maxOutputTokens: options?.maxTokens || 8192,
        },
      },
    }

    const action = streaming ? "streamGenerateContent" : "generateContent"
    const url = `${CODE_ASSIST_ENDPOINT}/v1internal:${action}${streaming ? "?alt=sse" : ""}`

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.access}`,
      ...CODE_ASSIST_HEADERS,
    }
    if (streaming) {
      headers["Accept"] = "text/event-stream"
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    })

    if (!res.ok) {
      throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
    }

    if (!streaming) {
      const data = (await res.json()) as {
        response?: {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
        }
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      }

      const response = data.response ?? data
      const textParts = response.candidates?.[0]?.content?.parts || []
      const content = textParts.map((p) => p.text || "").join("")

      return {
        content,
        model,
        usage: response.usageMetadata
          ? {
              input: response.usageMetadata.promptTokenCount || 0,
              output: response.usageMetadata.candidatesTokenCount || 0,
            }
          : undefined,
      }
    }

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
        if (!line.startsWith("data:")) continue
        const data = line.slice(5).trim()
        if (!data) continue
        try {
          const parsed = JSON.parse(data) as {
            response?: {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
              usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
            }
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
          }
          const response = parsed.response ?? parsed
          const textParts = response.candidates?.[0]?.content?.parts || []
          for (const part of textParts) {
            if (part.text) {
              content += part.text
              if (onChunk) onChunk(part.text)
            }
          }
          if (response.usageMetadata) {
            usage = {
              input: response.usageMetadata.promptTokenCount || 0,
              output: response.usageMetadata.candidatesTokenCount || 0,
            }
          }
        } catch {}
      }
    }

    return { content, model, usage }
  }

  private async ensureProjectId(accessToken: string): Promise<string> {
    if (this.resolvedProjectId) return this.resolvedProjectId
    if (this.configuredProjectId) {
      this.resolvedProjectId = this.configuredProjectId
      return this.configuredProjectId
    }

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...CODE_ASSIST_HEADERS,
    }

    const loadRes = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
      method: "POST",
      headers,
      body: JSON.stringify({ metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" } }),
    })

    if (loadRes.ok) {
      const data = (await loadRes.json()) as LoadCodeAssistResponse
      const projectId = this.extractProjectId(data.cloudaicompanionProject)
      if (projectId) {
        this.resolvedProjectId = projectId
        return projectId
      }

      if (data.currentTier?.id) {
        throw new Error(
          "Gemini requires a Google Cloud project. Set GOOGLE_CLOUD_PROJECT or pass projectId option."
        )
      }

      const tier = data.allowedTiers?.find((t) => t.isDefault) ?? data.allowedTiers?.[0]
      const tierId = tier?.id ?? "free-tier"

      const onboardedId = await this.onboardProject(accessToken, tierId)
      if (onboardedId) {
        this.resolvedProjectId = onboardedId
        return onboardedId
      }
    }

    throw new Error(
      "Failed to get Gemini project. Set GOOGLE_CLOUD_PROJECT or pass projectId option."
    )
  }

  private extractProjectId(value?: string | { id?: string }): string | undefined {
    if (!value) return undefined
    if (typeof value === "string") return value.trim() || undefined
    return value.id?.trim() || undefined
  }

  private async onboardProject(accessToken: string, tierId: string): Promise<string | undefined> {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...CODE_ASSIST_HEADERS,
    }

    const res = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tierId,
        metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
      }),
    })

    if (!res.ok) return undefined

    let data = (await res.json()) as OnboardResponse

    if (!data.done && data.name) {
      for (let i = 0; i < 10; i++) {
        await Bun.sleep(5000)
        const opRes = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal/${data.name}`, {
          headers,
        })
        if (!opRes.ok) return undefined
        data = (await opRes.json()) as OnboardResponse
        if (data.done) break
      }
    }

    return data.response?.cloudaicompanionProject?.id
  }
}
