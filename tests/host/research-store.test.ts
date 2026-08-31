import { describe, expect, it } from 'vitest'
import { readManagedFileSnapshot, readManagedFiles, writeManagedFile } from '../../src/host/research-store.js'
import { FakeFs } from './fakes.js'

const MANIFEST = JSON.stringify({ schema_version: 1, project_id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Store' })

describe('readManagedFiles', () => {
  it('reads the manifest and all entity files, ignoring root-level extras', async () => {
    const fs = new FakeFs({
      '/proj/research.json': MANIFEST,
      '/proj/notes.md': 'not managed',
      '/proj/questions/question_a.md': '---\nid: question_a\nquestion: Why?\n---\n',
      '/proj/question-links/qlink_a.json': '{}',
      '/proj/nodes/node_a.md': '---\nid: node_a\nkind: hypothesis\nconfidence: low\n---\nbody',
      '/proj/edges/edge_a.json': '{}',
    })
    const files = await readManagedFiles(fs, '/proj')
    expect([...files.keys()].sort()).toEqual([
      'edges/edge_a.json',
      'nodes/node_a.md',
      'question-links/qlink_a.json',
      'questions/question_a.md',
      'research.json',
    ])
    expect(files.get('research.json')).toBe(MANIFEST)
  })

  it('treats missing managed directories as empty', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const files = await readManagedFiles(fs, '/proj')
    expect([...files.keys()]).toEqual(['research.json'])
  })

  it('fails closed when a managed directory cannot be listed', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST, '/proj/nodes/node_a.md': 'x' })
    fs.failListDirPaths.add('/proj/nodes')
    await expect(readManagedFiles(fs, '/proj')).rejects.toMatchObject({ code: 'FS_PERMISSION_DENIED' })
  })

  it('fails closed for non-file and out-of-root managed entries', async () => {
    const directory = new FakeFs({ '/proj/research.json': MANIFEST })
    directory.addSpecial('/proj/nodes/nested', 'directory')
    await expect(readManagedFiles(directory, '/proj')).rejects.toThrow(/managed path/i)

    const symlink = new FakeFs({ '/proj/research.json': MANIFEST, '/outside.md': 'outside' })
    symlink.addSpecial('/proj/nodes/link.md', 'file', '/outside.md')
    await expect(readManagedFiles(symlink, '/proj')).rejects.toThrow(/containment/i)
  })

  it('captures filesystem versions for an atomic update intent', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST, '/proj/nodes/node_a.md': 'old' })
    const snapshot = await readManagedFileSnapshot(fs, '/proj')
    const version = snapshot.versions.get('nodes/node_a.md')
    expect(version).toBeDefined()
    fs.writeExternal('/proj/nodes/node_a.md', 'external')
    const result = await writeManagedFile(fs, '/proj', 'nodes/node_a.md', 'new', 'update', undefined, version)
    expect(result).toEqual({ ok: false, code: 'STALE_TARGET' })
    expect(fs.contentOf('/proj/nodes/node_a.md')).toBe('external')
  })
})

describe('writeManagedFile', () => {
  it('creates a new file with a createIfAbsent intent', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const result = await writeManagedFile(fs, '/proj', 'nodes/node_new.md', 'content', 'create')
    expect(result).toEqual({ ok: true })
    expect(fs.contentOf('/proj/nodes/node_new.md')).toBe('content')
  })

  it('rejects creating over an existing file', async () => {
    const fs = new FakeFs({ '/proj/nodes/node_a.md': 'old' })
    const result = await writeManagedFile(fs, '/proj', 'nodes/node_a.md', 'new', 'create')
    expect(result).toEqual({ ok: false, code: 'STALE_TARGET' })
    expect(fs.contentOf('/proj/nodes/node_a.md')).toBe('old')
  })

  it('updates a file guarded by its observed version', async () => {
    const fs = new FakeFs({ '/proj/nodes/node_a.md': 'old' })
    const target = await fs.resolve('nodes/node_a.md', { cwd: '/proj' })
    const stat = await fs.stat(target)
    const result = await writeManagedFile(fs, '/proj', 'nodes/node_a.md', 'new', 'update')
    expect(result).toEqual({ ok: true })
    expect(fs.contentOf('/proj/nodes/node_a.md')).toBe('new')
    expect(stat?.type).toBe('file')
  })

  it('maps external changes to STALE_TARGET', async () => {
    const fs = new FakeFs({ '/proj/nodes/node_a.md': 'old' })
    // a concurrent writer replaces the file between our stat and our write
    fs.onBeforeWrite = (path) => {
      if (path === '/proj/nodes/node_a.md') fs.writeExternal('/proj/nodes/node_a.md', 'external')
    }
    const result = await writeManagedFile(fs, '/proj', 'nodes/node_a.md', 'new', 'update')
    expect(result).toEqual({ ok: false, code: 'STALE_TARGET' })
    expect(fs.contentOf('/proj/nodes/node_a.md')).toBe('external')
  })

  it('rejects paths that escape the project root', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const result = await writeManagedFile(fs, '/proj', '../outside.md', 'x', 'create')
    expect(result).toEqual({ ok: false, code: 'INVALID_ENTITY' })
    expect(fs.contentOf('/outside.md')).toBeUndefined()
  })
})
