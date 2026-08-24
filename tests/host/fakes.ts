import type {
  CommandDefinition,
  CommandsPort,
  FsDirEntry,
  FsInfo,
  FsPort,
  FsTarget,
  FsWriteIntent,
  FsWriteOutcome,
  StorageDomain,
  StorageDomainPort,
  SubprocessPort,
  ToolDefinition,
  ToolsPort,
} from '../../src/host/contracts.js'

/**
 * Structural test doubles for the pinned DSH service faces. All state is
 * in-memory and all async work resolves immediately; paths use POSIX form.
 */

// ------------------------------------------------------------------ FakeFs

export class FakeFs implements FsPort {
  private readonly files = new Map<string, { content: string; version: number }>()
  private readonly dirs = new Set<string>(['/'])
  private versionCounter = 1

  constructor(entries: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(entries)) this.writeDirect(path, content)
  }

  private normalize(path: string, cwd?: string): string {
    const base = path.startsWith('/') ? path : `${cwd ?? '/'}/${path}`
    const parts = base.split('/').filter((part) => part !== '' && part !== '.')
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '..') resolved.pop()
      else resolved.push(part)
    }
    return `/${resolved.join('/')}`
  }

  private writeDirect(path: string, content: string): void {
    this.files.set(path, { content, version: this.versionCounter++ })
    const segments = path.split('/').slice(1, -1)
    let current = ''
    for (const segment of segments) {
      current += `/${segment}`
      this.dirs.add(current)
    }
  }

  resolve(path: string, opts?: { cwd?: string }): Promise<FsTarget> {
    const resolved = this.normalize(path, opts?.cwd)
    return Promise.resolve({ targetKey: `key:${resolved}`, displayPath: resolved })
  }

  processPath(target: FsTarget): string {
    return target.displayPath
  }

  stat(target: FsTarget): Promise<FsInfo | undefined> {
    const file = this.files.get(target.displayPath)
    if (file !== undefined) {
      return Promise.resolve({ version: file.version, type: 'file', size: file.content.length })
    }
    if (this.dirs.has(target.displayPath)) {
      return Promise.resolve({ version: 0, type: 'directory' })
    }
    return Promise.resolve(undefined)
  }

  listDir(target: FsTarget): Promise<FsDirEntry[]> {
    const prefix = target.displayPath === '/' ? '/' : `${target.displayPath}/`
    const names = new Set<string>()
    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length)
        names.add(rest.split('/')[0] ?? '')
      }
    }
    for (const dir of this.dirs) {
      if (dir !== target.displayPath && dir.startsWith(prefix)) {
        const rest = dir.slice(prefix.length)
        const name = rest.split('/')[0]
        if (name !== undefined && name !== '') names.add(name)
      }
    }
    return Promise.resolve(
      [...names]
        .filter((name) => name !== '')
        .sort()
        .map((name) => {
          const path = `${prefix}${name}`
          const isFile = this.files.has(path)
          const isDir = this.dirs.has(path)
          const file = isFile ? this.files.get(path) : undefined
          return {
            name,
            type: isFile ? 'file' : isDir ? 'directory' : 'other',
            target: { targetKey: `key:${path}`, displayPath: path },
            ...(file !== undefined ? { version: file.version, size: file.content.length } : {}),
          }
        }),
    )
  }

  readText(target: FsTarget): Promise<string> {
    const file = this.files.get(target.displayPath)
    if (file === undefined) {
      return Promise.reject(Object.assign(new Error('not found'), { code: 'FS_NOT_FOUND' }))
    }
    return Promise.resolve(file.content)
  }

  writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
  ): Promise<FsWriteOutcome> {
    this.onBeforeWrite?.(target.displayPath)
    const existing = this.files.get(target.displayPath)
    if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      return Promise.reject(Object.assign(new Error('already exists'), { code: 'FS_NOT_OBSERVED' }))
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (existing === undefined || existing.version !== (expected.version as number)) {
        return Promise.reject(Object.assign(new Error('stale version'), { code: 'FS_STALE_VERSION' }))
      }
    }
    const before = existing?.content ?? null
    this.writeDirect(target.displayPath, content)
    const after = this.files.get(target.displayPath)!
    return Promise.resolve({ operation: existing ? 'update' : 'create', version: after.version, before, after: after.content })
  }

  /** Hook run synchronously before every guarded write (race simulation). */
  onBeforeWrite?: (path: string) => void

  /** Simulate an external writer replacing a file. */
  writeExternal(path: string, content: string): void {
    this.writeDirect(path, content)
  }

  contains(parent: FsTarget, child: FsTarget): boolean {
    return (
      child.displayPath === parent.displayPath ||
      child.displayPath.startsWith(`${parent.displayPath === '/' ? '' : parent.displayPath}/`)
    )
  }

  /** Test-only direct access. */
  contentOf(path: string): string | undefined {
    return this.files.get(path)?.content
  }

  deleteFile(path: string): void {
    this.files.delete(path)
  }

  entries(): ReadonlyMap<string, string> {
    return new Map([...this.files.entries()].map(([path, file]) => [path, file.content]))
  }
}

// --------------------------------------------------------------- scripted git

export function scriptedGit(
  responder: (argv: readonly string[], cwd: string) => { exitCode?: number; stdout?: string },
): { port: SubprocessPort; calls: string[][] } {
  const calls: string[][] = []
  const port: SubprocessPort = {
    async resolveExecutable() {
      return 'C:\\git\\git.exe'
    },
    spawn(spec) {
      calls.push([...spec.argv])
      const response = responder(spec.argv, spec.cwd)
      return {
        pid: 1,
        collected: {
          stdout: {
            readFrom() {
              return { text: response.stdout ?? '', nextOffset: 0, lossy: false }
            },
          },
          stderr: {
            readFrom() {
              return { text: '', nextOffset: 0, lossy: false }
            },
          },
        },
        done: Promise.resolve({ exitCode: response.exitCode ?? 0, signal: null }),
        terminate() {},
        async waitForExit() {
          return true
        },
      }
    },
  }
  return { port, calls }
}

// --------------------------------------------------------- fake storage domain

export interface FakeDomainTable<V> {
  get(key: string): V | undefined
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<boolean>
  update(key: string, fn: (current: V) => V): Promise<V>
  entries(): IterableIterator<[string, V]>
  size: number
  records: Map<string, V>
}

export function fakeDomainTable<V>(records = new Map<string, V>()): FakeDomainTable<V> {
  return {
    records,
    get(key) {
      return records.get(key)
    },
    async put(key, value) {
      records.set(key, value)
    },
    async delete(key) {
      return records.delete(key)
    },
    async update(key, fn) {
      const current = records.get(key)
      if (current === undefined) throw new Error('missing-key')
      const next = fn(current)
      records.set(key, next)
      return next
    },
    entries() {
      return records.entries()
    },
    get size() {
      return records.size
    },
  }
}

export class FakeStorageDomainPort implements StorageDomainPort {
  readonly tables = new Map<string, FakeDomainTable<unknown>>()
  openedSpecs: unknown[] = []
  closedCount = 0

  async open(spec: { name: string; tables: Record<string, unknown> }): Promise<StorageDomain> {
    this.openedSpecs.push(spec)
    const port = this
    const handles = new Map<string, FakeDomainTable<unknown>>()
    for (const name of Object.keys(spec.tables)) {
      const table = fakeDomainTable<unknown>()
      this.tables.set(`${spec.name}:${name}`, table)
      handles.set(name, table)
    }
    return {
      table(name: string) {
        const table = handles.get(name)
        if (table === undefined) throw new Error(`unknown table ${name}`)
        return table
      },
      close: async () => {
        port.closedCount += 1
      },
    }
  }

  tableOf(domain: string, name: string): FakeDomainTable<unknown> | undefined {
    return this.tables.get(`${domain}:${name}`)
  }
}

// ----------------------------------------------------- fake tools / commands

export class FakeToolsPort implements ToolsPort {
  readonly definitions: ToolDefinition[] = []
  readonly disposals: ToolDefinition[] = []

  register(definition: ToolDefinition): () => void {
    this.definitions.push(definition)
    return () => {
      this.disposals.push(definition)
    }
  }
}

export class FakeCommandsPort implements CommandsPort {
  readonly definitions: CommandDefinition[] = []
  readonly disposals: CommandDefinition[] = []

  register(definition: CommandDefinition): () => void {
    this.definitions.push(definition)
    return () => {
      this.disposals.push(definition)
    }
  }
}
