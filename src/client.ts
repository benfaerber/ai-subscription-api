import { FileCredentialStore, type CredentialStore } from "./credentials"
import type { ChatOptions, ChatResponse, Message, Provider } from "./provider"
import { ChatGPTProvider } from "./providers/chatgpt"
import { ClaudeProvider } from "./providers/claude"
import { GeminiProvider } from "./providers/gemini"

export type ClientOptions = {
  store?: CredentialStore
}

export class SubscriptionClient {
  readonly store: CredentialStore
  readonly providers: Map<string, Provider> = new Map()

  constructor(options: ClientOptions = {}) {
    this.store = options.store || new FileCredentialStore()
    this.registerProvider(new ChatGPTProvider(this.store))
    this.registerProvider(new ClaudeProvider(this.store))
    this.registerProvider(new GeminiProvider(this.store))
  }

  registerProvider(provider: Provider) {
    this.providers.set(provider.id, provider)
  }

  getProvider(id: string): Provider {
    const provider = this.providers.get(id)
    if (!provider) throw new Error(`Unknown provider: ${id}`)
    return provider
  }

  listProviders(): Provider[] {
    return Array.from(this.providers.values())
  }

  async login(providerId: string, method: "browser" | "headless" = "browser") {
    const provider = this.getProvider(providerId)
    return provider.startLogin(method)
  }

  async chat(providerId: string, messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const provider = this.getProvider(providerId)
    return provider.chat(messages, options)
  }

  async isLoggedIn(providerId: string): Promise<boolean> {
    const provider = this.getProvider(providerId)
    return provider.isLoggedIn()
  }

  async logout(providerId: string): Promise<void> {
    const provider = this.getProvider(providerId)
    return provider.logout()
  }

  // Convenience method for simple single-message chat
  async ask(providerId: string, message: string, options?: ChatOptions): Promise<string> {
    const response = await this.chat(providerId, [{ role: "user", content: message }], options)
    return response.content
  }
}

// Default singleton instance
let defaultClient: SubscriptionClient | undefined

export function getClient(options?: ClientOptions): SubscriptionClient {
  if (!defaultClient || options) {
    defaultClient = new SubscriptionClient(options)
  }
  return defaultClient
}
