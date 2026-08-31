import { describe, expect, it, vi } from 'vitest'
import {
  clearStoredPageKey,
  consumePageKey,
} from '../../src/companion/page-key.js'

const PAGE_KEY = 'A'.repeat(43)

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function browser(hash: string, storage = new MemoryStorage()) {
  const location = { hash, pathname: '/scifork', search: '?view=graph' }
  const replaceState = vi.fn(() => {
    location.hash = ''
  })
  return {
    environment: {
      location,
      history: { replaceState },
      storage,
    },
    location,
    replaceState,
    storage,
  }
}

describe('Companion Page Key handshake', () => {
  it('stores a valid fragment key and immediately removes the complete fragment', () => {
    const { environment, replaceState, storage } = browser(`#key=${PAGE_KEY}`)

    expect(consumePageKey(environment)).toBe(PAGE_KEY)
    expect([...storage.values.values()]).toEqual([PAGE_KEY])
    expect(replaceState).toHaveBeenCalledOnce()
    expect(replaceState.mock.calls[0]?.[2]).toBe('/scifork?view=graph')
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain(PAGE_KEY)
  })

  it('reuses the window-scoped stored key on reload and can clear it after rejection', () => {
    const first = browser(`#key=${PAGE_KEY}`)
    expect(consumePageKey(first.environment)).toBe(PAGE_KEY)

    const reload = browser('', first.storage)
    expect(consumePageKey(reload.environment)).toBe(PAGE_KEY)
    expect(reload.replaceState).not.toHaveBeenCalled()

    clearStoredPageKey(first.storage)
    expect(consumePageKey(reload.environment)).toBeUndefined()
  })

  it('fails closed, clears storage, and strips the fragment when the fragment is malformed', () => {
    const first = browser(`#key=${PAGE_KEY}`)
    expect(consumePageKey(first.environment)).toBe(PAGE_KEY)

    const malformed = browser(`#key=${PAGE_KEY}&unexpected=value`, first.storage)
    expect(consumePageKey(malformed.environment)).toBeUndefined()
    expect(malformed.storage.values.size).toBe(0)
    expect(malformed.replaceState).toHaveBeenCalledOnce()
    expect(malformed.replaceState.mock.calls[0]?.[2]).toBe('/scifork?view=graph')
  })
})
