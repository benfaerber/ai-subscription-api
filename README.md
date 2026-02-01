# AI Subscription API

Use your ChatGPT Plus/Pro and Claude Pro/Max subscriptions programmatically. No API keys required.

## Installation

```bash
bun add @benfaerber/ai-subscription-api
```

## Quick Start

```typescript
import { SubscriptionClient } from "@benfaerber/ai-subscription-api"

const client = new SubscriptionClient()

// Login (opens browser)
const { session, complete } = await client.login("claude", "browser")
console.log(`Open: ${session.url}`)
// For Claude, paste the code from the browser
const code = "..." // from browser
await complete(code)

// Chat
const response = await client.ask("claude", "What is the meaning of life?")
console.log(response)
```

## Providers

| Provider | ID        | Subscription |
| -------- | --------- | ------------ |
| Claude   | `claude`  | Pro/Max      |
| ChatGPT  | `chatgpt` | Plus/Pro     |

## Login Methods

### Claude

```typescript
const { session, complete } = await client.login("claude", "browser")
console.log(session.url) // Open this URL
console.log(session.instructions) // "After authorizing, copy and paste the code shown."
Bun.spawn(["open", session.url])
const code = await getCodeFromUser()
await complete(code)
```

### ChatGPT (Browser)

```typescript
const { session, complete } = await client.login("chatgpt", "browser")
Bun.spawn(["open", session.url])
await complete() // Waits for OAuth callback
```

### ChatGPT (Headless)

```typescript
const { session, complete } = await client.login("chatgpt", "headless")
console.log(session.url) // https://auth.openai.com/codex/device
console.log(session.instructions) // "Enter code: XXXX-XXXX"
await complete() // Polls until authorized
```

## Chat

```typescript
// Simple
const answer = await client.ask("claude", "Hello!")

// With options
const response = await client.chat("claude", [{ role: "user", content: "Hello!" }], {
  model: "claude-sonnet-4-20250514",
  maxTokens: 1024,
  system: "You are a helpful assistant.",
})

console.log(response.content)
console.log(response.usage) // { input: 10, output: 50 }
```

## Streaming

```typescript
await client.chat("claude", messages, {
  stream: true,
  onChunk: (chunk) => process.stdout.write(chunk),
})
```

## Custom Credential Storage

```typescript
import {
  SubscriptionClient,
  MemoryCredentialStore,
  FileCredentialStore,
  StaticCredentialStore,
} from "@benfaerber/ai-subscription-api"

// In-memory (session only)
const client = new SubscriptionClient({
  store: new MemoryCredentialStore(),
})

// Custom file path
const client = new SubscriptionClient({
  store: new FileCredentialStore("/path/to/auth.json"),
})

// Pre-loaded credentials (read-only)
const client = new SubscriptionClient({
  store: new StaticCredentialStore({
    claude: {
      type: "oauth",
      refresh: "...",
      access: "...",
      expires: Date.now() + 3600000,
    },
  }),
})
```

## Custom Credential Store

Implement the `CredentialStore` interface:

```typescript
import type { CredentialStore, Credentials } from "@benfaerber/ai-subscription-api"

class RedisCredentialStore implements CredentialStore {
  async get(provider: string): Promise<Credentials | undefined> { ... }
  async set(provider: string, credentials: Credentials): Promise<void> { ... }
  async remove(provider: string): Promise<void> { ... }
  async all(): Promise<Record<string, Credentials>> { ... }
}

const client = new SubscriptionClient({
  store: new RedisCredentialStore()
})
```

## Available Models

### Claude

- `claude-sonnet-4-5-20250929` (default)
- `claude-opus-4-5-20251101`
- `claude-haiku-4-5-20251001`

### ChatGPT

- `gpt-5.2` (default)
- `gpt-5.1-codex`
- `gpt-5.1-codex-mini`
- `gpt-5.1-codex-max`
- `gpt-5.2-codex`

## Scripts

```bash
# Run tests
bun test

# Run interactive CLI example
bun run example
```

## Notes

- Claude OAuth credentials require the `claude-cli` user agent
- ChatGPT Codex API requires `stream: true` and `store: false`
- Credentials are stored in `~/.local/share/subscription-auth/auth.json` by default
- Tokens are automatically refreshed when expired
