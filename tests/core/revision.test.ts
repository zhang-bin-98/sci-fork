import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { fileVersion, projectRevision } from '../../src/core/revision.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

describe('fileVersion', () => {
  it('returns the injected hash of the content', () => {
    expect(fileVersion('hello', sha256)).toBe(sha256('hello'))
  })

  it('rejects a hash function that does not produce lowercase hex', () => {
    expect(() => fileVersion('x', () => 'not-a-hash')).toThrow()
  })
})

describe('projectRevision', () => {
  it('is stable regardless of map insertion order', () => {
    const filesA = new Map([
      ['nodes/node_a.md', 'aaa'],
      ['research.json', '{}'],
    ])
    const filesB = new Map([
      ['research.json', '{}'],
      ['nodes/node_a.md', 'aaa'],
    ])
    expect(projectRevision(filesA, sha256)).toBe(projectRevision(filesB, sha256))
  })

  it('changes when any file content changes', () => {
    const files = new Map([
      ['research.json', '{}'],
      ['nodes/node_a.md', 'aaa'],
    ])
    const before = projectRevision(files, sha256)
    files.set('nodes/node_a.md', 'bbb')
    expect(projectRevision(files, sha256)).not.toBe(before)
  })

  it('changes when a file is added or removed', () => {
    const files = new Map([['research.json', '{}']])
    const before = projectRevision(files, sha256)
    files.set('nodes/node_a.md', 'aaa')
    const afterAdd = projectRevision(files, sha256)
    expect(afterAdd).not.toBe(before)
    files.delete('nodes/node_a.md')
    expect(projectRevision(files, sha256)).toBe(before)
  })

  it('is defined for an empty file set', () => {
    expect(projectRevision(new Map(), sha256)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a 64-char lowercase hex digest with real SHA-256', () => {
    const revision = projectRevision(new Map([['a', '1']]), sha256)
    expect(revision).toMatch(/^[0-9a-f]{64}$/)
  })

  it('distinguishes content from path', () => {
    const a = projectRevision(new Map([['a', 'same']]), sha256)
    const b = projectRevision(new Map([['b', 'same']]), sha256)
    expect(a).not.toBe(b)
  })
})
