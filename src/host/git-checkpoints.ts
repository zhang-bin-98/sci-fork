import { posix, win32 } from 'node:path'
import type { SubprocessPort } from './contracts.js'
import { MANIFEST_FILE, MANAGED_PATHS } from '../core/schema.js'

/** Fixed executable name resolved through the provider's scrubbed PATH. */
export const GIT_EXECUTABLE = 'git'

/** Termination grace for Git probes (SIGTERM → SIGKILL escalation window). */
export const GIT_GRACE_MS = 5000

/** Cap for collected stdout/stderr on Git probes. */
const GIT_OUTPUT_LIMIT = 64 * 1024

/**
 * Build one argv-only Git spec. Git is always invoked as a program with
 * explicit arguments; no shell string, no `-c`, no option injection from
 * research content.
 */
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

/**
 * Parse `git rev-parse --show-toplevel` output: exactly one absolute path.
 * Anything else (empty, multiple lines) is not a usable answer.
 */
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

/** One settled Git invocation. */
export interface GitRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Run git with explicit argv and collect bounded output. Throws when the
 * executable cannot be resolved or the spawn fails (callers map that to
 * GIT_UNAVAILABLE).
 */
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

/**
 * Run `git rev-parse --show-toplevel` in `cwd` through the DSH subprocess
 * service. Returns the repository top-level directory, or undefined when the
 * directory is not a repository or the output is ambiguous.
 */
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

/**
 * Parse `git status --porcelain` lines into `{code, path}` pairs, keeping
 * only the destination path of rename pairs.
 */
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
 * Initialization preflight (architecture §11.1): require an attached branch,
 * allow an unborn HEAD for a freshly initialized repository, and reject any
 * unmerged entry or dirty managed path before init writes anything.
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
  // A symbolic branch with no resolvable HEAD is the normal unborn state
  // immediately after `git init`; it is the only no-commit state init accepts.
  return { ok: true, branch, head: head.exitCode === 0 && headSha.length > 0 ? headSha : undefined }
}

/**
 * Mutation preflight (architecture §11): an attached, resolvable HEAD on a
 * real branch, no unmerged entries, and a clean managed tree. The returned
 * branch and HEAD seed undo-state recording.
 */
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
  const head = result.head
  if (head === undefined) {
    return { ok: false, code: 'GIT_STATE_UNSUPPORTED', reason: 'HEAD cannot be resolved' }
  }
  return { ok: true, branch: result.branch, head }
}

/**
 * Managed paths present in a file set, for pathspec operations. Git pathspec
 * commits fail on non-matching paths, so only existing paths are named
 * (empty managed directories are skipped; `git add` tolerates them).
 */
export function managedCheckpointPaths(files: ReadonlyMap<string, string>): string[] {
  const paths: string[] = []
  if (files.has(MANIFEST_FILE)) paths.push(MANIFEST_FILE)
  for (const dir of MANAGED_PATHS.slice(1)) {
    if ([...files.keys()].some((path) => path.startsWith(`${dir}/`))) paths.push(dir)
  }
  return paths
}

/**
 * Commit exactly the managed paths present in `paths` (architecture §11.2).
 * The files are staged first so the pathspec resolves on an unborn HEAD, then
 * `commit --only <paths>` commits them through a temporary index: unrelated
 * staged files stay staged and never enter the commit. Returns the new HEAD.
 */
export async function gitCheckpoint(
  subprocess: SubprocessPort,
  cwd: string,
  message: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<{ ok: true; head: string } | { ok: false; code: 'CHECKPOINT_FAILED'; committed?: boolean }> {
  let committed = false
  try {
    const add = await runGit(subprocess, ['add', '--', ...paths], cwd, signal)
    if (add.exitCode !== 0) return { ok: false, code: 'CHECKPOINT_FAILED' }
    const commit = await runGit(
      subprocess,
      ['commit', '--only', '-m', message, '--', ...paths],
      cwd,
      signal,
    )
    if (commit.exitCode !== 0) return { ok: false, code: 'CHECKPOINT_FAILED' }
    committed = true
    const head = await runGit(subprocess, ['rev-parse', 'HEAD'], cwd, signal)
    const headSha = head.stdout.trim()
    if (head.exitCode !== 0 || headSha.length === 0) return { ok: false, code: 'CHECKPOINT_FAILED', committed: true }
    return { ok: true, head: headSha }
  } catch {
    return committed ? { ok: false, code: 'CHECKPOINT_FAILED', committed: true } : { ok: false, code: 'CHECKPOINT_FAILED' }
  }
}

/**
 * List the managed files recorded in one commit, relative to the repo root.
 * `ls-tree` is run per managed path so a missing directory simply yields
 * nothing; undefined means the listing failed.
 */
export async function gitListManagedFiles(
  subprocess: SubprocessPort,
  cwd: string,
  ref: string,
  signal?: AbortSignal,
): Promise<string[] | undefined> {
  try {
    const files: string[] = []
    for (const path of MANAGED_PATHS) {
      const result = await runGit(subprocess, ['ls-tree', '-r', '--name-only', ref, '--', path], cwd, signal)
      if (result.exitCode !== 0) return undefined
      for (const line of result.stdout.split('\n')) {
        const trimmed = line.trim()
        if (trimmed === MANIFEST_FILE || MANAGED_PATHS.slice(1).some((dir) => trimmed.startsWith(`${dir}/`))) {
          files.push(trimmed)
        }
      }
    }
    return files
  } catch {
    return undefined
  }
}

/**
 * Restore the managed tree to a checkpoint's state (architecture §11.3):
 * `git checkout <source> -- <source paths>` resurrects and reverts the paths
 * recorded in the source, and `git rm -f` removes managed files that exist
 * now but not in the source. Those deletions are immediately unstaged so the
 * caller's scoped checkpoint can stage them together with restored files. The
 * caller commits the restored state as a new restore commit; history is never
 * rewritten.
 */
export async function gitRestoreManagedFrom(
  subprocess: SubprocessPort,
  cwd: string,
  source: string,
  sourcePaths: readonly string[],
  removePaths: readonly string[],
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    if (sourcePaths.length > 0) {
      const checkout = await runGit(subprocess, ['checkout', source, '--', ...sourcePaths], cwd, signal)
      if (checkout.exitCode !== 0) return false
    }
    for (const path of removePaths) {
      const removed = await runGit(subprocess, ['rm', '-f', '-q', '--', path], cwd, signal)
      if (removed.exitCode !== 0) return false
      // Keep the worktree deletion but leave staging to gitCheckpoint, whose
      // explicit path list also preserves unrelated staged files.
      const unstaged = await runGit(subprocess, ['restore', '--staged', '--', path], cwd, signal)
      if (unstaged.exitCode !== 0) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Compensation for a failed update checkpoint: restore one tracked path from
 * the committed HEAD, regardless of what a partially failed checkpoint left
 * in the index.
 */
export async function gitCheckoutPath(
  subprocess: SubprocessPort,
  cwd: string,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const result = await runGit(subprocess, ['checkout', 'HEAD', '--', path], cwd, signal)
    return result.exitCode === 0
  } catch {
    return false
  }
}

/**
 * Compensation for a failed create checkpoint: drop one path that a partial
 * checkpoint may have staged (`git rm -f`) and clean it if still untracked.
 */
export async function gitRemovePath(
  subprocess: SubprocessPort,
  cwd: string,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const result = await runGit(subprocess, ['rm', '-f', '-q', '--', path], cwd, signal)
    return result.exitCode === 0
  } catch {
    return false
  }
}

/** Compensation fallback: remove one untracked path. */
export async function gitCleanPath(
  subprocess: SubprocessPort,
  cwd: string,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const result = await runGit(subprocess, ['clean', '-f', '--', path], cwd, signal)
    return result.exitCode === 0
  } catch {
    return false
  }
}

/** Verify that one compensation target is absent from both index and worktree status. */
export async function gitPathIsClean(
  subprocess: SubprocessPort,
  cwd: string,
  path: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const result = await runGit(subprocess, ['status', '--porcelain', '--', path], cwd, signal)
    return result.exitCode === 0 && parsePorcelainStatus(result.stdout).length === 0
  } catch {
    return false
  }
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
    return (
      name.exitCode === 0 &&
      name.stdout.trim().length > 0 &&
      email.exitCode === 0 &&
      email.stdout.trim().length > 0
    )
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

export function backMessage(checkpointId: string): string {
  return `scifork: back to ${checkpointId.slice(0, 12)}`
}

export function forwardMessage(checkpointId: string): string {
  return `scifork: forward to ${checkpointId.slice(0, 12)}`
}
