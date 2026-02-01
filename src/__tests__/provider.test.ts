import { describe, it, expect, beforeEach } from "bun:test"
import {
  BaseProvider,
  type ChatOptions,
  type ChatResponse,
  type LoginCallback,
  type LoginSession,
  type Message,
} from "../provider"
import {
  MemoryCredentialStore,
  type OAuthCredentials,
} from "../credentials"

class TestProvider extends BaseProvider {
  readonly name = "Test Provider"
  readonly id = "test"
  readonly models = ["test-model-1", "test-model-2"]
  readonly defaultModel = "test-model-1"

  refreshTokenCalled = false
  chatCalled = false
  lastMessages: Message[] = []
  lastOptions?: ChatOptions

  async startLogin(
    _method: "browser" | "headless"
  ): Promise<{ session: LoginSession; complete: LoginCallback }> {
    return {
      session: {
        url: "https://test.example.com/login",
        instructions: "Test login instructions",
        method: "browser",
      },
      complete: async () => {
        const creds: OAuthCredentials = {
          type: "oauth",
          refresh: "test_refresh",
          access: "test_access",
          expires: Date.now() + 3600000,
        }
        await this.store.set(this.id, creds)
        return creds
      },
    }
  }

  protected async refreshToken(_refreshToken: string): Promise<OAuthCredentials> {
    this.refreshTokenCalled = true
    return {
      type: "oauth",
      refresh: "new_refresh_token",
      access: "new_access_token",
      expires: Date.now() + 3600000,
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    this.chatCalled = true
    this.lastMessages = messages
    this.lastOptions = options
    await this.getValidCredentials()
    return {
      content: "Test response",
      model: options?.model || this.defaultModel,
    }
  }
}

describe("BaseProvider", () => {
  let store: MemoryCredentialStore
  let provider: TestProvider

  beforeEach(() => {
    store = new MemoryCredentialStore()
    provider = new TestProvider(store)
  })

  describe("isLoggedIn", () => {
    it("should return false when no credentials", async () => {
      const result = await provider.isLoggedIn()
      expect(result).toBe(false)
    })

    it("should return true when credentials exist", async () => {
      await store.set("test", {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 3600000,
      })
      const result = await provider.isLoggedIn()
      expect(result).toBe(true)
    })
  })

  describe("logout", () => {
    it("should remove credentials", async () => {
      await store.set("test", {
        type: "oauth",
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 3600000,
      })
      expect(await provider.isLoggedIn()).toBe(true)

      await provider.logout()
      expect(await provider.isLoggedIn()).toBe(false)
    })

    it("should not throw when no credentials exist", async () => {
      await expect(provider.logout()).resolves.toBeUndefined()
    })
  })

  describe("getValidCredentials", () => {
    it("should throw when not logged in", async () => {
      await expect(provider.chat([{ role: "user", content: "test" }])).rejects.toThrow(
        "Not logged in to Test Provider"
      )
    })

    it("should return existing credentials when valid", async () => {
      await store.set("test", {
        type: "oauth",
        refresh: "refresh",
        access: "valid_access",
        expires: Date.now() + 3600000,
      })

      await provider.chat([{ role: "user", content: "test" }])
      expect(provider.refreshTokenCalled).toBe(false)
    })

    it("should refresh token when expired", async () => {
      await store.set("test", {
        type: "oauth",
        refresh: "refresh",
        access: "expired_access",
        expires: Date.now() - 1000,
      })

      await provider.chat([{ role: "user", content: "test" }])
      expect(provider.refreshTokenCalled).toBe(true)
    })

    it("should refresh token when access is empty", async () => {
      await store.set("test", {
        type: "oauth",
        refresh: "refresh",
        access: "",
        expires: Date.now() + 3600000,
      })

      await provider.chat([{ role: "user", content: "test" }])
      expect(provider.refreshTokenCalled).toBe(true)
    })

    it("should store refreshed credentials", async () => {
      await store.set("test", {
        type: "oauth",
        refresh: "old_refresh",
        access: "expired_access",
        expires: Date.now() - 1000,
      })

      await provider.chat([{ role: "user", content: "test" }])

      const creds = await store.get("test")
      expect(creds?.access).toBe("new_access_token")
      expect(creds?.refresh).toBe("new_refresh_token")
    })
  })

  describe("startLogin", () => {
    it("should return login session", async () => {
      const { session } = await provider.startLogin("browser")
      expect(session.url).toBe("https://test.example.com/login")
      expect(session.instructions).toBe("Test login instructions")
      expect(session.method).toBe("browser")
    })

    it("should store credentials on complete", async () => {
      const { complete } = await provider.startLogin("browser")
      const creds = await complete()

      expect(creds.type).toBe("oauth")
      expect(creds.access).toBe("test_access")

      const stored = await store.get("test")
      expect(stored).toEqual(creds)
    })
  })

  describe("provider properties", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("Test Provider")
    })

    it("should have correct id", () => {
      expect(provider.id).toBe("test")
    })

    it("should have models list", () => {
      expect(provider.models).toEqual(["test-model-1", "test-model-2"])
    })

    it("should have default model", () => {
      expect(provider.defaultModel).toBe("test-model-1")
    })
  })
})
