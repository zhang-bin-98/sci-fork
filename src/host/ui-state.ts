import { z } from 'zod'
import type { DomainSpec, StorageDomain } from './contracts.js'

/**
 * Focus sidecar state (architecture §7.4). It lives in one DSH storage domain
 * and never touches research files or Git. Git history remains DSH/user-owned.
 */

export const UI_STATE_DOMAIN = 'scifork_ui_state_v1'
export const UI_STATE_VERSION = 1
export const TABLE_FOCUS = 'focus'

export const FOCUS_RECORD_SCHEMA = z
  .object({
    focusEntityId: z.string().min(1),
    pathIds: z.array(z.string().min(1)).max(32),
  })
  .strict()
export type FocusRecord = z.infer<typeof FOCUS_RECORD_SCHEMA>

export function uiStateDomainSpec(): DomainSpec {
  return {
    name: UI_STATE_DOMAIN,
    version: UI_STATE_VERSION,
    tables: {
      [TABLE_FOCUS]: { valueSchema: FOCUS_RECORD_SCHEMA },
    },
  }
}

export function focusKey(sessionId: string, projectId: string): string {
  return `${sessionId}:${projectId}`
}

/** Read the Focus sidecar for one session/project pair. */
export async function readFocus(
  storage: StorageDomain,
  sessionId: string,
  projectId: string,
): Promise<FocusRecord | undefined> {
  const table = storage.table(TABLE_FOCUS)
  const key = focusKey(sessionId, projectId)
  const raw = table.get(key)
  if (raw === undefined) return undefined
  const parsed = FOCUS_RECORD_SCHEMA.safeParse(raw)
  if (!parsed.success) {
    await table.delete(key)
    return undefined
  }
  return parsed.data
}

export async function writeFocus(
  storage: StorageDomain,
  sessionId: string,
  projectId: string,
  record: FocusRecord,
): Promise<void> {
  const table = storage.table(TABLE_FOCUS)
  await table.put(focusKey(sessionId, projectId), record)
}

/**
 * Per-project mutation queue (architecture §12.1): one Host process owns a
 * project, and all mutations for one project root run serially while reads
 * stay lock-free.
 */
export class MutationQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    const tail = next.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return next
  }
}
