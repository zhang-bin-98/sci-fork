import { describe, expect, it, vi } from 'vitest'
import {
  PAGE_KEY_BYTES,
  PageKeyStore,
  type PageBinding,
} from '../../src/host/page-keys.js'

const BINDING: PageBinding = {
  sessionId: 'session-1',
  sessionCwd: '/research',
  projectRoot: '/research',
  projectId: 'aaaaaaaa-1111-4111-8111-111111111111',
}

describe('PageKeyStore', () => {
  it('creates an unpadded base64url key from 256 random bits', () => {
    const randomBytes = vi.fn((size: number) => Buffer.alloc(size, 0xfb))
    const store = new PageKeyStore(randomBytes)

    const key = store.create(BINDING)

    expect(randomBytes).toHaveBeenCalledWith(PAGE_KEY_BYTES)
    expect(PAGE_KEY_BYTES).toBe(32)
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(key).not.toContain('=')
    expect(store.resolve(key)).toEqual(BINDING)
  })

  it('retries a colliding random value instead of replacing a binding', () => {
    let call = 0
    const store = new PageKeyStore((size) => {
      call += 1
      return Buffer.alloc(size, call < 3 ? 1 : 2)
    })
    const first = store.create(BINDING)
    const second = store.create({ ...BINDING, sessionId: 'session-2' })

    expect(second).not.toBe(first)
    expect(store.resolve(first)?.sessionId).toBe('session-1')
    expect(store.resolve(second)?.sessionId).toBe('session-2')
    expect(call).toBe(3)
  })

  it('rejects malformed keys and revokes every key for a disposed Session', () => {
    const store = new PageKeyStore((size) => Buffer.alloc(size, 7))
    const key = store.create(BINDING)

    expect(store.resolve('not-a-page-key')).toBeUndefined()
    expect(store.revokeSession('session-1')).toBe(1)
    expect(store.resolve(key)).toBeUndefined()
  })

  it('revokes one key and clears all in-memory bindings on unload', () => {
    let value = 10
    const store = new PageKeyStore((size) => Buffer.alloc(size, value++))
    const first = store.create(BINDING)
    const second = store.create({ ...BINDING, sessionId: 'session-2' })

    expect(store.revoke(first)).toBe(true)
    expect(store.resolve(first)).toBeUndefined()
    expect(store.resolve(second)).toBeDefined()
    store.clear()
    expect(store.resolve(second)).toBeUndefined()
    expect(store.size).toBe(0)
  })
})
