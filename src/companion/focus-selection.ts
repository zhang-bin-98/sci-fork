export interface FocusSelectionQueueOptions<T> {
  setFocus(entityId: string): Promise<T>
  isConfirmed?(entityId: string, result: T): boolean
  onConfirmed(entityId: string, result: T): void
  onPendingChange(entityId: string | undefined): void
  onError(error: unknown, entityId: string): void
}

/** Serializes graph clicks so a request in flight never hides a later selection. */
export class FocusSelectionQueue<T> {
  private readonly queue: Array<{
    entityId: string
    resolve(result: boolean): void
  }> = []
  private worker: Promise<void> | undefined
  private disposed = false
  private pending: string | undefined

  constructor(private readonly options: FocusSelectionQueueOptions<T>) {}

  get pendingEntityId(): string | undefined {
    return this.pending
  }

  select(entityId: string): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.queue.push({ entityId, resolve })
      this.setPending(entityId)
      if (this.worker === undefined) {
        this.worker = this.drain().finally(() => {
          this.worker = undefined
        })
      }
    })
  }

  idle(): Promise<void> {
    return this.worker ?? Promise.resolve()
  }

  dispose(): void {
    this.disposed = true
    for (const item of this.queue.splice(0)) item.resolve(false)
    this.setPending(undefined)
  }

  private async drain(): Promise<void> {
    while (!this.disposed) {
      const item = this.queue.shift()
      if (item === undefined) break
      try {
        const result = await this.options.setFocus(item.entityId)
        if (this.disposed) {
          item.resolve(false)
        } else if (
          this.options.isConfirmed !== undefined &&
          !this.options.isConfirmed(item.entityId, result)
        ) {
          this.options.onError(
            new Error('Focus confirmation did not match the requested entity.'),
            item.entityId,
          )
          item.resolve(false)
        } else {
          this.options.onConfirmed(item.entityId, result)
          item.resolve(true)
        }
      } catch (error) {
        if (!this.disposed) this.options.onError(error, item.entityId)
        item.resolve(false)
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
