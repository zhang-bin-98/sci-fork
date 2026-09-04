import { afterEach, describe, expect, it, vi } from 'vitest'
import { startVisiblePolling } from '../../src/companion/polling.js'

class VisibilityDocument {
  visibilityState: DocumentVisibilityState
  readonly listeners = new Set<() => void>()

  constructor(state: DocumentVisibilityState) {
    this.visibilityState = state
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'visibilitychange') this.listeners.add(listener)
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'visibilitychange') this.listeners.delete(listener)
  }

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state
    for (const listener of this.listeners) listener()
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('visible-only snapshot polling', () => {
  it('polls immediately while visible, pauses while hidden, and refreshes on return', async () => {
    vi.useFakeTimers()
    const document = new VisibilityDocument('visible')
    const readSnapshot = vi.fn(async () => undefined)

    const stop = startVisiblePolling({ document, readSnapshot })
    expect(readSnapshot).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(readSnapshot).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(readSnapshot).toHaveBeenCalledTimes(2)

    document.setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(readSnapshot).toHaveBeenCalledTimes(2)

    document.setVisibility('visible')
    expect(readSnapshot).toHaveBeenCalledTimes(3)

    stop()
    expect(document.listeners.size).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(readSnapshot).toHaveBeenCalledTimes(3)
  })

  it('does not poll on a hidden mount and never overlaps an in-flight request', async () => {
    vi.useFakeTimers()
    const document = new VisibilityDocument('hidden')
    let finish: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const readSnapshot = vi.fn(() => pending)

    const stop = startVisiblePolling({ document, readSnapshot })
    expect(readSnapshot).not.toHaveBeenCalled()

    document.setVisibility('visible')
    expect(readSnapshot).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(readSnapshot).toHaveBeenCalledOnce()

    finish?.()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(readSnapshot).toHaveBeenCalledTimes(2)
    stop()
  })
})
