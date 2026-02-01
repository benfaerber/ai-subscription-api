// Credential stores
export {
  type Credentials,
  type OAuthCredentials,
  type CredentialStore,
  FileCredentialStore,
  MemoryCredentialStore,
  StaticCredentialStore,
} from "./credentials"

// Provider interface and types
export {
  type Message,
  type ChatOptions,
  type ChatResponse,
  type LoginSession,
  type LoginCallback,
  type Provider,
  BaseProvider,
} from "./provider"

// Built-in providers
export { ChatGPTProvider } from "./providers/chatgpt"
export { ClaudeProvider } from "./providers/claude"

// Client
export { SubscriptionClient, getClient, type ClientOptions } from "./client"
