# AI Subscription API

[![CI](https://github.com/benfaerber/ai-subscription-api/actions/workflows/ci.yml/badge.svg)](https://github.com/benfaerber/ai-subscription-api/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ai-subscription-api)](https://www.npmjs.com/package/ai-subscription-api)

Use your ChatGPT Plus/Pro, Claude Pro/Max, and Gemini subscriptions programmatically. No API keys required.

## Installation

```bash
bun add ai-subscription-api
```

## Requirements

- Bun runtime (Node.js is not supported)

## Quick Start

```typescript
import { SubscriptionClient } from "ai-subscription-api"

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

| Provider | ID        | Subscription      |
| -------- | --------- | ----------------- |
| Claude   | `claude`  | Pro/Max           |
| ChatGPT  | `chatgpt` | Plus/Pro          |
| Gemini   | `gemini`  | Free/Pro          |

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

### ChatGPT

```typescript
const { session, complete } = await client.login("chatgpt", "browser")
Bun.spawn(["open", session.url])
await complete() // Waits for OAuth callback
```

### Gemini

```typescript
const { session, complete } = await client.login("gemini", "browser")
Bun.spawn(["open", session.url])
await complete() // Waits for OAuth callback
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
} from "ai-subscription-api"

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
import type { CredentialStore, Credentials } from "ai-subscription-api"

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
- `claude-opus-4-6`
- `claude-haiku-4-5-20251001`

### ChatGPT

- `gpt-5.2` (default)
- `gpt-5.1-codex`
- `gpt-5.1-codex-mini`
- `gpt-5.1-codex-max`
- `gpt-5.2-codex`
- `gpt-5.3-codex`

### Gemini

- `gemini-3-flash-preview` (default)
- `gemini-3-pro-preview`
- `gemini-2.5-pro`
- `gemini-2.5-flash`
- `gemini-2.0-flash`
- `gemini-2.0-flash-lite`


## Scripts

```bash
# Run tests
bun test

# Run interactive CLI example
bun run example
```

Use `bun run example` to play with the APIs.

## Notes

- Claude OAuth credentials require the `claude-cli` user agent
- ChatGPT Codex API requires `stream: true` and `store: false`
- Credentials are stored in `~/.local/share/subscription-auth/auth.json` by default
- Tokens are automatically refreshed when expired
