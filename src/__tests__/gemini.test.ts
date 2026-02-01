import { describe, it, expect, beforeEach } from "bun:test"
import { GeminiProvider } from "../providers/gemini"
import { MemoryCredentialStore } from "../credentials"

describe("GeminiProvider", () => {
  let store: MemoryCredentialStore
  let provider: GeminiProvider

  beforeEach(() => {
    store = new MemoryCredentialStore()
    provider = new GeminiProvider(store)
  })

  describe("provider properties", () => {
    it("should have correct name", () => {
      expect(provider.name).toBe("Gemini")
    })

    it("should have correct id", () => {
      expect(provider.id).toBe("gemini")
    })

    it("should have models list", () => {
      expect(provider.models).toContain("gemini-3.0-flash-preview")
      expect(provider.models).toContain("gemini-3.0-pro-preview")
      expect(provider.models).toContain("gemini-2.5-pro")
      expect(provider.models).toContain("gemini-2.5-flash")
      expect(provider.models).toContain("gemini-2.0-flash")
    })

    it("should have default model", () => {
      expect(provider.defaultModel).toBe("gemini-3.0-flash-preview")
    })
  })

  describe("isLoggedIn", () => {
    it("should return false when no credentials", async () => {
      const result = await provider.isLoggedIn()
      expect(result).toBe(false)
    })

    it("should return true when credentials exist", async () => {
      await store.set("gemini", {
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
      await store.set("gemini", {
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

  describe("startLogin", () => {
    it("should only support browser method", async () => {
      await expect(provider.startLogin("headless")).rejects.toThrow(
        "Gemini only supports browser-based login"
      )
    })
  })

  describe("chat", () => {
    it("should throw when not logged in", async () => {
      await expect(
        provider.chat([{ role: "user", content: "test" }])
      ).rejects.toThrow("Not logged in to Gemini")
    })
  })

  describe("with projectId option", () => {
    it("should accept projectId in constructor", () => {
      const providerWithProject = new GeminiProvider(store, { projectId: "test-project-123" })
      expect(providerWithProject).toBeDefined()
    })
  })
})
