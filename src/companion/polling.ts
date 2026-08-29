interface VisibilityPort {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export interface VisiblePollingOptions {
  document: VisibilityPort
  readSnapshot(): Promise<unknown>
  intervalMs?: number
}

export function startVisiblePolling(options: VisiblePollingOptions): () => void {
  const intervalMs = options.intervalMs ?? 5_000
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let inFlight = false
  let refreshAfterFlight = false

  const clearTimer = (): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  const schedule = (): void => {
    clearTimer()
    if (disposed || options.document.visibilityState !== 'visible') return
    timer = setTimeout(() => {
      timer = undefined
      run()
    }, intervalMs)
  }

  const finish = (): void => {
    inFlight = false
    if (disposed || options.document.visibilityState !== 'visible') return
    if (refreshAfterFlight) {
      refreshAfterFlight = false
      run()
      return
    }
    schedule()
  }

  const run = (): void => {
    if (disposed || options.document.visibilityState !== 'visible') return
    if (inFlight) {
      refreshAfterFlight = true
      return
    }
    clearTimer()
    inFlight = true
    try {
      void Promise.resolve(options.readSnapshot()).then(finish, finish)
    } catch {
      finish()
    }
  }

  const onVisibilityChange = (): void => {
    clearTimer()
    if (options.document.visibilityState !== 'visible') {
      refreshAfterFlight = false
      return
    }
    if (inFlight) {
      refreshAfterFlight = true
      return
    }
    run()
  }

  options.document.addEventListener('visibilitychange', onVisibilityChange)
  if (options.document.visibilityState === 'visible') run()

  return () => {
    if (disposed) return
    disposed = true
    refreshAfterFlight = false
    clearTimer()
    options.document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
