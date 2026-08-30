import { posix, win32 } from 'node:path'
import type { SubprocessPort } from './contracts.js'
import { EDGE_ID_RE, MANAGED_PATHS, NODE_ID_RE, entityFilePath } from '../core/schema.js'

/** Fixed executable name resolved through the provider's scrubbed PATH. */
export const GIT_EXECUTABLE = 'git'

/** Termination grace for Git probes (SIGTERM -> SIGKILL escalation window). */
export const GIT_GRACE_MS = 5000

/** Cap for collected stdout/stderr on Git probes. */
const GIT_OUTPUT_LIMIT = 64 * 1024

/** Build one argv-only Git invocation; research content never becomes a shell string. */
export function buildGitArgv(
  gitExecutable: string,
  args: readonly string[],
  cwd: string,
): { argv: readonly string[]; cwd: string } {
  if (!gitExecutable) throw new Error('scifork: git executable must not be empty')
  if (!cwd) throw new Error('scifork: git cwd must not be empty')
  for (const arg of args) {
    if (arg.includes('\0')) throw new Error('scifork: git argument contains NUL byte')
  }
  return { argv: [gitExecutable, ...args], cwd }
}

/** Parse `git rev-parse --show-toplevel`: exactly one absolute path. */
export function parseRevParseToplevel(output: string): string | undefined {
  const trimmed = output.trim()
  if (
    !trimmed ||
    trimmed.includes('\n') ||
    (!win32.isAbsolute(trimmed) && !posix.isAbsolute(trimmed))
  ) return undefined
  return trimmed
}

function comparablePath(path: string): string {
  const slashPath = path.replaceAll('\\', '/')
  const trimmed = slashPath.length > 1 ? slashPath.replace(/\/+$/, '') : slashPath
  return win32.isAbsolute(path) || /^[A-Za-z]:\//.test(trimmed)
    ? trimmed.toLowerCase()
    : trimmed
}

function sameRepositoryRoot(actual: string, cwd: string): boolean {
  return comparablePath(actual) === comparablePath(cwd)
}

export interface GitRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Run one bounded, argv-only Git invocation through the DSH subprocess service. */
export async function runGit(
  subprocess: SubprocessPort,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<GitRunResult> {
  const executable = await subprocess.resolveExecutable(GIT_EXECUTABLE, undefined, signal)
  const spec = {
    ...buildGitArgv(executable, args, cwd),
    stdio: {
      stdin: 'ignore' as const,
      stdout: { maxBytes: GIT_OUTPUT_LIMIT },
      stderr: { maxBytes: GIT_OUTPUT_LIMIT },
    },
    graceMs: GIT_GRACE_MS,
    ...(signal !== undefined ? { signal } : {}),
  }
  const handle = subprocess.spawn(spec)
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout?.lossy === true || stderr?.lossy === true) {
    throw new Error('scifork: git output was truncated')
  }
  return {
    exitCode: outcome.exitCode ?? 128,
    stdout: stdout?.text ?? '',
    stderr: stderr?.text ?? '',
  }
}

/** Return the repository top level, or undefined for an unusable Git answer. */
export async function gitShowToplevel(
  subprocess: SubprocessPort,
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const result = await runGit(subprocess, ['rev-parse', '--show-toplevel'], cwd, signal)
    if (result.exitCode !== 0) return undefined
    return parseRevParseToplevel(result.stdout)
  } catch {
    return undefined
  }
}

/** Parse Git porcelain status, retaining the destination of rename pairs. */
export function parsePorcelainStatus(output: string): { code: string; path: string }[] {
  const entries: { code: string; path: string }[] = []
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.length < 4 || line.startsWith('##')) continue
    const code = line.slice(0, 2)
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const path = arrow === -1 ? rest : rest.slice(arrow + 4)
    if (path.length > 0) entries.push({ code, path })
  }
  return entries
}

export type GitPreflightResult =
  | { ok: true; branch: string; head: string }
  | { ok: false; code: 'PROJECT_REPOSITORY_MISMATCH' | 'GIT_UNAVAILABLE' | 'GIT_STATE_UNSUPPORTED' | 'READ_ONLY_CONFLICT'; reason: string }

export type GitInitPreflightResult =
  | { ok: true; branch: string; head: string | undefined }
  | { ok: false; code: 'PROJECT_REPOSITORY_MISMATCH' | 'GIT_UNAVAILABLE' | 'GIT_STATE_UNSUPPORTED' | 'READ_ONLY_CONFLICT'; reason: string }

/**
 * Initialization preflight: require an attached branch, allow an unborn HEAD,
 * and reject unmerged entries or dirty managed paths before writing.
 */
export async function gitInitPreflight(
  subprocess: SubprocessPort,
  cwd: string,
  signal?: AbortSignal,
): Promise<GitInitPreflightResult> {
  let symbolic: GitRunResult
  try {
    symbolic = await runGit(subprocess, ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, signal)
  } catch {
    return { ok: false, code: 'GIT_UNAVAILABLE', reason: 'git is not available' }
  }
  const branch = symbolic.stdout.trim()
  if (symbolic.exitCode !== 0 || branch.length === 0) {
    return { ok: false, code: 'GIT_STATE_UNSUPPORTED', reason: 'HEAD is detached or unborn' }
  }

  let head: GitRunResult
  let unmerged: GitRunResult
  let status: GitRunResult
  try {
    head = await runGit(subprocess, ['rev-parse', '--verify', 'HEAD'], cwd, signal)
    unmerged = await runGit(subprocess, ['ls-files', '-u'], cwd, signal)
    status = await runGit(subprocess, ['status', '--porcelain', '--', ...MANAGED_PATHS], cwd, signal)
  } catch {
    return { ok: false, code: 'GIT_UNAVAILABLE', reason: 'git is not available' }
  }
  if (unmerged.exitCode !== 0) {
    return { ok: false, code: 'GIT_UNAVAILABLE', reason: 'unmerged-entry check failed' }
  }
  if (unmerged.stdout.trim().length > 0) {
    return { ok: false, code: 'GIT_STATE_UNSUPPORTED', reason: 'the repository has unmerged entries' }
  }
  if (status.exitCode !== 0) {
    return { ok: false, code: 'GIT_UNAVAILABLE', reason: 'managed-path status check failed' }
  }
  if (parsePorcelainStatus(status.stdout).length > 0) {
    return { ok: false, code: 'READ_ONLY_CONFLICT', reason: 'managed paths have uncommitted changes' }
  }
  const headSha = head.stdout.trim()
  return { ok: true, branch, head: head.exitCode === 0 && headSha.length > 0 ? headSha : undefined }
}

/** Mutation preflight: project-root repository, attached branch, resolvable HEAD, and clean managed paths. */
export async function gitPreflight(
  subprocess: SubprocessPort,
  cwd: string,
  signal?: AbortSignal,
): Promise<GitPreflightResult> {
  try {
    const repository = await runGit(subprocess, ['rev-parse', '--show-toplevel'], cwd, signal)
    if (repository.exitCode !== 0) {
      return { ok: false, code: 'GIT_UNAVAILABLE', reason: 'the project is not in a git repository' }
    }
    const repositoryRoot = parseRevParseToplevel(repository.stdout)
    if (repositoryRoot === undefined) {
      return { ok: false, code: 'GIT_UNAVAILABLE', reason: 'the project repository root could not be determined' }
    }
    if (!sameRepositoryRoot(repositoryRoot, cwd)) {
      return { ok: false, code: 'PROJECT_REPOSITORY_MISMATCH', reason: 'the research project lies inside an unrelated git repository' }
    }
  } catch {
    return { ok: false, code: 'GIT_UNAVAILABLE', reason: 'git is not available' }
  }

  const result = await gitInitPreflight(subprocess, cwd, signal)
  if (!result.ok) return result
  if (result.head === undefined) {
    return { ok: false, code: 'GIT_STATE_UNSUPPORTED', reason: 'HEAD cannot be resolved' }
  }
  return { ok: true, branch: result.branch, head: result.head }
}

type GitCheckpointResult =
  | { ok: true; head: string }
  | { ok: false; code: 'CHECKPOINT_FAILED'; committed?: boolean }

async function commitCheckpoint(
  subprocess: SubprocessPort,
  cwd: string,
  message: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<GitCheckpointResult> {
  let committed = false
  try {
    const commit = await runGit(subprocess, ['commit', '--only', '-m', message, '--', ...paths], cwd, signal)
    if (commit.exitCode !== 0) return { ok: false, code: 'CHECKPOINT_FAILED' }
    committed = true
    const head = await runGit(subprocess, ['rev-parse', 'HEAD'], cwd, signal)
    const headSha = head.stdout.trim()
    if (head.exitCode !== 0 || headSha.length === 0) {
      return { ok: false, code: 'CHECKPOINT_FAILED', committed: true }
    }
    return { ok: true, head: headSha }
  } catch {
    return committed
      ? { ok: false, code: 'CHECKPOINT_FAILED', committed: true }
      : { ok: false, code: 'CHECKPOINT_FAILED' }
  }
}

/**
 * Commit exactly the supplied managed pathspecs. Staging happens first so a
 * pathspec also works on an unborn repository; `commit --only` preserves any
 * unrelated staged work. No rollback is attempted when this operation fails.
 */
export async function gitCheckpoint(
  subprocess: SubprocessPort,
  cwd: string,
  message: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<GitCheckpointResult> {
  try {
    const add = await runGit(subprocess, ['add', '--', ...paths], cwd, signal)
    if (add.exitCode !== 0) return { ok: false, code: 'CHECKPOINT_FAILED' }
  } catch {
    return { ok: false, code: 'CHECKPOINT_FAILED' }
  }
  return commitCheckpoint(subprocess, cwd, message, paths, signal)
}

function deletableManagedPath(path: string): boolean {
  const name = path.split('/').at(-1)
  if (name === undefined) return false
  const id = name.endsWith('.md')
    ? name.slice(0, -'.md'.length)
    : name.endsWith('.json')
      ? name.slice(0, -'.json'.length)
      : ''
  if (!NODE_ID_RE.test(id) && !EDGE_ID_RE.test(id)) return false
  return entityFilePath(id) === path
}

/** Remove one Core-derived Node/Edge path through fixed, argv-only Git. */
export async function gitRemoveManagedPath(
  subprocess: SubprocessPort,
  cwd: string,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!deletableManagedPath(path)) return false
  try {
    const result = await runGit(subprocess, ['rm', '--', path], cwd, signal)
    return result.exitCode === 0
  } catch {
    return false
  }
}

/** Commit one exact deletion already staged by gitRemoveManagedPath. */
export async function gitCheckpointManagedDeletion(
  subprocess: SubprocessPort,
  cwd: string,
  message: string,
  path: string,
  signal?: AbortSignal,
): Promise<GitCheckpointResult> {
  if (!deletableManagedPath(path)) return { ok: false, code: 'CHECKPOINT_FAILED' }
  return commitCheckpoint(subprocess, cwd, message, [path], signal)
}

/** Plain `git init` in the project directory; never touches global config. */
export async function gitInit(
  subprocess: SubprocessPort,
  cwd: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const result = await runGit(subprocess, ['init'], cwd, signal)
    return result.exitCode === 0
  } catch {
    return false
  }
}

/** Whether user.name and user.email resolve anywhere (repo or global). */
export async function gitIdentityConfigured(
  subprocess: SubprocessPort,
  cwd: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const name = await runGit(subprocess, ['config', '--get', 'user.name'], cwd, signal)
    const email = await runGit(subprocess, ['config', '--get', 'user.email'], cwd, signal)
    return name.exitCode === 0 && name.stdout.trim().length > 0 && email.exitCode === 0 && email.stdout.trim().length > 0
  } catch {
    return false
  }
}

/** Stable checkpoint commit subjects; never carry research content. */
export function checkpointMessage(kind: string, entityId: string): string {
  return `scifork: ${kind} ${entityId}`
}

export function initCheckpointMessage(): string {
  return 'scifork: init'
}
