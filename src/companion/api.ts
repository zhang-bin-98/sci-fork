import type {
  CompanionFailure,
  EntitySuccess,
  FocusSuccess,
  SnapshotSuccess,
} from '../shared/companion-contract.js'
import { isPageKey } from '../shared/page-key.js'
import {
  ROUTE_ENTITY,
  ROUTE_FOCUS,
  ROUTE_SNAPSHOT,
} from '../shared/routes.js'

const PAGE_KEY_HEADER = 'X-SciFork-Page-Key'

export class CompanionApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable: boolean,
    readonly entityId?: string,
  ) {
    super(message)
    this.name = 'CompanionApiError'
  }
}

export interface CompanionApiClientOptions {
  pageKey: string
  fetch?: typeof globalThis.fetch
  onPageKeyInvalid?: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asFailure(value: unknown): CompanionFailure | undefined {
  if (
    !isRecord(value) ||
    value.ok !== false ||
    typeof value.code !== 'string' ||
    typeof value.message !== 'string' ||
    typeof value.recoverable !== 'boolean' ||
    (value.entityId !== undefined && typeof value.entityId !== 'string')
  ) {
    return undefined
  }
  return value.entityId === undefined
    ? {
        ok: false,
        code: value.code,
        message: value.message,
        recoverable: value.recoverable,
      }
    : {
        ok: false,
        code: value.code,
        message: value.message,
        recoverable: value.recoverable,
        entityId: value.entityId as string,
      }
}

export class CompanionApiClient {
  private readonly pageKey: string
  private readonly fetch: typeof globalThis.fetch
  private readonly onPageKeyInvalid: (() => void) | undefined
  private invalidated = false

  constructor(options: CompanionApiClientOptions) {
    if (!isPageKey(options.pageKey)) throw new Error('invalid SciFork Page Key')
    this.pageKey = options.pageKey
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.onPageKeyInvalid = options.onPageKeyInvalid
  }

  snapshot(sinceProjectRevision?: string, signal?: AbortSignal): Promise<SnapshotSuccess> {
    return this.request<SnapshotSuccess>(
      ROUTE_SNAPSHOT,
      sinceProjectRevision === undefined ? {} : { sinceProjectRevision },
      signal,
    )
  }

  entity(entityId: string, signal?: AbortSignal): Promise<EntitySuccess> {
    return this.request<EntitySuccess>(ROUTE_ENTITY, { entityId }, signal)
  }

  setFocus(entityId: string, signal?: AbortSignal): Promise<FocusSuccess> {
    return this.request<FocusSuccess>(ROUTE_FOCUS, { entityId }, signal)
  }

  private async request<T extends { ok: true }>(
    route: string,
    body: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response
    try {
      response = await this.fetch(route, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [PAGE_KEY_HEADER]: this.pageKey,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch {
      throw new CompanionApiError(
        'REQUEST_FAILED',
        'The Companion request failed.',
        true,
      )
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      if (response.status === 401) {
        this.invalidatePageKey()
        throw new CompanionApiError(
          'PAGE_KEY_INVALID',
          'Reopen the Companion from DSH.',
          false,
        )
      }
      throw new CompanionApiError(
        'INVALID_RESPONSE',
        'The Companion received an invalid response.',
        true,
      )
    }

    const failure = asFailure(payload)
    if (failure !== undefined) {
      if (response.status === 401 || failure.code === 'PAGE_KEY_INVALID') {
        this.invalidatePageKey()
      }
      throw new CompanionApiError(
        failure.code,
        failure.message,
        failure.recoverable,
        failure.entityId,
      )
    }
    if (!response.ok || !isRecord(payload) || payload.ok !== true) {
      if (response.status === 401) this.invalidatePageKey()
      throw new CompanionApiError(
        response.status === 401 ? 'PAGE_KEY_INVALID' : 'INVALID_RESPONSE',
        response.status === 401
          ? 'Reopen the Companion from DSH.'
          : 'The Companion received an invalid response.',
        response.status !== 401,
      )
    }
    return payload as T
  }

  private invalidatePageKey(): void {
    if (this.invalidated) return
    this.invalidated = true
    try {
      this.onPageKeyInvalid?.()
    } catch {
      // Credential invalidation remains final even if storage is unavailable.
    }
  }
}
