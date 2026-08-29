import { randomBytes as nodeRandomBytes } from 'node:crypto'
import { isPageKey } from '../shared/page-key.js'

export const PAGE_KEY_BYTES = 32
const MAX_COLLISION_ATTEMPTS = 8

export interface PageBinding {
  sessionId: string
  sessionCwd: string
  projectRoot: string
  projectId?: string
}

export type RandomBytes = (size: number) => Uint8Array

/** In-memory Page Key authority. Keys never enter storageDomain or project files. */
export class PageKeyStore {
  private readonly bindings = new Map<string, PageBinding>()

  constructor(private readonly randomBytes: RandomBytes = nodeRandomBytes) {}

  create(binding: PageBinding): string {
    for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt += 1) {
      const key = Buffer.from(this.randomBytes(PAGE_KEY_BYTES)).toString('base64url')
      if (!isPageKey(key)) throw new Error('scifork: Page Key generator returned invalid bytes')
      if (this.bindings.has(key)) continue
      this.bindings.set(key, { ...binding })
      return key
    }
    throw new Error('scifork: Page Key collision limit exceeded')
  }

  resolve(key: string): PageBinding | undefined {
    if (!isPageKey(key)) return undefined
    const binding = this.bindings.get(key)
    return binding === undefined ? undefined : { ...binding }
  }

  revoke(key: string): boolean {
    if (!isPageKey(key)) return false
    return this.bindings.delete(key)
  }

  revokeSession(sessionId: string): number {
    let revoked = 0
    for (const [key, binding] of this.bindings) {
      if (binding.sessionId !== sessionId) continue
      this.bindings.delete(key)
      revoked += 1
    }
    return revoked
  }

  clear(): void {
    this.bindings.clear()
  }

  get size(): number {
    return this.bindings.size
  }
}
