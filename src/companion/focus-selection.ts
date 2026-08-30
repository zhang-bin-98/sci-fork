export interface FocusSelectionQueueOptions<T> {
  setFocus(entityId: string): Promise<T>
  onConfirmed(entityId: string, result: T): void
  onPendingChange(entityId: string | undefined): void
  onError(error: unknown, entityId: string): void
}

/** Serializes graph clicks so a request in flight never hides a later selection. */
export class FocusSelectionQueue<T> {
  private readonly queue: string[] = []
  private worker: Promise<void> | undefined
  private disposed = false
  private pending: string | undefined

  constructor(private readonly options: FocusSelectionQueueOptions<T>) {}

  get pendingEntityId(): string | undefined {
    return this.pending
  }

  select(entityId: string): void {
    if (this.disposed) return
    this.queue.push(entityId)
    this.setPending(entityId)
    if (this.worker === undefined) {
      this.worker = this.drain().finally(() => {
        this.worker = undefined
      })
    }
  }

  idle(): Promise<void> {
    return this.worker ?? Promise.resolve()
  }

  dispose(): void {
    this.disposed = true
    this.queue.length = 0
    this.setPending(undefined)
  }

  private async drain(): Promise<void> {
    while (!this.disposed) {
      const entityId = this.queue.shift()
      if (entityId === undefined) break
      try {
        const result = await this.options.setFocus(entityId)
        if (!this.disposed) this.options.onConfirmed(entityId, result)
      } catch (error) {
        if (!this.disposed) this.options.onError(error, entityId)
      }
    }
    if (!this.disposed) this.setPending(undefined)
  }

  private setPending(entityId: string | undefined): void {
    if (this.pending === entityId) return
    this.pending = entityId
    this.options.onPendingChange(entityId)
  }
}
