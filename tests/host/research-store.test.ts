import { describe, expect, it } from 'vitest'
import { readManagedFiles, writeManagedFile } from '../../src/host/research-store.js'
import { FakeFs } from './fakes.js'

const MANIFEST = JSON.stringify({ schema_version: 1, project_id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Store' })

describe('readManagedFiles', () => {
  it('reads the manifest and all entity files, ignoring root-level extras', async () => {
    const fs = new FakeFs({
      '/proj/research.json': MANIFEST,
      '/proj/notes.md': 'not managed',
      '/proj/nodes/node_a.md': '---\nid: node_a\nkind: hypothesis\nconfidence: low\n---\nbody',
      '/proj/edges/edge_a.json': '{}',
    })
    const files = await readManagedFiles(fs, '/proj')
    expect([...files.keys()].sort()).toEqual(['edges/edge_a.json', 'nodes/node_a.md', 'research.json'])
    expect(files.get('research.json')).toBe(MANIFEST)
  })

  it('treats missing managed directories as empty', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const files = await readManagedFiles(fs, '/proj')
    expect([...files.keys()]).toEqual(['research.json'])
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
