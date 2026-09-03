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

    const firstSelection = queue.select('node_a')
    const secondSelection = queue.select('node_b')

    expect(setFocus).toHaveBeenCalledTimes(1)
    expect(setFocus).toHaveBeenLastCalledWith('node_a')
    expect(queue.pendingEntityId).toBe('node_b')

    first.resolve({ focusEntityId: 'node_a' })
    await vi.waitFor(() => expect(setFocus).toHaveBeenCalledTimes(2))
    expect(setFocus).toHaveBeenLastCalledWith('node_b')

    second.resolve({ focusEntityId: 'node_b' })
    await queue.idle()

    await expect(firstSelection).resolves.toBe(true)
    await expect(secondSelection).resolves.toBe(true)
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

    const failedSelection = queue.select('node_a')
    const successfulSelection = queue.select('node_b')
    await queue.idle()

    await expect(failedSelection).resolves.toBe(false)
    await expect(successfulSelection).resolves.toBe(true)
    expect(setFocus.mock.calls).toEqual([['node_a'], ['node_b']])
    expect(errors).toHaveLength(1)
    expect(confirmed).toEqual(['node_b'])
  })

  it('settles an exact queued selection even when the same id appears earlier', async () => {
    const first = deferred<{ focusEntityId: string }>()
    const second = deferred<{ focusEntityId: string }>()
    const third = deferred<{ focusEntityId: string }>()
    const setFocus = vi
      .fn<(entityId: string) => Promise<{ focusEntityId: string }>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
    const queue = new FocusSelectionQueue({
      setFocus,
      onConfirmed: () => undefined,
      onPendingChange: () => undefined,
      onError: () => undefined,
    })

    const earlierAnchor = queue.select('node_a')
    const evidence = queue.select('ev_a')
    const restoredAnchor = queue.select('node_a')

    first.resolve({ focusEntityId: 'node_a' })
    await expect(earlierAnchor).resolves.toBe(true)
    expect(await Promise.race([restoredAnchor, Promise.resolve('pending')])).toBe('pending')

    second.resolve({ focusEntityId: 'ev_a' })
    await expect(evidence).resolves.toBe(true)
    third.resolve({ focusEntityId: 'node_a' })
    await expect(restoredAnchor).resolves.toBe(true)
    await queue.idle()
  })

  it('fails a successful response when the Host confirms a different Focus', async () => {
    const errors: unknown[] = []
    const confirmed: string[] = []
    const queue = new FocusSelectionQueue({
      setFocus: async () => ({ focusEntityId: 'node_other' }),
      isConfirmed: (entityId, result) => result.focusEntityId === entityId,
      onConfirmed: (entityId) => confirmed.push(entityId),
      onPendingChange: () => undefined,
      onError: (error) => errors.push(error),
    })

    await expect(queue.select('node_requested')).resolves.toBe(false)
    expect(confirmed).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('starts a new worker when selection resumes before the prior worker settles', async () => {
    const setFocus = vi
      .fn<(entityId: string) => Promise<{ focusEntityId: string }>>()
      .mockImplementation(async (entityId) => ({ focusEntityId: entityId }))
    const queue = new FocusSelectionQueue({
      setFocus,
      onConfirmed: () => undefined,
      onPendingChange: () => undefined,
      onError: () => undefined,
    })

    await expect(queue.select('node_a')).resolves.toBe(true)
    const second = queue.select('node_b')
    await Promise.resolve()
    const secondStarted = setFocus.mock.calls.length === 2
    if (!secondStarted) queue.dispose()

    expect(secondStarted).toBe(true)
    await expect(second).resolves.toBe(true)
  })
})
