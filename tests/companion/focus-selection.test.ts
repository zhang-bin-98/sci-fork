import { describe, expect, it, vi } from 'vitest'
import { FocusSelectionQueue } from '../../src/companion/focus-selection.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('Focus selection queue', () => {
  it('serializes rapid clicks and finishes on the last selected entity', async () => {
    const first = deferred<{ focusEntityId: string }>()
    const second = deferred<{ focusEntityId: string }>()
    const setFocus = vi
      .fn<(entityId: string) => Promise<{ focusEntityId: string }>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const confirmed: string[] = []
    const pending: Array<string | undefined> = []
    const queue = new FocusSelectionQueue({
      setFocus,
      onConfirmed: (entityId) => confirmed.push(entityId),
      onPendingChange: (entityId) => pending.push(entityId),
      onError: () => undefined,
    })

    queue.select('node_a')
    queue.select('node_b')

    expect(setFocus).toHaveBeenCalledTimes(1)
    expect(setFocus).toHaveBeenLastCalledWith('node_a')
    expect(queue.pendingEntityId).toBe('node_b')

    first.resolve({ focusEntityId: 'node_a' })
    await vi.waitFor(() => expect(setFocus).toHaveBeenCalledTimes(2))
    expect(setFocus).toHaveBeenLastCalledWith('node_b')

    second.resolve({ focusEntityId: 'node_b' })
    await queue.idle()

    expect(confirmed).toEqual(['node_a', 'node_b'])
    expect(queue.pendingEntityId).toBeUndefined()
    expect(pending.at(-1)).toBeUndefined()
  })

  it('continues with the queued click after a failed Focus request', async () => {
    const setFocus = vi
      .fn<(entityId: string) => Promise<{ focusEntityId: string }>>()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce({ focusEntityId: 'node_b' })
    const confirmed: string[] = []
    const errors: unknown[] = []
    const queue = new FocusSelectionQueue({
      setFocus,
      onConfirmed: (entityId) => confirmed.push(entityId),
      onPendingChange: () => undefined,
      onError: (error) => errors.push(error),
    })

    queue.select('node_a')
    queue.select('node_b')
    await queue.idle()

    expect(setFocus.mock.calls).toEqual([['node_a'], ['node_b']])
    expect(errors).toHaveLength(1)
    expect(confirmed).toEqual(['node_b'])
  })
})
