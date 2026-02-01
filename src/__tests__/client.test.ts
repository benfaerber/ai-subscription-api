import { describe, it, expect, beforeEach } from "bun:test"
import { SubscriptionClient, getClient } from "../client"
import { MemoryCredentialStore } from "../credentials"

describe("SubscriptionClient", () => {
  let client: SubscriptionClient
  let store: MemoryCredentialStore

  beforeEach(() => {
    store = new MemoryCredentialStore()
    client = new SubscriptionClient({ store })
  })

  describe("constructor", () => {
    it("should use provided store", () => {
      expect(client.store).toBe(store)
    })

    it("should register default providers", () => {
      const providers = client.listProviders()
      const ids = providers.map((p) => p.id)
      expect(ids).toContain("chatgpt")
      expect(ids).toContain("claude")
    })
  })

  describe("registerProvider", () => {
    it("should register a custom provider", () => {
      const mockProvider = {
        id: "custom",
        name: "Custom Provider",
        models: ["model-1"],
        defaultModel: "model-1",
        startLogin: async () => ({
          session: { url: "", instructions: "", method: "browser" as const },
          complete: async () => ({
            type: "oauth" as const,
            refresh: "",
            access: "",
            expires: 0,
          }),
        }),
        chat: async () => ({ content: "", model: "" }),
        isLoggedIn: async () => false,
        logout: async () => {},
      }

      client.registerProvider(mockProvider)
      expect(client.getProvider("custom")).toBe(mockProvider)
    })
  })

  describe("getProvider", () => {
    it("should return registered provider", () => {
      const provider = client.getProvider("chatgpt")
      expect(provider.id).toBe("chatgpt")
      expect(provider.name).toBe("ChatGPT")
    })

    it("should throw for unknown provider", () => {
      expect(() => client.getProvider("unknown")).toThrow(
        "Unknown provider: unknown"
      )
    })
  })

  describe("listProviders", () => {
    it("should return all registered providers", () => {
      const providers = client.listProviders()
      expect(providers.length).toBeGreaterThanOrEqual(2)
    })

    it("should include provider details", () => {
      const providers = client.listProviders()
      const chatgpt = providers.find((p) => p.id === "chatgpt")
      expect(chatgpt).toBeDefined()
      expect(chatgpt?.name).toBe("ChatGPT")
      expect(chatgpt?.models.length).toBeGreaterThan(0)
    })
  })

  describe("isLoggedIn", () => {
    it("should return false when no credentials", async () => {
      const result = await client.isLoggedIn("chatgpt")
      expect(result).toBe(false)
    })

    it("should return true when credentials exist", async () => {
      await store.set("chatgpt", {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 3600000,
      })
      const result = await client.isLoggedIn("chatgpt")
      expect(result).toBe(true)
    })
  })

  describe("logout", () => {
    it("should remove credentials", async () => {
      await store.set("chatgpt", {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 3600000,
      })
      expect(await client.isLoggedIn("chatgpt")).toBe(true)

      await client.logout("chatgpt")
      expect(await client.isLoggedIn("chatgpt")).toBe(false)
    })
  })
})

describe("getClient", () => {
  it("should return a SubscriptionClient instance", () => {
    const client = getClient({ store: new MemoryCredentialStore() })
    expect(client).toBeInstanceOf(SubscriptionClient)
  })

  it("should return the same instance when called without options", () => {
    const memStore = new MemoryCredentialStore()
    const client1 = getClient({ store: memStore })
    const client2 = getClient()
    expect(client2).toBe(client1)
  })

  it("should create new instance when options are provided", () => {
    const store1 = new MemoryCredentialStore()
    const store2 = new MemoryCredentialStore()
    const client1 = getClient({ store: store1 })
    const client2 = getClient({ store: store2 })
    expect(client2.store).toBe(store2)
  })
})
