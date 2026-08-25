import { z } from 'zod'
import type { DomainSpec, StorageDomain } from './contracts.js'

/**
 * Focus and one-step restore state (architecture §7.4). Both live in one
 * DSH storage domain (`scifork_ui_state_v1`); neither ever touches research
 * files or Git. Focus keys by session+project, undo keys by project+branch.
 */

export const UI_STATE_DOMAIN = 'scifork_ui_state_v1'
export const UI_STATE_VERSION = 1
export const TABLE_FOCUS = 'focus'
export const TABLE_UNDO = 'undo'

export const FOCUS_RECORD_SCHEMA = z
  .object({
    focusEntityId: z.string().min(1),
    pathIds: z.array(z.string().min(1)).max(32),
  })
  .strict()
export type FocusRecord = z.infer<typeof FOCUS_RECORD_SCHEMA>

/** Git commit ids: SHA-1 (40) or SHA-256 (64) lowercase hex. */
const COMMIT_ID_RE = /^[0-9a-f]{40,64}$/

export const UNDO_RECORD_SCHEMA = z
  .object({
    branch: z.string().min(1),
    recordedHead: z.string().regex(COMMIT_ID_RE),
    lastCheckpointId: z.string().regex(COMMIT_ID_RE),
    previousCheckpointId: z.string().regex(COMMIT_ID_RE).optional(),
    forwardCheckpointId: z.string().regex(COMMIT_ID_RE).optional(),
  })
  .strict()
export type UndoRecord = z.infer<typeof UNDO_RECORD_SCHEMA>

export function uiStateDomainSpec(): DomainSpec {
  return {
    name: UI_STATE_DOMAIN,
    version: UI_STATE_VERSION,
    tables: {
      [TABLE_FOCUS]: { valueSchema: FOCUS_RECORD_SCHEMA },
      [TABLE_UNDO]: { valueSchema: UNDO_RECORD_SCHEMA },
    },
  }
}

export function focusKey(sessionId: string, projectId: string): string {
  return `${sessionId}:${projectId}`
}

export function undoKey(projectId: string, branch: string): string {
  return `${projectId}:${branch}`
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
 * Load the undo record after checking consistency: a branch change or an
 * external HEAD change clears the one-step state (architecture §11.3).
 */
export async function loadUndoRecord(
  storage: StorageDomain,
  projectId: string,
  branch: string,
  head: string,
): Promise<UndoRecord | undefined> {
  const table = storage.table(TABLE_UNDO)
  const key = undoKey(projectId, branch)
  // A branch switch invalidates the one-step state from every other branch.
  // Remove those records before reading the current key so a later switch
  // back cannot resurrect stale Back/Forward controls.
  await clearOtherUndoRecords(table, projectId, key)
  const raw = table.get(key)
  if (raw === undefined) return undefined
  const parsed = UNDO_RECORD_SCHEMA.safeParse(raw)
  if (!parsed.success) {
    await table.delete(key)
    return undefined
  }
  const record = parsed.data
  if (record.branch !== branch || record.recordedHead !== head) {
    await table.delete(key)
    return undefined
  }
  return record
}

export async function writeUndo(
  storage: StorageDomain,
  projectId: string,
  branch: string,
  record: UndoRecord,
): Promise<void> {
  const table = storage.table(TABLE_UNDO)
  await clearOtherUndoRecords(table, projectId, undoKey(projectId, branch))
  await table.put(undoKey(projectId, branch), record)
}

async function clearOtherUndoRecords(
  table: ReturnType<StorageDomain['table']>,
  projectId: string,
  currentKey: string,
): Promise<void> {
  const projectPrefix = `${projectId}:`
  const staleKeys = [...table.entries()]
    .map(([storedKey]) => storedKey)
    .filter((storedKey) => storedKey.startsWith(projectPrefix) && storedKey !== currentKey)
  for (const staleKey of staleKeys) await table.delete(staleKey)
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
    this.tails.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }
}
