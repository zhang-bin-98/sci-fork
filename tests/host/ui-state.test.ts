import { describe, expect, it } from 'vitest'
import {
  FOCUS_RECORD_SCHEMA,
  MutationQueue,
  UI_STATE_DOMAIN,
  UI_STATE_VERSION,
  focusKey,
  readFocus,
  uiStateDomainSpec,
  writeFocus,
} from '../../src/host/ui-state.js'
import { FakeStorageDomainPort, fakeDomainTable } from './fakes.js'

const SESSION = 'session-1'
const PROJECT = 'aaaaaaaa-1111-4111-8111-111111111111'

describe('ui state domain spec', () => {
  it('declares only the Focus table', () => {
    const spec = uiStateDomainSpec()
    expect(spec.name).toBe(UI_STATE_DOMAIN)
    expect(spec.version).toBe(UI_STATE_VERSION)
    expect(Object.keys(spec.tables)).toEqual(['focus'])
  })

  it('validates Focus records strictly', () => {
    expect(FOCUS_RECORD_SCHEMA.safeParse({ focusEntityId: 'node_1', pathIds: [] }).success).toBe(true)
    expect(FOCUS_RECORD_SCHEMA.safeParse({ focusEntityId: 'node_1', pathIds: ['a'], extra: 1 }).success).toBe(false)
    expect(FOCUS_RECORD_SCHEMA.safeParse({ focusEntityId: '', pathIds: [] }).success).toBe(false)
    expect(FOCUS_RECORD_SCHEMA.safeParse({ focusEntityId: 'n', pathIds: new Array(33).fill('a') }).success).toBe(false)
  })

  it('builds the session/project Focus key', () => {
    expect(focusKey(SESSION, PROJECT)).toBe(`${SESSION}:${PROJECT}`)
  })
})

describe('focus records', () => {
  it('reads and writes Focus through the storage domain', async () => {
    const storage = new FakeStorageDomainPort()
    const domain = await storage.open(uiStateDomainSpec())
    expect(await readFocus(domain, SESSION, PROJECT)).toBeUndefined()
    await writeFocus(domain, SESSION, PROJECT, { focusEntityId: 'node_a', pathIds: [] })
    expect(await readFocus(domain, SESSION, PROJECT)).toEqual({ focusEntityId: 'node_a', pathIds: [] })
  })

  it('drops malformed persisted Focus instead of exposing it', async () => {
    const storage = new FakeStorageDomainPort()
    const domain = await storage.open(uiStateDomainSpec())
    const table = storage.tableOf(UI_STATE_DOMAIN, 'focus')!
    table.records.set(`${SESSION}:${PROJECT}`, { focusEntityId: '', pathIds: [] })
    expect(await readFocus(domain, SESSION, PROJECT)).toBeUndefined()
    expect(table.records.size).toBe(0)
  })
})

describe('MutationQueue', () => {
  it('serializes operations under one key', async () => {
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
    await Promise.all([first, second])
    expect(order[0]).toBe('a1-start')
    expect(order.indexOf('a1-end')).toBeLessThan(order.indexOf('a2'))
  })

  it('keeps the queue usable after a failing operation', async () => {
    const queue = new MutationQueue()
    const failing = queue.run('a', async () => {
      throw new Error('boom')
    })
    await expect(failing).rejects.toThrow('boom')
    await expect(queue.run('a', async () => 'recovered')).resolves.toBe('recovered')
  })
})

describe('fake domain table sanity', () => {
  it('supports put/get/update/delete', async () => {
    const table = fakeDomainTable<string>()
    await table.put('k', 'v')
    expect(table.get('k')).toBe('v')
    await table.update('k', (current) => current + '2')
    expect(table.get('k')).toBe('v2')
    await expect(table.delete('k')).resolves.toBe(true)
    expect(table.get('k')).toBeUndefined()
  })
})
