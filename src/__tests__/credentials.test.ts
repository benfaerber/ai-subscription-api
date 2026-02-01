import { describe, it, expect, beforeEach } from "bun:test"
import {
  MemoryCredentialStore,
  StaticCredentialStore,
  type OAuthCredentials,
} from "../credentials"

const mockCredentials: OAuthCredentials = {
  type: "oauth",
  refresh: "refresh_token_123",
  access: "access_token_456",
  expires: Date.now() + 3600000,
  accountId: "account_789",
}

describe("MemoryCredentialStore", () => {
  let store: MemoryCredentialStore

  beforeEach(() => {
    store = new MemoryCredentialStore()
  })

  it("should return undefined for non-existent provider", async () => {
    const result = await store.get("nonexistent")
    expect(result).toBeUndefined()
  })

  it("should store and retrieve credentials", async () => {
    await store.set("test-provider", mockCredentials)
    const result = await store.get("test-provider")
    expect(result).toEqual(mockCredentials)
  })

  it("should remove credentials", async () => {
    await store.set("test-provider", mockCredentials)
    await store.remove("test-provider")
    const result = await store.get("test-provider")
    expect(result).toBeUndefined()
  })

  it("should return all credentials", async () => {
    const secondCreds: OAuthCredentials = {
      ...mockCredentials,
      access: "different_token",
    }

    await store.set("provider1", mockCredentials)
    await store.set("provider2", secondCreds)

    const all = await store.all()
    expect(all).toEqual({
      provider1: mockCredentials,
      provider2: secondCreds,
    })
  })

  it("should return a copy from all() to prevent mutation", async () => {
    await store.set("provider1", mockCredentials)
    const all = await store.all()
    all["provider1"] = { ...mockCredentials, access: "mutated" }

    const originalStored = await store.get("provider1")
    expect(originalStored?.access).toBe(mockCredentials.access)
  })

  it("should overwrite existing credentials on set", async () => {
    await store.set("test-provider", mockCredentials)
    const newCreds: OAuthCredentials = {
      ...mockCredentials,
      access: "new_access_token",
    }
    await store.set("test-provider", newCreds)

    const result = await store.get("test-provider")
    expect(result?.access).toBe("new_access_token")
  })
})

describe("StaticCredentialStore", () => {
  it("should return credentials from initial data", async () => {
    const store = new StaticCredentialStore({
      "test-provider": mockCredentials,
    })
    const result = await store.get("test-provider")
    expect(result).toEqual(mockCredentials)
  })

  it("should return undefined for non-existent provider", async () => {
    const store = new StaticCredentialStore({})
    const result = await store.get("nonexistent")
    expect(result).toBeUndefined()
  })

  it("should throw error on set", async () => {
    const store = new StaticCredentialStore({})
    await expect(store.set("test", mockCredentials)).rejects.toThrow(
      "StaticCredentialStore is read-only"
    )
  })

  it("should throw error on remove", async () => {
    const store = new StaticCredentialStore({
      "test-provider": mockCredentials,
    })
    await expect(store.remove("test-provider")).rejects.toThrow(
      "StaticCredentialStore is read-only"
    )
  })

  it("should return all credentials", async () => {
    const data = {
      provider1: mockCredentials,
      provider2: { ...mockCredentials, access: "other" },
    }
    const store = new StaticCredentialStore(data)
    const all = await store.all()
    expect(all).toEqual(data)
  })

  it("should return a copy from all() to prevent mutation", async () => {
    const store = new StaticCredentialStore({
      provider1: mockCredentials,
    })
    const all = await store.all()
    all["provider1"] = { ...mockCredentials, access: "mutated" }

    const originalStored = await store.get("provider1")
    expect(originalStored?.access).toBe(mockCredentials.access)
  })
})
