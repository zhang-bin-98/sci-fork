import { dirname, isAbsolute, posix, win32 } from 'node:path'
import { parseManifest, type ResearchManifest } from '../core/schema.js'
import type { FsPort } from './contracts.js'

/**
 * Project Locator (architecture §7.1): the project root comes exclusively
 * from the DSH session cwd — never from model arguments or the Companion.
 */

export interface ProjectLocatorDeps {
  fs: FsPort
  gitToplevel(cwd: string, signal?: AbortSignal): Promise<string | undefined>
}

export type LocateResult =
  | { ok: true; root: string; manifest: ResearchManifest }
  | {
      ok: false
      code:
        | 'PROJECT_NOT_INITIALIZED'
        | 'PROJECT_REPOSITORY_MISMATCH'
        | 'UNSUPPORTED_SCHEMA_VERSION'
        | 'INVALID_ENTITY'
        | 'SESSION_UNAVAILABLE'
      message: string
    }

function isAbsolutePath(path: string): boolean {
  return win32.isAbsolute(path) || posix.isAbsolute(path)
}

function normalizeForCompare(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

/**
 * Locate the Research Project for a session cwd: walk up to the nearest
 * research.json, parse and validate the manifest, and require that any
 * enclosing Git repository has the project root as its top level.
 */
export async function locateProject(
  deps: ProjectLocatorDeps,
  sessionCwd: string | undefined,
  signal?: AbortSignal,
): Promise<LocateResult> {
  if (typeof sessionCwd !== 'string' || sessionCwd.length === 0 || !isAbsolutePath(sessionCwd)) {
    return {
      ok: false,
      code: 'SESSION_UNAVAILABLE',
      message: 'the session has no working directory',
    }
  }
  let current = sessionCwd
  for (;;) {
    let manifestTarget
    try {
      manifestTarget = await deps.fs.resolve('research.json', {
        cwd: current,
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch {
      manifestTarget = undefined
    }
    if (manifestTarget !== undefined) {
      let info
      try {
        info = await deps.fs.stat(manifestTarget, signal)
      } catch {
        info = undefined
      }
      if (info?.type === 'file') {
        let content: string
        try {
          content = await deps.fs.readText(manifestTarget, signal)
        } catch {
          return {
            ok: false,
            code: 'INVALID_ENTITY',
            message: 'research.json could not be read',
          }
        }
        const parsed = parseManifest(content)
        if (!parsed.ok) {
          let version: unknown
          try {
            version = (JSON.parse(content) as Record<string, unknown>)['schema_version']
          } catch {
            version = undefined
          }
          if (typeof version === 'number' && version !== 1) {
            return {
              ok: false,
              code: 'UNSUPPORTED_SCHEMA_VERSION',
              message: `schema_version ${version} is not supported`,
            }
          }
          return {
            ok: false,
            code: 'INVALID_ENTITY',
            message: `research.json is invalid: ${parsed.issues.join('; ')}`,
          }
        }
        let root: string
        try {
          root = deps.fs.processPath(
            await deps.fs.resolve(current, signal !== undefined ? { signal } : {}),
          )
        } catch {
          return {
            ok: false,
            code: 'PROJECT_NOT_INITIALIZED',
            message: 'the project directory could not be resolved',
          }
        }
        const topLevel = await deps.gitToplevel(root, signal)
        if (topLevel !== undefined && normalizeForCompare(topLevel) !== normalizeForCompare(root)) {
          return {
            ok: false,
            code: 'PROJECT_REPOSITORY_MISMATCH',
            message: 'the research project lies inside an unrelated git repository',
          }
        }
        return { ok: true, root, manifest: parsed.value }
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return {
    ok: false,
    code: 'PROJECT_NOT_INITIALIZED',
    message: 'no research project found in this directory or its parents',
  }
}

/** Whether init may proceed in this cwd: no project above and no foreign git repo. */
export async function canInitProject(
  deps: ProjectLocatorDeps,
  sessionCwd: string | undefined,
  signal?: AbortSignal,
): Promise<LocateResult | { ok: true; root: string; manifest: undefined }> {
  const located = await locateProject(deps, sessionCwd, signal)
  if (located.ok) {
    return { ok: false, code: 'INVALID_ENTITY', message: `a research project already exists at ${located.root}` }
  }
  if (located.code !== 'PROJECT_NOT_INITIALIZED') return located
  if (typeof sessionCwd !== 'string' || sessionCwd.length === 0 || !isAbsolutePath(sessionCwd)) {
    return located
  }
  let root: string
  try {
    root = deps.fs.processPath(await deps.fs.resolve(sessionCwd, signal !== undefined ? { signal } : {}))
  } catch {
    return located
  }
  const topLevel = await deps.gitToplevel(root, signal)
  if (topLevel !== undefined && normalizeForCompare(topLevel) !== normalizeForCompare(root)) {
    return {
      ok: false,
      code: 'PROJECT_REPOSITORY_MISMATCH',
      message: 'this directory sits inside an unrelated git repository',
    }
  }
  return { ok: true, root, manifest: undefined }
}
