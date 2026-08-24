import { describe, expect, it } from 'vitest'
import { locateProject } from '../../src/host/project-locator.js'
import { FakeFs } from './fakes.js'

const UUID = '01234567-89ab-4cde-8f01-23456789abcd'
const MANIFEST = JSON.stringify({ schema_version: 1, project_id: UUID, name: 'Locator' })

function deps(fs: FakeFs, toplevel = '/proj') {
  return {
    fs,
    gitToplevel: async () => toplevel,
  }
}

describe('locateProject', () => {
  it('finds a project in the session cwd', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const result = await locateProject(deps(fs), '/proj')
    expect(result).toEqual({
      ok: true,
      root: '/proj',
      manifest: { schema_version: 1, project_id: UUID, name: 'Locator' },
    })
  })

  it('walks up to find a project in a parent directory', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const result = await locateProject(deps(fs), '/proj/deep/sub')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.root).toBe('/proj')
  })

  it('returns PROJECT_NOT_INITIALIZED when no project exists', async () => {
    const fs = new FakeFs({ '/other/file.txt': 'x' })
    const result = await locateProject(deps(fs), '/other/deep')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('PROJECT_NOT_INITIALIZED')
  })

  it('returns SESSION_UNAVAILABLE without an absolute cwd', async () => {
    const fs = new FakeFs({})
    for (const cwd of [undefined, '', 'relative/path']) {
      const result = await locateProject(deps(fs), cwd)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('SESSION_UNAVAILABLE')
    }
  })

  it('rejects an invalid manifest', async () => {
    const fs = new FakeFs({ '/proj/research.json': '{ not json' })
    const result = await locateProject(deps(fs), '/proj')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_ENTITY')
  })

  it('distinguishes an unsupported schema version', async () => {
    const fs = new FakeFs({
      '/proj/research.json': JSON.stringify({ schema_version: 2, project_id: UUID, name: 'x' }),
    })
    const result = await locateProject(deps(fs), '/proj')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('UNSUPPORTED_SCHEMA_VERSION')
  })

  it('rejects a project whose git top-level differs from its root', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const result = await locateProject(deps(fs, '/elsewhere'), '/proj')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('PROJECT_REPOSITORY_MISMATCH')
  })

  it('accepts a project without git for read operations', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const result = await locateProject(deps(fs, undefined), '/proj')
    expect(result.ok).toBe(true)
  })

  it('treats a project inside its own repository top level as valid', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const result = await locateProject(deps(fs, '/proj'), '/proj/nested')
    expect(result.ok).toBe(true)
  })
})
