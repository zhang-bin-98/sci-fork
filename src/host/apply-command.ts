import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseAndValidateProject } from '../core/validator.js'
import type { LoadedProject } from '../core/parser.js'
import { planCommand, type ResearchCommand } from '../core/commands.js'
import type { HashFn } from '../core/revision.js'
import { MANIFEST_FILE, MANAGED_PATHS, type ResearchManifest } from '../core/schema.js'
import type { FsPort, SubprocessPort } from './contracts.js'
import {
  checkpointMessage,
  gitCheckpoint,
  gitIdentityConfigured,
  gitInit,
  gitInitPreflight,
  gitPreflight,
  gitShowToplevel,
  initCheckpointMessage,
  type GitPreflightResult,
} from './git-checkpoints.js'
import { canInitProject, locateProject } from './project-locator.js'
import { readManagedFileSnapshot, readManagedFiles, writeManagedFile } from './research-store.js'
import { MutationQueue } from './ui-state.js'

/**
 * Mutation pipeline (architecture §6.1/§11):
 * parse -> revision guard -> Git preflight -> command plan -> atomic write ->
 * re-parse -> checkpoint. A failed checkpoint is reported to DSH/the user;
 * this adapter never performs destructive history or file compensation.
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
  hash: HashFn
}

interface ProjectContext {
  root: string
  manifest: ResearchManifest | undefined
  project: LoadedProject
  branch: string | undefined
  head: string | undefined
  gitFailure?: Extract<GitPreflightResult, { ok: false }>
}

const queue = new MutationQueue()

function fail(
  code: SciForkFailureCode,
  message: string,
  recoverable = true,
  entityId?: string,
): SciForkFailure {
  return entityId !== undefined
    ? { ok: false, code, message, recoverable, entityId }
    : { ok: false, code, message, recoverable }
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

/** Load project state; Git failure is retained as a read-only diagnostic. */
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
      gitFailure: preflight,
    }
  }
  return {
    root: located.root,
    manifest: project.manifest,
    project,
    branch: preflight.branch,
    head: preflight.head,
  }
}

export interface ApplyCommandInput {
  sessionCwd: string | undefined
  command: ResearchCommand
  expectedProjectRevision: string
  signal?: AbortSignal
}

export type ApplyOutcome =
  | { ok: true; kind: string; entityId: string; revision: string; checkpointId: string }
  | SciForkFailure

/** Apply one typed command: exactly one entity file plus one checkpoint. */
export async function applyCommand(
  deps: ResearchHostDeps,
  input: ApplyCommandInput,
): Promise<ApplyOutcome> {
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
    if (!preflight.ok) {
      return fail(preflight.code, preflight.reason, preflight.code !== 'READ_ONLY_CONFLICT')
    }

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
      return fail(written.code, 'the target file changed; re-read the graph before applying', true, plan.entityId)
    }

    let afterFiles: ReadonlyMap<string, string>
    try {
      afterFiles = await readManagedFiles(deps.fs, located.root, input.signal)
    } catch {
      return fail(
        'CHECKPOINT_FAILED',
        'the written entity could not be re-read; the file was left in place and manual recovery may be required',
        false,
        plan.entityId,
      )
    }

    const expectedFiles = new Map(snapshot.files)
    expectedFiles.set(plan.path, plan.content)
    if (!sameManagedFiles(afterFiles, expectedFiles)) {
      return fail(
        'STALE_REVISION',
        'the project changed while the command was being applied; the written file was left in place for DSH or the user to inspect',
        true,
        plan.entityId,
      )
    }

    const after = parseAndValidateProject(afterFiles, deps.hash)
    if (after.diagnostics.length > 0) {
      const first = after.diagnostics[0]!
      return fail(
        'INVALID_ENTITY',
        `the written entity left the project invalid (${first.code}); the file was left in place for DSH or the user to repair`,
        false,
        plan.entityId,
      )
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
        return fail(
          'CHECKPOINT_FAILED',
          'the checkpoint commit completed but its new HEAD could not be confirmed; ask DSH or the user to inspect Git history',
          false,
          plan.entityId,
        )
      }
      return fail(
        'CHECKPOINT_FAILED',
        'the git checkpoint failed; the written file was left in place for DSH or the user to inspect and recover',
        true,
        plan.entityId,
      )
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
 * `/research init`: create the managed skeleton, a local repository when
 * needed, and one baseline checkpoint on the current branch. It never owns
 * branches, remotes, history recovery, or destructive rollback.
 */
export async function initProject(
  deps: InitProjectDeps,
  input: InitProjectInput,
): Promise<InitOutcome> {
  const check = await canInitProject(
    { fs: deps.fs, gitToplevel: (cwd, sig) => gitShowToplevel(deps.subprocess, cwd, sig) },
    input.sessionCwd,
    input.signal,
  )
  if (!check.ok) return fail(check.code, check.message, false)

  const root = check.root
  const topLevel = await gitShowToplevel(deps.subprocess, root, input.signal)
  if (topLevel === undefined && !(await gitInit(deps.subprocess, root, input.signal))) {
    return fail('GIT_UNAVAILABLE', 'git init failed', false)
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
  if (!written.ok) return fail('INVALID_ENTITY', 'research.json could not be written', false)

  let initSnapshot
  try {
    initSnapshot = await readManagedFileSnapshot(deps.fs, root, input.signal)
  } catch {
    return fail('CHECKPOINT_FAILED', 'managed project files could not be read safely; initialization files were left in place', false)
  }
  const initProjectState = parseAndValidateProject(initSnapshot.files, deps.hash)
  if (initProjectState.diagnostics.length > 0) {
    return fail('INVALID_ENTITY', 'existing managed files are invalid; initialization files were left in place for repair', false)
  }

  // The baseline owns only the marker. Later entity mutations checkpoint one
  // planned file at a time, leaving unrelated staged work untouched.
  const checkpoint = await gitCheckpoint(
    deps.subprocess,
    root,
    initCheckpointMessage(),
    [MANIFEST_FILE],
    input.signal,
  )
  if (!checkpoint.ok) {
    if (checkpoint.committed) {
      return fail('CHECKPOINT_FAILED', 'the baseline commit completed but its new HEAD could not be confirmed; ask DSH or the user to inspect Git history', false)
    }
    return fail('CHECKPOINT_FAILED', 'the baseline checkpoint failed; initialization files were left in place for DSH or the user to inspect', true)
  }

  return { ok: true, root, projectId, name, checkpointId: checkpoint.head }
}
