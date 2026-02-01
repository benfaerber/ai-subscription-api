import path from "path"
import os from "os"

export type OAuthCredentials = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

export type Credentials = OAuthCredentials

export interface CredentialStore {
  get(provider: string): Promise<Credentials | undefined>
  set(provider: string, credentials: Credentials): Promise<void>
  remove(provider: string): Promise<void>
  all(): Promise<Record<string, Credentials>>
}

export class FileCredentialStore implements CredentialStore {
  private filepath: string

  constructor(filepath?: string) {
    const dir = filepath ? path.dirname(filepath) : path.join(os.homedir(), ".local", "share", "subscription-auth")
    this.filepath = filepath || path.join(dir, "auth.json")
  }

  async get(provider: string): Promise<Credentials | undefined> {
    const data = await this.all()
    return data[provider]
  }

  async all(): Promise<Record<string, Credentials>> {
    const file = Bun.file(this.filepath)
    if (!(await file.exists())) return {}
    return file.json().catch(() => ({}))
  }

  async set(provider: string, credentials: Credentials): Promise<void> {
    await Bun.spawn(["mkdir", "-p", path.dirname(this.filepath)]).exited
    const data = await this.all()
    data[provider] = credentials
    await Bun.write(this.filepath, JSON.stringify(data, null, 2), { mode: 0o600 })
  }

  async remove(provider: string): Promise<void> {
    const data = await this.all()
    delete data[provider]
    await Bun.write(this.filepath, JSON.stringify(data, null, 2), { mode: 0o600 })
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private data: Record<string, Credentials> = {}

  async get(provider: string): Promise<Credentials | undefined> {
    return this.data[provider]
  }

  async all(): Promise<Record<string, Credentials>> {
    return { ...this.data }
  }

  async set(provider: string, credentials: Credentials): Promise<void> {
    this.data[provider] = credentials
  }

  async remove(provider: string): Promise<void> {
    delete this.data[provider]
  }
}

export class StaticCredentialStore implements CredentialStore {
  constructor(private data: Record<string, Credentials>) {}

  async get(provider: string): Promise<Credentials | undefined> {
    return this.data[provider]
  }

  async all(): Promise<Record<string, Credentials>> {
    return { ...this.data }
  }

  async set(_provider: string, _credentials: Credentials): Promise<void> {
    throw new Error("StaticCredentialStore is read-only")
  }

  async remove(_provider: string): Promise<void> {
    throw new Error("StaticCredentialStore is read-only")
  }
}
