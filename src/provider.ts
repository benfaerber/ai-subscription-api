import type { CredentialStore, OAuthCredentials } from "./credentials"

export type Message = {
  role: "user" | "assistant"
  content: string
}

export type ChatOptions = {
  model?: string
  maxTokens?: number
  system?: string
  stream?: boolean
  onChunk?: (chunk: string) => void
}

export type ChatResponse = {
  content: string
  model: string
  usage?: {
    input: number
    output: number
  }
}

export type LoginSession = {
  url: string
  instructions: string
  method: "browser" | "headless" | "code"
}

export type LoginCallback = (code?: string) => Promise<OAuthCredentials>

export interface Provider {
  readonly name: string
  readonly id: string
  readonly models: string[]
  readonly defaultModel: string

  startLogin(method: "browser" | "headless"): Promise<{ session: LoginSession; complete: LoginCallback }>
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>
  isLoggedIn(): Promise<boolean>
  logout(): Promise<void>
}

export abstract class BaseProvider implements Provider {
  abstract readonly name: string
  abstract readonly id: string
  abstract readonly models: string[]
  abstract readonly defaultModel: string

  constructor(protected store: CredentialStore) {}

  abstract startLogin(method: "browser" | "headless"): Promise<{ session: LoginSession; complete: LoginCallback }>
  abstract chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>

  async isLoggedIn(): Promise<boolean> {
    const creds = await this.store.get(this.id)
    return creds !== undefined
  }

  async logout(): Promise<void> {
    await this.store.remove(this.id)
  }

  protected async getCredentials(): Promise<OAuthCredentials | undefined> {
    const creds = await this.store.get(this.id)
    if (!creds || creds.type !== "oauth") return undefined
    return creds
  }

  protected abstract refreshToken(refreshToken: string): Promise<OAuthCredentials>

  protected async getValidCredentials(): Promise<OAuthCredentials> {
    const creds = await this.getCredentials()
    if (!creds) {
      throw new Error(`Not logged in to ${this.name}. Run login first.`)
    }

    if (!creds.access || creds.expires < Date.now()) {
      const newCreds = await this.refreshToken(creds.refresh)
      await this.store.set(this.id, newCreds)
      return newCreds
    }

    return creds
  }
}
