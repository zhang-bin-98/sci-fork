import { MANIFEST_FILE, MANAGED_PATHS } from '../core/schema.js'
import { isFsStaleError, type FsDirEntry, type FsPort, type FsTarget } from './contracts.js'

/**
 * Managed-file access over `ctx.fs` (architecture §7/§11.2). Every content
 * read and write rides the DSH filesystem service so sandbox and observation
 * policy stay in the loop; paths are relative to the project root and derived
 * from entity ids, never from caller input.
 */

/**
 * Read the manifest and every entity file under the four managed
 * directories. Missing directories read as empty (Git does not track empty
 * directories). Root-level non-managed files are ignored.
 */
export async function readManagedFiles(
  fs: FsPort,
  root: string,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>()
  const manifestTarget = await fs.resolve(MANIFEST_FILE, {
    cwd: root,
    ...(signal !== undefined ? { signal } : {}),
  })
  const manifestInfo = await fs.stat(manifestTarget, signal)
  if (manifestInfo?.type === 'file') {
    files.set(MANIFEST_FILE, await fs.readText(manifestTarget, signal))
  }
  for (const dir of MANAGED_PATHS.slice(1)) {
    let entries: FsDirEntry[]
    try {
      entries = await fs.listDir(
        await fs.resolve(dir, { cwd: root, ...(signal !== undefined ? { signal } : {}) }),
        signal,
      )
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (entry.type !== 'file') continue
      files.set(`${dir}/${entry.name}`, await fs.readText(entry.target, signal))
    }
  }
  return files
}

export interface WriteManagedResult {
  ok: true
}

export interface WriteManagedFailure {
  ok: false
  code: 'STALE_TARGET' | 'INVALID_ENTITY'
}

/**
 * Atomically create or replace one managed file with a guarded intent:
 * creates use createIfAbsent, updates use the observed version token, and
 * both are additionally protected by the Core SHA-256 fileVersion checked
 * before this call. Stale or escaped targets fail without touching the file.
 */
export async function writeManagedFile(
  fs: FsPort,
  root: string,
  relativePath: string,
  content: string,
  writeKind: 'create' | 'update',
  signal?: AbortSignal,
): Promise<WriteManagedResult | WriteManagedFailure> {
  try {
    const rootTarget = await fs.resolve(root, signal !== undefined ? { signal } : {})
    const fileTarget = await fs.resolve(relativePath, {
      cwd: root,
      ...(signal !== undefined ? { signal } : {}),
    })
    if (!fs.contains(rootTarget, fileTarget)) {
      return { ok: false, code: 'INVALID_ENTITY' }
    }
    if (writeKind === 'create') {
      const existing = await fs.stat(fileTarget, signal)
      if (existing !== undefined) return { ok: false, code: 'STALE_TARGET' }
      await fs.writeText(fileTarget, content, { kind: 'createIfAbsent' }, signal)
      return { ok: true }
    }
    const current = await fs.stat(fileTarget, signal)
    if (current === undefined || current.type !== 'file') {
      return { ok: false, code: 'STALE_TARGET' }
    }
    await fs.writeText(fileTarget, content, { kind: 'replaceIfVersion', version: current.version }, signal)
    return { ok: true }
  } catch (error) {
    if (isFsStaleError(error)) return { ok: false, code: 'STALE_TARGET' }
    return { ok: false, code: 'INVALID_ENTITY' }
  }
}

/** Resolve the canonical project root target for containment checks. */
export async function resolveProjectTarget(fs: FsPort, root: string, signal?: AbortSignal): Promise<FsTarget> {
  return fs.resolve(root, signal !== undefined ? { signal } : {})
}
