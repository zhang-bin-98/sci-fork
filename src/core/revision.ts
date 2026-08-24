/**
 * Content-addressed versions (architecture §5.3). Pure: the hash function is
 * injected by the Host adapter (node:crypto SHA-256); Core never imports it.
 */

export type HashFn = (content: string) => string

export const HASH_RE = /^[0-9a-f]{64}$/

function hashOf(value: string, hash: HashFn): string {
  const digest = hash(value)
  if (!HASH_RE.test(digest)) {
    throw new TypeError('scifork: injected hash function must return a 64-char lowercase hex digest')
  }
  return digest
}

/** SHA-256 of one file's content; the single-file write-protection token. */
export function fileVersion(content: string, hash: HashFn): string {
  return hashOf(content, hash)
}

/**
 * Project revision: SHA-256 over all managed files sorted by relative path,
 * each line carrying `path` and that file's own SHA-256, so the revision
 * covers both content and membership without storing the graph on disk.
 */
export function projectRevision(files: ReadonlyMap<string, string>, hash: HashFn): string {
  const lines = [...files.entries()]
    .sort(([pathA], [pathB]) => (pathA < pathB ? -1 : pathA > pathB ? 1 : 0))
    .map(([path, content]) => `${path}\n${hashOf(content, hash)}\n`)
  return hashOf(lines.join(''), hash)
}
