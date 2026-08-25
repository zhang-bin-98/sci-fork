import { MANIFEST_FILE, MANAGED_PATHS } from '../core/schema.js'
import { isFsStaleError, type FsDirEntry, type FsPort, type FsTarget } from './contracts.js'

/** Managed-file access through the DSH filesystem service. */

export interface ManagedFileSnapshot {
  files: ReadonlyMap<string, string>
  versions: ReadonlyMap<string, unknown>
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null | undefined)?.code
}

function isNotFoundError(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'FS_NOT_FOUND' || code === 'ENOENT' || code === 'NOT_FOUND'
}

function managedPathError(message: string): Error {
  return new Error(`managed path violation: ${message}`)
}

async function readSnapshot(fs: FsPort, root: string, signal?: AbortSignal): Promise<ManagedFileSnapshot> {
  const files = new Map<string, string>()
  const versions = new Map<string, unknown>()
  const rootTarget = await fs.resolve(root, signal !== undefined ? { signal } : {})
  const manifestTarget = await fs.resolve(MANIFEST_FILE, { cwd: root, ...(signal !== undefined ? { signal } : {}) })
  if (!fs.contains(rootTarget, manifestTarget)) throw managedPathError('research.json is outside the project root')
  const manifestInfo = await fs.stat(manifestTarget, signal)
  if (manifestInfo !== undefined) {
    if (manifestInfo.type !== 'file') throw managedPathError('research.json is not a regular file')
    files.set(MANIFEST_FILE, await fs.readText(manifestTarget, signal))
    versions.set(MANIFEST_FILE, manifestInfo.version)
  }
  for (const dir of MANAGED_PATHS.slice(1)) {
    const dirTarget = await fs.resolve(dir, { cwd: root, ...(signal !== undefined ? { signal } : {}) })
    if (!fs.contains(rootTarget, dirTarget)) throw managedPathError(`${dir}/ is outside the project root`)
    const dirInfo = await fs.stat(dirTarget, signal)
    if (dirInfo === undefined) continue
    if (dirInfo.type !== 'directory') throw managedPathError(`${dir}/ is not a directory`)
    let entries: FsDirEntry[]
    try {
      entries = await fs.listDir(dirTarget, signal)
    } catch (error) {
      if (isNotFoundError(error)) continue
      throw error
    }
    for (const entry of entries) {
      if (entry.name.length === 0 || entry.name === '.' || entry.name === '..' || entry.name.includes('/') || entry.name.includes('\\')) {
        throw managedPathError(`invalid entry name under ${dir}/`)
      }
      if (entry.type !== 'file') throw managedPathError(`${dir}/${entry.name} is not a regular file`)
      if (!fs.contains(rootTarget, entry.target)) throw managedPathError(`${dir}/${entry.name} fails project-root containment`)
      let version = entry.version
      if (version === undefined) {
        const info = await fs.stat(entry.target, signal)
        if (info === undefined || info.type !== 'file') throw managedPathError(`${dir}/${entry.name} disappeared`)
        version = info.version
      }
      const relativePath = `${dir}/${entry.name}`
      files.set(relativePath, await fs.readText(entry.target, signal))
      versions.set(relativePath, version)
    }
  }
  return { files, versions }
}

export async function readManagedFiles(fs: FsPort, root: string, signal?: AbortSignal): Promise<ReadonlyMap<string, string>> {
  return (await readSnapshot(fs, root, signal)).files
}

export async function readManagedFileSnapshot(fs: FsPort, root: string, signal?: AbortSignal): Promise<ManagedFileSnapshot> {
  return readSnapshot(fs, root, signal)
}

export interface WriteManagedResult { ok: true }
export interface WriteManagedFailure { ok: false; code: 'STALE_TARGET' | 'INVALID_ENTITY' }

const NO_EXPECTED_VERSION = Symbol('no expected filesystem version')

export async function writeManagedFile(
  fs: FsPort,
  root: string,
  relativePath: string,
  content: string,
  writeKind: 'create' | 'update',
  signal?: AbortSignal,
  expectedVersion: unknown = NO_EXPECTED_VERSION,
): Promise<WriteManagedResult | WriteManagedFailure> {
  try {
    const rootTarget = await fs.resolve(root, signal !== undefined ? { signal } : {})
    const fileTarget = await fs.resolve(relativePath, { cwd: root, ...(signal !== undefined ? { signal } : {}) })
    if (!fs.contains(rootTarget, fileTarget)) return { ok: false, code: 'INVALID_ENTITY' }
    if (writeKind === 'create') {
      if (await fs.stat(fileTarget, signal) !== undefined) return { ok: false, code: 'STALE_TARGET' }
      await fs.writeText(fileTarget, content, { kind: 'createIfAbsent' }, signal)
      return { ok: true }
    }
    const version = expectedVersion === NO_EXPECTED_VERSION ? (await fs.stat(fileTarget, signal))?.version : expectedVersion
    if (version === undefined) return { ok: false, code: 'STALE_TARGET' }
    await fs.writeText(fileTarget, content, { kind: 'replaceIfVersion', version }, signal)
    return { ok: true }
  } catch (error) {
    if (isFsStaleError(error)) return { ok: false, code: 'STALE_TARGET' }
    return { ok: false, code: 'INVALID_ENTITY' }
  }
}

export async function resolveProjectTarget(fs: FsPort, root: string, signal?: AbortSignal): Promise<FsTarget> {
  return fs.resolve(root, signal !== undefined ? { signal } : {})
}
