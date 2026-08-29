import { isPageKey } from '../shared/page-key.js'

export const PAGE_KEY_STORAGE_KEY = 'scifork.page-key.v1'

interface LocationPort {
  hash: string
  pathname: string
  search: string
}

interface HistoryPort {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void
}

export interface SessionStoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PageKeyEnvironment {
  location: LocationPort
  history: HistoryPort
  storage: SessionStoragePort
}

export function clearStoredPageKey(storage: SessionStoragePort): void {
  try {
    storage.removeItem(PAGE_KEY_STORAGE_KEY)
  } catch {
    // A blocked sessionStorage is equivalent to an unavailable credential.
  }
}

function storedPageKey(storage: SessionStoragePort): string | undefined {
  try {
    const stored = storage.getItem(PAGE_KEY_STORAGE_KEY)
    if (isPageKey(stored)) return stored
  } catch {
    return undefined
  }
  clearStoredPageKey(storage)
  return undefined
}

export function consumePageKey(environment: PageKeyEnvironment): string | undefined {
  const { location, history, storage } = environment
  const fragment = location.hash
  if (fragment.length === 0) return storedPageKey(storage)

  try {
    history.replaceState(null, '', location.pathname + location.search)
  } catch {
    clearStoredPageKey(storage)
    return undefined
  }

  const match = /^#key=([A-Za-z0-9_-]{43})$/u.exec(fragment)
  const pageKey = match?.[1]
  if (!isPageKey(pageKey)) {
    clearStoredPageKey(storage)
    return undefined
  }

  try {
    storage.setItem(PAGE_KEY_STORAGE_KEY, pageKey)
    return pageKey
  } catch {
    clearStoredPageKey(storage)
    return undefined
  }
}
