import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseAndValidateProject } from '../core/validator.js'
import type { LoadedProject } from '../core/parser.js'
import { planCommand, type ResearchCommand } from '../core/commands.js'
import type { HashFn } from '../core/revision.js'
import { MANIFEST_FILE, MANAGED_PATHS, type ResearchManifest } from '../core/schema.js'
import type { FsPort, FsTarget, StorageDomain, SubprocessPort } from './contracts.js'
import {
  backMessage,
  checkpointMessage,
  forwardMessage,
  gitCheckoutPath,
  gitCheckpoint,
  gitCleanPath,
  gitIdentityConfigured,
  gitInit,
  gitInitPreflight,
  gitListManagedFiles,
  gitPathIsClean,
  gitPreflight,
  gitRemovePath,
  gitRestoreManagedFrom,
  gitShowToplevel,
  initCheckpointMessage,
  managedCheckpointPaths,
  type GitPreflightResult,
} from './git-checkpoints.js'
import { canInitProject, locateProject } from './project-locator.js'
import { readManagedFileSnapshot, readManagedFiles, writeManagedFile } from './research-store.js'
import {
  loadUndoRecord,
  MutationQueue,
  writeUndo,
  type UndoRecord,
} from './ui-state.js'

/**
 * Mutation pipeline and one-step navigation (architecture §6.1/§11):
 * parse → revision guard → git preflight → command plan → atomic write →
 * re-parse → checkpoint → undo-state record. Every failure path either
 * leaves the tree untouched or compensates the single written file.
 */

export type SciForkFailureCode =
  | 'PROJECT_NOT_INITIALIZED'
  | 'PROJECT_REPOSITORY_MISMATCH'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INVALID_ENTITY'
  | 'INVALID_IMPORT_DRAFT'
  | 'STALE_REVISION'
  | 'STALE_TARGET'
  | 'READ_ONLY_CONFLICT'
  | 'GIT_UNAVAILABLE'
  | 'GIT_STATE_UNSUPPORTED'
  | 'CHECKPOINT_FAILED'
  | 'SESSION_UNAVAILABLE'

export interface SciForkFailure {
  ok: false
  code: SciForkFailureCode
  message: string
  recoverable: boolean
  entityId?: string
}

export interface ResearchHostDeps {
  fs: FsPort
  subprocess: SubprocessPort
  storage: StorageDomain
  hash: HashFn
}

interface ProjectContext {
  root: string
  manifest: ResearchManifest | undefined
  project: LoadedProject
  branch: string | undefined
  head: string | undefined
  undo: UndoRecord | undefined
  gitFailure?: Extract<GitPreflightResult, { ok: false }>
}

const queue = new MutationQueue()

function fail(
  code: SciForkFailureCode,
  message: string,
  recoverable = true,
  entityId?: string,
): SciForkFailure {
  return entityId !== undefined ? { ok: false, code, message, recoverable, entityId } : { ok: false, code, message, recoverable }
}

function sameManagedFiles(
  actual: ReadonlyMap<string, string>,
  expected: ReadonlyMap<string, string>,
): boolean {
  if (actual.size !== expected.size) return false
  for (const [path, content] of expected) {
    if (actual.get(path) !== content) return false
  }
  return true
}

/**
 * Load the current project state for one session cwd. Reads stay lock-free;
 * git state is best-effort (read operations work without a repository).
 */
export async function loadProjectState(
  deps: ResearchHostDeps,
  sessionCwd: string | undefined,
  signal?: AbortSignal,
): Promise<ProjectContext | SciForkFailure> {
  const located = await locateProject(
    { fs: deps.fs, gitToplevel: (cwd, sig) => gitShowToplevel(deps.subprocess, cwd, sig) },
    sessionCwd,
    signal,
  )
  if (!located.ok) return fail(located.code, located.message, false)
  let files: ReadonlyMap<string, string>
  try {
    files = await readManagedFiles(deps.fs, located.root, signal)
  } catch {
    return fail('INVALID_ENTITY', 'managed project files could not be read safely', false)
  }
  const project = parseAndValidateProject(files, deps.hash)
  const preflight = await gitPreflight(deps.subprocess, located.root, signal)
  if (!preflight.ok) {
    return {
      root: located.root,
      manifest: project.manifest,
      project,
      branch: undefined,
      head: undefined,
      undo: undefined,
      gitFailure: preflight,
    }
  }
  const projectId = project.manifest?.project_id
  const undo = projectId !== undefined
    ? await loadUndoRecord(deps.storage, projectId, preflight.branch, preflight.head)
    : undefined
  return {
    root: located.root,
    manifest: project.manifest,
    project,
    branch: preflight.branch,
    head: preflight.head,
    undo,
  }
}

async function compensate(
  fs: FsPort,
  subprocess: SubprocessPort,
  root: string,
  plan: { path: string; writeKind: 'create' | 'update'; content: string },
  signal?: AbortSignal,
): Promise<boolean> {
  // Never undo a write after another actor has changed its result.  Git
  // checkout/rm are destructive, so an ownership check immediately before
  // compensation is the last safe point available to this adapter.
  let rootTarget: FsTarget
  let target: FsTarget
  try {
    rootTarget = await fs.resolve(root, signal !== undefined ? { signal } : {})
    target = await fs.resolve(plan.path, { cwd: root, ...(signal !== undefined ? { signal } : {}) })
    if (!fs.contains(rootTarget, target)) return false
    const info = await fs.stat(target, signal)
    if (info === undefined) {
      // A create that has already disappeared needs no destructive cleanup;
      // only claim success when Git also sees the path as clean.
      return plan.writeKind === 'create' && await gitPathIsClean(subprocess, root, plan.path, signal)
    }
    if (info.type !== 'file' || await fs.readText(target, signal) !== plan.content) return false
  } catch {
    return false
  }
  if (plan.writeKind === 'create') {
    const removed = await gitRemovePath(subprocess, root, plan.path, signal)
    const cleaned = await gitCleanPath(subprocess, root, plan.path, signal)
    if (!removed && !cleaned) return false
    try {
      if (!fs.contains(rootTarget, target) || await fs.stat(target, signal) !== undefined) return false
    } catch {
      return false
    }
    return gitPathIsClean(subprocess, root, plan.path, signal)
  } else {
    if (!await gitCheckoutPath(subprocess, root, plan.path, signal)) return false
    try {
      const restored = await fs.resolve(plan.path, { cwd: root, ...(signal !== undefined ? { signal } : {}) })
      if (!fs.contains(rootTarget, restored) || await fs.stat(restored, signal) === undefined) return false
    } catch {
      return false
    }
    return gitPathIsClean(subprocess, root, plan.path, signal)
  }
}

export interface ApplyCommandInput {
  sessionId: string
  sessionCwd: string | undefined
  command: ResearchCommand
  expectedProjectRevision: string
  signal?: AbortSignal
}

export type ApplyOutcome =
  | { ok: true; kind: string; entityId: string; revision: string; checkpointId: string }
  | SciForkFailure

/**
 * Apply one typed command: exactly one entity file plus one checkpoint.
 */
export async function applyCommand(deps: ResearchHostDeps, input: ApplyCommandInput): Promise<ApplyOutcome> {
  const located = await locateProject(
    { fs: deps.fs, gitToplevel: (cwd, sig) => gitShowToplevel(deps.subprocess, cwd, sig) },
    input.sessionCwd,
    input.signal,
  )
  if (!located.ok) return fail(located.code, located.message, false)
  return queue.run(located.root, async (): Promise<ApplyOutcome> => {
    let snapshot
    try {
      snapshot = await readManagedFileSnapshot(deps.fs, located.root, input.signal)
    } catch {
      return fail('INVALID_ENTITY', 'managed project files could not be read safely', false)
    }
    const project = parseAndValidateProject(snapshot.files, deps.hash)
    if (project.diagnostics.length > 0) {
      const first = project.diagnostics[0]!
      return fail('INVALID_ENTITY', `project is invalid: ${first.code} at ${first.path || 'project'}`, false)
    }
    if (input.expectedProjectRevision !== project.projectRevision) {
      return fail('STALE_REVISION', 'the project changed; re-read the graph before applying')
    }
    const preflight = await gitPreflight(deps.subprocess, located.root, input.signal)
    if (!preflight.ok) return fail(preflight.code, preflight.reason, preflight.code !== 'READ_ONLY_CONFLICT')
    const plan = planCommand(project, input.command, deps.hash)
    if (!plan.ok) {
      const first = plan.issues[0] ?? { code: 'INVALID_ENTITY', message: 'command could not be planned' }
      const code = first.code === 'STALE_TARGET' || first.code === 'INVALID_IMPORT_DRAFT'
        ? first.code
        : 'INVALID_ENTITY'
      return fail(code, first.message, true, first.entityId)
    }
    const written = await writeManagedFile(
      deps.fs,
      located.root,
      plan.path,
      plan.content,
      plan.writeKind,
      input.signal,
      snapshot.versions.get(plan.path),
    )
    if (!written.ok) {
      return fail(written.code, 'the target file changed; re-read the graph before applying')
    }
    let afterFiles: ReadonlyMap<string, string>
    try {
      afterFiles = await readManagedFiles(deps.fs, located.root, input.signal)
    } catch {
      const rolledBack = await compensate(deps.fs, deps.subprocess, located.root, plan, input.signal)
      return rolledBack
        ? fail('INVALID_ENTITY', 'the written entity could not be re-read; the write was rolled back', false)
        : fail('CHECKPOINT_FAILED', 'the written entity could not be re-read and rollback failed; manual recovery is required', false)
    }
    const expectedFiles = new Map(snapshot.files)
    expectedFiles.set(plan.path, plan.content)
    if (!sameManagedFiles(afterFiles, expectedFiles)) {
      const rolledBack = await compensate(deps.fs, deps.subprocess, located.root, plan, input.signal)
      return rolledBack
        ? fail('STALE_REVISION', 'the project changed while the command was being applied; the target write was rolled back')
        : fail('CHECKPOINT_FAILED', 'the project changed while the command was being applied and rollback failed; manual recovery is required', false)
    }
    const after = parseAndValidateProject(afterFiles, deps.hash)
    if (after.diagnostics.length > 0) {
      const rolledBack = await compensate(deps.fs, deps.subprocess, located.root, plan, input.signal)
      const first = after.diagnostics[0]!
      return rolledBack
        ? fail('INVALID_ENTITY', `the written entity left the project invalid (${first.code}); the write was rolled back`, false)
        : fail('CHECKPOINT_FAILED', `the written entity left the project invalid (${first.code}); rollback failed and manual recovery is required`, false)
    }
    const checkpoint = await gitCheckpoint(
      deps.subprocess,
      located.root,
      checkpointMessage(plan.kind, plan.entityId),
      [plan.path],
      input.signal,
    )
    if (!checkpoint.ok) {
      if (checkpoint.committed) {
        return fail('CHECKPOINT_FAILED', 'the checkpoint commit completed but its new HEAD could not be confirmed; manual recovery is required', false)
      }
      const rolledBack = await compensate(deps.fs, deps.subprocess, located.root, plan, input.signal)
      return rolledBack
        ? fail('CHECKPOINT_FAILED', 'the git checkpoint failed and the file write was rolled back')
        : fail('CHECKPOINT_FAILED', 'the git checkpoint failed and rollback failed; manual recovery is required', false)
    }
    const projectId = project.manifest!.project_id
    try {
      await writeUndo(deps.storage, projectId, preflight.branch, {
        branch: preflight.branch,
        recordedHead: checkpoint.head,
        lastCheckpointId: checkpoint.head,
        previousCheckpointId: preflight.head,
      })
    } catch {
      return fail('CHECKPOINT_FAILED', 'the checkpoint was committed but undo state could not be recorded', false)
    }
    return {
      ok: true,
      kind: plan.kind,
      entityId: plan.entityId,
      revision: after.projectRevision,
      checkpointId: checkpoint.head,
    }
  })
}

export interface NavigationInput {
  sessionCwd: string | undefined
  expectedProjectRevision: string
  signal?: AbortSignal
}

export type NavigationOutcome =
  | { ok: true; revision: string; checkpointId: string }
  | SciForkFailure

async function navigateLocked(
  deps: ResearchHostDeps,
  input: NavigationInput,
  direction: 'back' | 'forward',
): Promise<NavigationOutcome> {
  const context = await loadProjectState(deps, input.sessionCwd, input.signal)
  if (!('root' in context)) return context
  if (context.project.diagnostics.length > 0) {
    return fail('INVALID_ENTITY', 'the project is invalid and read-only', false)
  }
  if (input.expectedProjectRevision !== context.project.projectRevision) {
    return fail('STALE_REVISION', 'the project changed; re-read the graph before navigating')
  }
  if (context.branch === undefined || context.head === undefined || context.manifest === undefined) {
    const preflight = await gitPreflight(deps.subprocess, context.root, input.signal)
    if (!preflight.ok) return fail(preflight.code, preflight.reason, preflight.code !== 'READ_ONLY_CONFLICT')
    return fail('GIT_STATE_UNSUPPORTED', 'the repository state cannot be resolved', false)
  }
  const record = context.undo
  const source = direction === 'back' ? record?.previousCheckpointId : record?.forwardCheckpointId
  if (record === undefined || source === undefined) {
    return fail(
      'INVALID_ENTITY',
      `${direction === 'back' ? 'Back' : 'Forward'} is not available: no recorded checkpoint to restore`,
      false,
    )
  }
  const sourcePaths = await gitListManagedFiles(deps.subprocess, context.root, source, input.signal)
  if (sourcePaths === undefined) return fail('CHECKPOINT_FAILED', 'the checkpoint could not be listed', false)
  // removePaths names the exact managed FILES present now but absent in the
  // source; directories are never pathspecs for `git rm`.
  const removePaths = [...context.project.files.keys()].filter((path) => !sourcePaths.includes(path))
  const restored = await gitRestoreManagedFrom(
    deps.subprocess,
    context.root,
    source,
    sourcePaths,
    removePaths,
    input.signal,
  )
  if (!restored) {
    const restoredOriginal = await gitRestoreManagedFrom(
      deps.subprocess,
      context.root,
      context.head,
      [...context.project.files.keys()],
      sourcePaths.filter((path) => !context.project.files.has(path)),
      input.signal,
    )
    return restoredOriginal
      ? fail('CHECKPOINT_FAILED', 'the checkpoint restore failed; the working tree was restored', false)
      : fail('CHECKPOINT_FAILED', 'the checkpoint restore failed and the working tree could not be restored', false)
  }

  // Validate the restored working tree before creating a restore checkpoint.
  // If parsing fails, put the previous managed state back and leave history
  // untouched so the caller can retry after repairing the source checkpoint.
  let restoredFiles: ReadonlyMap<string, string>
  try {
    restoredFiles = await readManagedFiles(deps.fs, context.root, input.signal)
  } catch {
    const restoredOriginal = await gitRestoreManagedFrom(
      deps.subprocess,
      context.root,
      context.head,
      [...context.project.files.keys()],
      sourcePaths.filter((path) => !context.project.files.has(path)),
      input.signal,
    )
    return restoredOriginal
      ? fail('INVALID_ENTITY', 'the restored state could not be read safely', false)
      : fail('CHECKPOINT_FAILED', 'the restored state could not be read safely and the original state could not be restored', false)
  }
  const restoredProject = parseAndValidateProject(restoredFiles, deps.hash)
  if (restoredProject.diagnostics.length > 0) {
    const restoredOriginal = await gitRestoreManagedFrom(
      deps.subprocess,
      context.root,
      context.head,
      [...context.project.files.keys()],
      sourcePaths.filter((path) => !context.project.files.has(path)),
      input.signal,
    )
    return restoredOriginal
      ? fail('INVALID_ENTITY', 'the restored state is invalid; no restore checkpoint was created', false)
      : fail('CHECKPOINT_FAILED', 'the restored state is invalid and the original state could not be restored', false)
  }
  const checkpointPaths = [...new Set([...sourcePaths, ...removePaths])]
  const checkpoint = await gitCheckpoint(
    deps.subprocess,
    context.root,
    direction === 'back' ? backMessage(source) : forwardMessage(source),
    checkpointPaths,
    input.signal,
  )
  if (!checkpoint.ok) {
    if (checkpoint.committed) {
      return fail('CHECKPOINT_FAILED', 'the restore commit completed but its new HEAD could not be confirmed; manual recovery is required', false)
    }
    const restoredOriginal = await gitRestoreManagedFrom(
      deps.subprocess,
      context.root,
      context.head,
      [...context.project.files.keys()],
      sourcePaths.filter((path) => !context.project.files.has(path)),
      input.signal,
    )
    return restoredOriginal
      ? fail('CHECKPOINT_FAILED', 'the restore checkpoint failed and the working tree was restored', false)
      : fail('CHECKPOINT_FAILED', 'the restore checkpoint failed and the working tree could not be restored', false)
  }
  const nextRecord: UndoRecord =
    direction === 'back'
      ? {
          branch: record.branch,
          recordedHead: checkpoint.head,
          lastCheckpointId: checkpoint.head,
          forwardCheckpointId: record.lastCheckpointId,
        }
      : {
          branch: record.branch,
          recordedHead: checkpoint.head,
          lastCheckpointId: checkpoint.head,
          previousCheckpointId: record.recordedHead,
        }
  try {
    await writeUndo(deps.storage, context.manifest.project_id, record.branch, nextRecord)
  } catch {
    return fail('CHECKPOINT_FAILED', 'the restore checkpoint was committed but undo state could not be recorded', false)
  }
  return { ok: true, revision: restoredProject.projectRevision, checkpointId: checkpoint.head }
}

async function navigate(
  deps: ResearchHostDeps,
  input: NavigationInput,
  direction: 'back' | 'forward',
): Promise<NavigationOutcome> {
  const located = await locateProject(
    { fs: deps.fs, gitToplevel: (cwd, sig) => gitShowToplevel(deps.subprocess, cwd, sig) },
    input.sessionCwd,
    input.signal,
  )
  if (!located.ok) return fail(located.code, located.message, false)
  return queue.run(located.root, () => navigateLocked(deps, input, direction))
}

/** One-step Back: restore the previous checkpoint with a restore commit. */
export async function backStep(deps: ResearchHostDeps, input: NavigationInput): Promise<NavigationOutcome> {
  return navigate(deps, input, 'back')
}

/** One-step Forward: re-apply the checkpoint that Back moved away from. */
export async function forwardStep(deps: ResearchHostDeps, input: NavigationInput): Promise<NavigationOutcome> {
  return navigate(deps, input, 'forward')
}

export interface InitProjectDeps extends ResearchHostDeps {
  /** Directory creation seam; defaults to node:fs mkdir for the four dirs. */
  mkdirs?(root: string): void
}

export interface InitProjectInput {
  sessionCwd: string | undefined
  signal?: AbortSignal
}

export type InitOutcome =
  | { ok: true; root: string; projectId: string; name: string; checkpointId: string }
  | SciForkFailure

function defaultMkdirs(root: string): void {
  for (const dir of MANAGED_PATHS.slice(1)) {
    mkdirSync(join(root, dir), { recursive: true })
  }
}

function projectNameFor(root: string): string {
  const name = basename(root).trim()
  return name.length > 0 ? name.slice(0, 200) : 'research project'
}

/**
 * `/research init` (architecture §11.1): explicit user operation creating the
 * managed skeleton, a local repository when needed, and a baseline checkpoint
 * on the current branch. Never touches branches, remotes, or global config.
 */
export async function initProject(deps: InitProjectDeps, input: InitProjectInput): Promise<InitOutcome> {
  const check = await canInitProject(
    { fs: deps.fs, gitToplevel: (cwd, sig) => gitShowToplevel(deps.subprocess, cwd, sig) },
    input.sessionCwd,
    input.signal,
  )
  if (!check.ok) return fail(check.code, check.message, false)
  const root = check.root
  const topLevel = await gitShowToplevel(deps.subprocess, root, input.signal)
  if (topLevel === undefined) {
    if (!(await gitInit(deps.subprocess, root, input.signal))) {
      return fail('GIT_UNAVAILABLE', 'git init failed', false)
    }
  }
  const initPreflight = await gitInitPreflight(deps.subprocess, root, input.signal)
  if (!initPreflight.ok) return fail(initPreflight.code, initPreflight.reason, false)
  if (!(await gitIdentityConfigured(deps.subprocess, root, input.signal))) {
    return fail('GIT_UNAVAILABLE', 'git identity (user.name and user.email) is not configured', false)
  }
  const projectId = randomUUID()
  const name = projectNameFor(root)
  const manifest: ResearchManifest = { schema_version: 1, project_id: projectId, name }
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`
  try {
    ;(deps.mkdirs ?? defaultMkdirs)(root)
  } catch {
    return fail('INVALID_ENTITY', 'managed project directories could not be created', false)
  }
  const written = await writeManagedFile(
    deps.fs,
    root,
    MANIFEST_FILE,
    manifestContent,
    'create',
    input.signal,
  )
  if (!written.ok) {
    return fail('INVALID_ENTITY', 'research.json could not be written', false)
  }
  let initSnapshot
  try {
    initSnapshot = await readManagedFileSnapshot(deps.fs, root, input.signal)
  } catch {
    const rolledBack = await compensate(
      deps.fs,
      deps.subprocess,
      root,
      { path: MANIFEST_FILE, writeKind: 'create', content: manifestContent },
      input.signal,
    )
    return rolledBack
      ? fail('INVALID_ENTITY', 'managed project files could not be read safely', false)
      : fail('CHECKPOINT_FAILED', 'managed project files could not be read safely and initialization rollback failed', false)
  }
  const initProjectState = parseAndValidateProject(initSnapshot.files, deps.hash)
  if (initProjectState.diagnostics.length > 0) {
    const rolledBack = await compensate(
      deps.fs,
      deps.subprocess,
      root,
      { path: MANIFEST_FILE, writeKind: 'create', content: manifestContent },
      input.signal,
    )
    return rolledBack
      ? fail('INVALID_ENTITY', 'existing managed files are invalid; initialization was not completed', false)
      : fail('CHECKPOINT_FAILED', 'existing managed files are invalid and initialization rollback failed', false)
  }
  const checkpoint = await gitCheckpoint(
    deps.subprocess,
    root,
    initCheckpointMessage(),
    managedCheckpointPaths(initSnapshot.files),
    input.signal,
  )
  if (!checkpoint.ok) {
    if (checkpoint.committed) {
      return fail('CHECKPOINT_FAILED', 'the baseline commit completed but its new HEAD could not be confirmed; manual recovery is required', false)
    }
    const rolledBack = await compensate(
      deps.fs,
      deps.subprocess,
      root,
      { path: MANIFEST_FILE, writeKind: 'create', content: manifestContent },
      input.signal,
    )
    return rolledBack
      ? fail('CHECKPOINT_FAILED', 'the baseline checkpoint failed and research.json was rolled back', false)
      : fail('CHECKPOINT_FAILED', 'the baseline checkpoint failed and initialization rollback failed', false)
  }
  try {
    await writeUndo(deps.storage, projectId, initPreflight.branch, {
      branch: initPreflight.branch,
      recordedHead: checkpoint.head,
      lastCheckpointId: checkpoint.head,
    })
  } catch {
    return fail('CHECKPOINT_FAILED', 'the baseline checkpoint was committed but undo state could not be recorded', false)
  }
  return { ok: true, root, projectId, name, checkpointId: checkpoint.head }
}
