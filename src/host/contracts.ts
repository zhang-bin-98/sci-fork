import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Structural DSH contracts pinned against DeepSeek Harness 0.1.1-rc.2.
 *
 * The spike keeps the bundle dependency-free. These declarations mirror the
 * pinned package types, with package-relative provenance noted per interface.
 */

/**
 * dsh-host-webserver/lib/types/index.d.ts — WebRoute, WebServer.register.
 * Duplicate (kind, path) throws; the returned disposer removes the route.
 */
export interface WebRoute {
  kind: 'exact' | 'prefix'
  /** Absolute pathname, no trailing slash. */
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface WebServerPort {
  readonly host: '127.0.0.1' | '0.0.0.0'
  register(route: WebRoute): () => void
}

/**
 * dsh-skill/lib/types/index.d.ts — SkillRegistration (lines 81-86) with
 * SkillDefinition/SkillSummary members. Runtime contributions use
 * source 'runtime'; the filesystem provider never scans npm packages, so a
 * plugin package registers its skills in apply().
 */
export interface SkillInvocationPolicy {
  modelInvocable: boolean
  userInvocable: boolean
}

export interface SkillRegistration {
  name: string
  description: string
  whenToUse?: string
  content: string
  source: string
  invocation?: SkillInvocationPolicy
  provider?: string
  path?: string
  metadata?: Readonly<Record<string, unknown>>
}

export interface SkillsPort {
  register(skill: SkillRegistration): () => void
}

/**
 * dsh-subprocess/lib/types/types.d.ts — SubprocessSpawnSpec and
 * SubprocessHandle (collect-mode subset used by the Git adapter).
 * argv is never shell-interpreted; every stdio disposition is explicit.
 */
export interface SubprocessCollectSpec {
  maxBytes: number
}

export interface SubprocessSpawnSpec {
  argv: readonly string[]
  cwd: string
  stdio: {
    stdin: 'ignore'
    stdout: SubprocessCollectSpec
    stderr: SubprocessCollectSpec
  }
  graceMs: number
  signal?: AbortSignal
  env?: Record<string, string | undefined>
}

export interface SubprocessOutputRead {
  text: string
  nextOffset: number
  lossy: boolean
  spillPath?: string
}

export interface SubprocessOutputReader {
  readFrom(fromByte: number): SubprocessOutputRead
}

export interface SubprocessOutcome {
  exitCode: number | null
  signal: string | null
}

export interface SubprocessHandle {
  pid: number
  collected: {
    stdout?: SubprocessOutputReader
    stderr?: SubprocessOutputReader
  }
  done: Promise<SubprocessOutcome>
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

export interface SubprocessPort {
  resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string>
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

/**
 * dsh-fs/lib/types/index.d.ts + types.d.ts — FileSystem service (`ctx.fs`).
 * Targets are opaque; processPath() yields the absolute path for subprocess
 * cwd. All research file content reads/writes go through this service.
 */
export interface FsTarget {
  readonly targetKey: unknown
  readonly displayPath: string
}

export interface FsInfo {
  readonly version: unknown
  readonly type: 'file' | 'directory' | 'other'
  readonly size?: number
}

export interface FsDirEntry {
  readonly name: string
  readonly type: 'file' | 'directory' | 'other'
  readonly target: FsTarget
  readonly version?: unknown
  readonly size?: number
}

export type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: unknown }

export interface FsWriteOutcome {
  readonly operation: 'create' | 'update'
  readonly version: unknown
  readonly before: string | null
  readonly after: string
}

export interface FsPort {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
  processPath(target: FsTarget): string
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
  listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
  writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome>
  contains(parent: FsTarget, child: FsTarget): boolean
}

/** The FsError.code value a guarded write reports when the target moved. */
export function isFsStaleError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return code === 'FS_STALE_VERSION' || code === 'FS_NOT_OBSERVED'
}

/**
 * dsh-tools/lib/types/index.d.ts + schema.d.ts + json-schema.d.ts —
 * ToolRuntime (`ctx.tools`). parameters is a raw JSON Schema object (the
 * enforced subset); an unconstrained output uses the raw annotation-only
 * schema `{}`. The author-level `{ type: 'json' }` spelling is compiled by
 * DSH's typed helper and must not be passed to `register` directly.
 */
export interface ContentBlock {
  type: 'text'
  text: string
}

export interface ToolOutputDefinition {
  schema: Record<string, unknown>
  render(args: unknown, value: unknown): ContentBlock[]
}

export interface ToolRunContext {
  readonly agent?: {
    readonly id?: string
    readonly session?: { readonly header?: { readonly cwd?: string } }
  }
  readonly signal: AbortSignal
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: ToolOutputDefinition
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  timeoutMs?: number
  isConcurrencySafe?(args: unknown): boolean
}

export interface ToolsPort {
  register(definition: ToolDefinition): () => void
}

/**
 * dsh-storage-domain/lib/types/*.d.ts — DomainFacility (`ctx.storageDomain`).
 * Record schemas are zod; open is async and the caller closes the domain via
 * its own disposer.
 */
export interface DomainTableSpec {
  valueSchema: { parse(value: unknown): unknown }
}

export interface DomainSpec {
  name: string
  version: number
  tables: Record<string, DomainTableSpec>
}

export interface KvTable<V> {
  get(key: string): V | undefined
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<boolean>
  update(key: string, fn: (current: V) => V): Promise<V>
  entries(): IterableIterator<[string, V]>
  readonly size: number
}

export interface StorageDomain {
  table(name: string): KvTable<unknown>
  close(): Promise<void>
}

export interface StorageDomainPort {
  open(spec: DomainSpec): Promise<StorageDomain>
}

/**
 * dsh-commands/lib/types/index.d.ts + types.d.ts — CommandRuntime
 * (`ctx.commands`) for human slash commands. invocation.agent carries the
 * session header whose cwd locates the research project.
 */
export interface CommandInvocation {
  readonly agent?: {
    readonly id?: string
    readonly session?: { readonly header?: { readonly cwd?: string } }
  }
  readonly rawInput: string
  readonly signal: AbortSignal
}

export type CommandResult =
  | { kind: 'success'; text?: string }
  | { kind: 'error'; text: string }

export interface CommandDefinition {
  name: string
  description: string
  input?: { hint: string }
  handler(invocation: CommandInvocation): CommandResult | Promise<CommandResult>
}

export interface CommandsPort {
  register(definition: CommandDefinition): () => void
}

/**
 * dsh-session/lib/types/index.d.ts - live SessionStore subset pinned for M2.
 * The immutable header cwd is the only project-location input accepted by the
 * Companion launch flow.
 */
export interface SessionPort {
  readonly id: string
  readonly header: { readonly cwd?: string }
}

export interface SessionsPort {
  get(id: string): SessionPort | undefined
}

/** dsh-session public event augmentation used to revoke Session-bound keys. */
export interface SessionLifecyclePort {
  on(name: 'session/disposed', listener: (session: SessionPort) => void): unknown
}
