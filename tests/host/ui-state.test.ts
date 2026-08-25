import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  FOCUS_RECORD_SCHEMA,
  MutationQueue,
  UNDO_RECORD_SCHEMA,
  UI_STATE_DOMAIN,
  UI_STATE_VERSION,
  focusKey,
  loadUndoRecord,
  readFocus,
  uiStateDomainSpec,
  undoKey,
  writeFocus,
  writeUndo,
} from '../../src/host/ui-state.js'
import { FakeStorageDomainPort, fakeDomainTable } from './fakes.js'

const SESSION = 'session-1'
const PROJECT = 'aaaaaaaa-1111-4111-8111-111111111111'
const SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const SHA_B = 'bbbbbb1234567890bbbbbb1234567890bbbbbb12'

describe('ui state domain spec', () => {
  it('declares the pinned domain with focus and undo tables', () => {
    const spec = uiStateDomainSpec()
    expect(spec.name).toBe(UI_STATE_DOMAIN)
    expect(spec.version).toBe(UI_STATE_VERSION)
    expect(Object.keys(spec.tables).sort()).toEqual(['focus', 'undo'])
  })

  it('validates focus and undo records strictly', () => {
    expect(FOCUS_RECORD_SCHEMA.safeParse({ focusEntityId: 'node_1', pathIds: [] }).success).toBe(true)
    expect(FOCUS_RECORD_SCHEMA.safeParse({ focusEntityId: 'node_1', pathIds: ['a'], extra: 1 }).success).toBe(false)
    expect(FOCUS_RECORD_SCHEMA.safeParse({ focusEntityId: '', pathIds: [] }).success).toBe(false)
    expect(FOCUS_RECORD_SCHEMA.safeParse({ focusEntityId: 'n', pathIds: new Array(33).fill('a') }).success).toBe(false)

    expect(UNDO_RECORD_SCHEMA.safeParse({
      branch: 'main',
      recordedHead: SHA,
      lastCheckpointId: SHA,
      previousCheckpointId: SHA_B,
    }).success).toBe(true)
    expect(UNDO_RECORD_SCHEMA.safeParse({
      branch: 'main',
      recordedHead: SHA,
      lastCheckpointId: SHA,
      forwardCheckpointId: SHA_B,
    }).success).toBe(true)
    expect(UNDO_RECORD_SCHEMA.safeParse({
      branch: 'main',
      recordedHead: 'not-a-sha',
      lastCheckpointId: SHA,
    }).success).toBe(false)
    expect(UNDO_RECORD_SCHEMA.safeParse({ branch: '', recordedHead: SHA, lastCheckpointId: SHA }).success).toBe(false)
  })

  it('builds the pinned key formats', () => {
    expect(focusKey(SESSION, PROJECT)).toBe(`${SESSION}:${PROJECT}`)
    expect(undoKey(PROJECT, 'main')).toBe(`${PROJECT}:main`)
  })
})

describe('focus records', () => {
  it('reads and writes focus through the storage domain', async () => {
    const storage = new FakeStorageDomainPort()
    const domain = await storage.open(uiStateDomainSpec())
    expect(await readFocus(domain, SESSION, PROJECT)).toBeUndefined()
    await writeFocus(domain, SESSION, PROJECT, { focusEntityId: 'node_a', pathIds: [] })
    expect(await readFocus(domain, SESSION, PROJECT)).toEqual({ focusEntityId: 'node_a', pathIds: [] })
  })
})

describe('undo records', () => {
  it('writes and loads consistent undo records', async () => {
    const storage = new FakeStorageDomainPort()
    const domain = await storage.open(uiStateDomainSpec())
    await writeUndo(domain, PROJECT, 'main', {
      branch: 'main',
      recordedHead: SHA,
      lastCheckpointId: SHA,
      previousCheckpointId: SHA_B,
    })
    expect(await loadUndoRecord(domain, PROJECT, 'main', SHA)).toEqual({
      branch: 'main',
      recordedHead: SHA,
      lastCheckpointId: SHA,
      previousCheckpointId: SHA_B,
    })
  })

  it('clears records when the branch or HEAD moved externally', async () => {
    const storage = new FakeStorageDomainPort()
    const domain = await storage.open(uiStateDomainSpec())
    await writeUndo(domain, PROJECT, 'main', {
      branch: 'main',
      recordedHead: SHA,
      lastCheckpointId: SHA,
      previousCheckpointId: SHA_B,
    })
    expect(await loadUndoRecord(domain, PROJECT, 'main', SHA_B)).toBeUndefined()
    expect(await loadUndoRecord(domain, PROJECT, 'other', SHA)).toBeUndefined()
    const table = storage.tableOf(UI_STATE_DOMAIN, 'undo')
    expect(table?.records.size).toBe(0)
  })

  it('clears the prior branch record when loading another branch', async () => {
    const storage = new FakeStorageDomainPort()
    const domain = await storage.open(uiStateDomainSpec())
    await writeUndo(domain, PROJECT, 'main', {
      branch: 'main',
      recordedHead: SHA,
      lastCheckpointId: SHA,
      previousCheckpointId: SHA_B,
    })
    expect(await loadUndoRecord(domain, PROJECT, 'feature', SHA_B)).toBeUndefined()
    const table = storage.tableOf(UI_STATE_DOMAIN, 'undo')
    expect(table?.records.size).toBe(0)
  })

  it('clears the prior branch record when writing on another branch', async () => {
    const storage = new FakeStorageDomainPort()
    const domain = await storage.open(uiStateDomainSpec())
    await writeUndo(domain, PROJECT, 'main', {
      branch: 'main',
      recordedHead: SHA,
      lastCheckpointId: SHA,
      previousCheckpointId: SHA_B,
    })
    await writeUndo(domain, PROJECT, 'feature', {
      branch: 'feature',
      recordedHead: SHA_B,
      lastCheckpointId: SHA_B,
    })
    const table = storage.tableOf(UI_STATE_DOMAIN, 'undo')
    expect(table?.records.size).toBe(1)
    expect(table?.records.has(`${PROJECT}:main`)).toBe(false)
    expect(table?.records.has(`${PROJECT}:feature`)).toBe(true)
  })

  it('returns undefined for unknown records without touching storage', async () => {
    const storage = new FakeStorageDomainPort()
    const domain = await storage.open(uiStateDomainSpec())
    expect(await loadUndoRecord(domain, PROJECT, 'main', SHA)).toBeUndefined()
    const table = storage.tableOf(UI_STATE_DOMAIN, 'undo')
    expect(table?.records.size).toBe(0)
  })
})

describe('MutationQueue', () => {
  it('serializes operations under one key and isolates different keys', async () => {
    const queue = new MutationQueue()
    const order: string[] = []
    const first = queue.run('a', async () => {
      order.push('a1-start')
      await new Promise((resolve) => setTimeout(resolve, 10))
      order.push('a1-end')
    })
    const second = queue.run('a', async () => {
      order.push('a2')
    })
    const other = queue.run('b', async () => {
      order.push('b')
    })
    await Promise.all([first, second, other])
    expect(order[0]).toBe('a1-start')
    expect(order[order.length - 1]).toBe('a2')
    expect(order.indexOf('b')).toBeGreaterThan(order.indexOf('a1-start'))
    expect(order.indexOf('a2')).toBeGreaterThan(order.indexOf('b'))
  })

  it('keeps the queue usable after a failing operation', async () => {
    const queue = new MutationQueue()
    const failing = queue.run('a', async () => {
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')
    const after = queue.run('a', async () => 'recovered')
    await expect(after).resolves.toBe('recovered')
  })
})

describe('record schema types stay usable', () => {
  it('round-trips values through the zod schemas', () => {
    const record = { focusEntityId: 'node_1', pathIds: ['a', 'b'] }
    const parsed = FOCUS_RECORD_SCHEMA.parse(record)
    expect(parsed).toEqual(record)
    const undo = UNDO_RECORD_SCHEMA.parse({ branch: 'main', recordedHead: SHA, lastCheckpointId: SHA })
    expect(z.object({ branch: z.string() }).parse(undo)).toEqual({ branch: 'main' })
  })
})

describe('fake domain table sanity', () => {
  it('supports put/get/update/delete', async () => {
    const table = fakeDomainTable<string>()
    await table.put('k', 'v')
    expect(table.get('k')).toBe('v')
    await table.update('k', (current) => current + '2')
    expect(table.get('k')).toBe('v2')
    expect(await table.delete('k')).toBe(true)
    expect(table.get('k')).toBeUndefined()
  })
})
