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
