import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { applyCommand, initProject } from '../../src/host/apply-command.js'
import type { ResearchHostDeps } from '../../src/host/apply-command.js'
import type { SubprocessPort } from '../../src/host/contracts.js'
import { checkpointMessage, initCheckpointMessage } from '../../src/host/git-checkpoints.js'
import { FakeFs, scriptedGit } from './fakes.js'
import type { ResearchCommand } from '../../src/core/commands.js'
import { projectRevision } from '../../src/core/revision.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const UUID_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const UUID_C = 'cccccccc-3333-4333-8333-333333333333'
const NODE = `node_${UUID_B}`
const RES = `res_${UUID_B}`
const OLD_SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const NEW_SHA = 'fedcba0987654321fedcba0987654321fedcba09'
const MANIFEST = JSON.stringify({ schema_version: 1, project_id: PROJECT_ID, name: 'Apply' })

function revisionOf(fs: FakeFs): string {
  const files = new Map<string, string>()
  for (const [path, content] of fs.entries()) {
    if (path === '/proj/research.json' || /^\/proj\/(questions|question-links|nodes|edges|evidence|results)\//.test(path)) {
      files.set(path.slice('/proj/'.length), content)
    }
  }
  return projectRevision(files, sha256)
}

function healthyGit(opts: { toplevel?: string; dirty?: boolean; failCommit?: boolean } = {}) {
  let currentHead = OLD_SHA
  const { port, calls } = scriptedGit((argv, cwd) => {
    const sub = argv[1]
    if (sub === 'symbolic-ref') return { stdout: 'main\n' }
    if (sub === 'rev-parse') {
      if (argv.includes('--show-toplevel')) return { stdout: `${opts.toplevel ?? cwd}\n` }
      return { stdout: `${currentHead}\n` }
    }
    if (sub === 'ls-files') return { stdout: '' }
    if (sub === 'status') return { stdout: opts.dirty === true ? ' M nodes/x.md\n' : '' }
    if (sub === 'commit') {
      if (opts.failCommit === true) return { exitCode: 128, stdout: '' }
      currentHead = NEW_SHA
      return { stdout: '' }
    }
    return { stdout: '' }
  })
  return { port, calls, head: () => currentHead }
}

function deps(fs: FakeFs, git: SubprocessPort): ResearchHostDeps {
  return {
    fs,
    subprocess: git,
    hash: sha256,
  }
}

async function setup(fsEntries: Record<string, string>, gitOpts?: Parameters<typeof healthyGit>[0]) {
  const fs = new FakeFs(fsEntries)
  const git = healthyGit(gitOpts)
  const host = deps(fs, git.port)
  return { fs, git, host }
}

const CREATE_NODE: ResearchCommand = {
  kind: 'create_node',
  id: NODE,
  nodeKind: 'hypothesis',
  confidence: 'moderate',
  body: '# Claim\n\nBody.\n',
}

describe('applyCommand', () => {
  it('applies one entity and checkpoints only its planned path', async () => {
    const { fs, git, host } = await setup({ '/proj/research.json': MANIFEST })
    const result = await applyCommand(host, {
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: true, kind: 'create_node', entityId: NODE, checkpointId: NEW_SHA })
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toContain('kind: hypothesis')
    expect(git.calls.find((call) => call[1] === 'add')).toEqual([
      'C:\\git\\git.exe', 'add', '--', `nodes/${NODE}.md`,
    ])
    expect(git.calls.find((call) => call[1] === 'commit')?.slice(5)).toEqual(['--', `nodes/${NODE}.md`])
    expect(git.calls.find((call) => call[1] === 'commit')?.[4]).toBe(checkpointMessage('create_node', NODE))
  })

  it('rejects a stale project revision before Git or a write', async () => {
    const { fs, git, host } = await setup({ '/proj/research.json': MANIFEST })
    const result = await applyCommand(host, {
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: '0'.repeat(64),
    })
    expect(result).toMatchObject({ ok: false, code: 'STALE_REVISION' })
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toBeUndefined()
    expect(git.calls.some((call) => call[1] === 'commit')).toBe(false)
  })

  it('rejects an invalid project as read-only', async () => {
    const fs = new FakeFs({
      '/proj/research.json': MANIFEST,
      '/proj/nodes/readme.md': '# stray',
    })
    const git = healthyGit()
    const host = deps(fs, git.port)
    const result = await applyCommand(host, {
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENTITY', recoverable: false })
  })

  it('rejects mutations when managed paths are dirty', async () => {
    const { fs, host } = await setup({ '/proj/research.json': MANIFEST }, { dirty: true })
    const result = await applyCommand(host, {
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'READ_ONLY_CONFLICT' })
  })

  it('rejects an invalid typed command from Core planning', async () => {
    const { fs, host } = await setup({ '/proj/research.json': MANIFEST })
    const result = await applyCommand(host, {
      sessionCwd: '/proj',
      command: { kind: 'create_node', id: NODE, nodeKind: 'finding', confidence: 'low', body: 'x' },
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })

  it('leaves the written file and reports a checkpoint failure without destructive cleanup', async () => {
    const { fs, git, host } = await setup({ '/proj/research.json': MANIFEST }, { failCommit: true })
    const result = await applyCommand(host, {
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_FAILED', recoverable: true })
    expect((result as { message?: string }).message).toMatch(/left in place/i)
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toBeDefined()
    expect(git.calls.some((call) => ['checkout', 'rm', 'clean', 'restore'].includes(call[1] ?? ''))).toBe(false)
  })

  it('reports an uncertain commit without claiming recovery', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    let committed = false
    const { port } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { stdout: '/proj\n' }
      if (sub === 'rev-parse') return committed ? { exitCode: 128, stdout: '' } : { stdout: `${OLD_SHA}\n` }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      if (sub === 'commit') {
        committed = true
        return { stdout: '' }
      }
      return { stdout: '' }
    })
    const host = deps(fs, port)
    const result = await applyCommand(host, {
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_FAILED', recoverable: false })
  })

  it('rejects an update whose target file version is stale', async () => {
    const nodeFile = `---\nid: ${NODE}\nkind: hypothesis\nconfidence: low\n---\n# Old\n\nBody.\n`
    const { fs, host } = await setup({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: nodeFile,
    })
    const result = await applyCommand(host, {
      sessionCwd: '/proj',
      command: { kind: 'update_node', id: NODE, expectedFileVersion: '0'.repeat(64), body: '# New\n' },
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'STALE_TARGET' })
  })

  it('reports an external managed edit after the write without rolling it back', async () => {
    const targetPath = `/proj/nodes/${NODE}.md`
    const otherPath = `/proj/nodes/node_${UUID_C}.md`
    const otherFile = `---\nid: node_${UUID_C}\nkind: hypothesis\nconfidence: low\n---\n# External\n`
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    fs.onBeforeWrite = (path) => {
      if (path === targetPath) fs.writeExternal(otherPath, otherFile)
    }
    const git = healthyGit()
    const host = deps(fs, git.port)
    const result = await applyCommand(host, {
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'STALE_REVISION' })
    expect(fs.contentOf(targetPath)).toBeDefined()
    expect(fs.contentOf(otherPath)).toBe(otherFile)
    expect(git.calls.some((call) => call[1] === 'commit')).toBe(false)
  })

  it('serializes concurrent mutations on one project', async () => {
    const { fs, host } = await setup({ '/proj/research.json': MANIFEST })
    const before = revisionOf(fs)
    const first = applyCommand(host, {
      sessionCwd: '/proj', command: CREATE_NODE, expectedProjectRevision: before,
    })
    const second = applyCommand(host, {
      sessionCwd: '/proj',
      command: { kind: 'create_result', id: RES, observedAt: '2026-08-24', body: '# R\n' },
      expectedProjectRevision: before,
    })
    const [a, b] = await Promise.all([first, second])
    expect(a.ok).toBe(true)
    expect(b).toMatchObject({ ok: false, code: 'STALE_REVISION' })
  })

  it('deletes one Core-derived managed path with git rm and checkpoints it', async () => {
    const nodeFile = `---\nid: ${NODE}\nkind: hypothesis\nconfidence: low\n---\n# Disposable branch\n`
    const fs = new FakeFs({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: nodeFile,
    })
    let currentHead = OLD_SHA
    const git = scriptedGit((argv, cwd) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') {
        if (argv.includes('--show-toplevel')) return { stdout: `${cwd}\n` }
        return { stdout: `${currentHead}\n` }
      }
      if (sub === 'ls-files' || sub === 'status' || sub === 'add') return { stdout: '' }
      if (sub === 'rm') {
        fs.deleteFile(`/proj/${argv[3]}`)
        return { stdout: '' }
      }
      if (sub === 'commit') {
        currentHead = NEW_SHA
        return { stdout: '' }
      }
      return { stdout: '' }
    })
    const result = await applyCommand(deps(fs, git.port), {
      sessionCwd: '/proj',
      command: {
        kind: 'delete_node',
        id: NODE,
        expectedFileVersion: sha256(nodeFile),
      },
      expectedProjectRevision: revisionOf(fs),
    })

    expect(result).toMatchObject({ ok: true, kind: 'delete_node', entityId: NODE, checkpointId: NEW_SHA })
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toBeUndefined()
    expect(git.calls.find((call) => call[1] === 'rm')).toEqual([
      'C:\\git\\git.exe', 'rm', '--', `nodes/${NODE}.md`,
    ])
    expect(git.calls.some((call) => call[1] === 'add')).toBe(false)
    expect(git.calls.find((call) => call[1] === 'commit')?.slice(5)).toEqual(['--', `nodes/${NODE}.md`])
  })

  it('does not claim a deletion when git rm fails', async () => {
    const nodeFile = `---\nid: ${NODE}\nkind: hypothesis\nconfidence: low\n---\n# Keep\n`
    const fs = new FakeFs({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: nodeFile,
    })
    const git = scriptedGit((argv, cwd) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') {
        if (argv.includes('--show-toplevel')) return { stdout: `${cwd}\n` }
        return { stdout: `${OLD_SHA}\n` }
      }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      if (sub === 'rm') return { exitCode: 1, stdout: '' }
      return { stdout: '' }
    })

    const result = await applyCommand(deps(fs, git.port), {
      sessionCwd: '/proj',
      command: {
        kind: 'delete_node',
        id: NODE,
        expectedFileVersion: sha256(nodeFile),
      },
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'STALE_TARGET', entityId: NODE })
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toBe(nodeFile)
    expect(git.calls.some((call) => call[1] === 'commit')).toBe(false)
  })
})

describe('initProject', () => {
  function initGit(opts: { failCommit?: boolean; detached?: boolean; identity?: boolean } = {}) {
    let committed = false
    return scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { exitCode: 128, stdout: '' }
      if (sub === 'init') return { stdout: '' }
      if (sub === 'symbolic-ref') return opts.detached ? { exitCode: 1, stdout: '' } : { stdout: 'main\n' }
      if (sub === 'rev-parse') return committed ? { stdout: `${NEW_SHA}\n` } : { exitCode: 128, stdout: '' }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      if (sub === 'config') return opts.identity === false ? { exitCode: 1, stdout: '' } : { stdout: 'configured\n' }
      if (sub === 'commit') {
        if (opts.failCommit) return { exitCode: 128, stdout: '' }
        committed = true
        return { stdout: '' }
      }
      return { stdout: '' }
    })
  }

  it('creates a project and checkpoints only research.json', async () => {
    const fs = new FakeFs({})
    const git = initGit()
    const mkdirs: string[] = []
    const host = {
      ...deps(fs, git.port),
      mkdirs: (root: string) => mkdirs.push(root),
    }
    const result = await initProject(host, { sessionCwd: '/newproj' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.name).toBe('newproj')
    expect(fs.contentOf('/newproj/research.json')).toContain(result.projectId)
    expect(mkdirs).toEqual(['/newproj'])
    const commit = git.calls.find((call) => call[1] === 'commit')!
    expect(commit[4]).toBe(initCheckpointMessage())
    expect(commit.slice(5)).toEqual(['--', 'research.json'])
  })

  it('leaves the manifest when the baseline checkpoint fails', async () => {
    const fs = new FakeFs({})
    const git = initGit({ failCommit: true })
    const host = { ...deps(fs, git.port), mkdirs: () => {} }
    const result = await initProject(host, { sessionCwd: '/newproj' })
    expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_FAILED' })
    expect(fs.contentOf('/newproj/research.json')).toBeDefined()
    expect(git.calls.some((call) => ['rm', 'clean', 'checkout', 'restore'].includes(call[1] ?? ''))).toBe(false)
  })

  it('rejects a detached repository before writing', async () => {
    const fs = new FakeFs({})
    const git = initGit({ detached: true })
    const mkdirs: string[] = []
    const host = { ...deps(fs, git.port), mkdirs: (root: string) => mkdirs.push(root) }
    const result = await initProject(host, { sessionCwd: '/newproj' })
    expect(result).toMatchObject({ ok: false, code: 'GIT_STATE_UNSUPPORTED' })
    expect(fs.contentOf('/newproj/research.json')).toBeUndefined()
    expect(mkdirs).toEqual([])
  })

  it('refuses when a project already exists above the cwd', async () => {
    const { host } = await setup({ '/proj/research.json': MANIFEST })
    expect(await initProject(host, { sessionCwd: '/proj/deep' })).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })

  it('refuses a cwd inside a foreign repository', async () => {
    const fs = new FakeFs({})
    const git = healthyGit({ toplevel: '/other' })
    const host = deps(fs, git.port)
    expect(await initProject(host, { sessionCwd: '/newproj' })).toMatchObject({ ok: false, code: 'PROJECT_REPOSITORY_MISMATCH' })
  })

  it('returns a structured failure when directory creation fails', async () => {
    const fs = new FakeFs({})
    const git = initGit()
    const host = {
      ...deps(fs, git.port),
      mkdirs: () => { throw new Error('permission denied') },
    }
    expect(await initProject(host, { sessionCwd: '/newproj' })).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
    expect(fs.contentOf('/newproj/research.json')).toBeUndefined()
  })

  it('refuses to write when Git identity is missing', async () => {
    const fs = new FakeFs({})
    const git = initGit({ identity: false })
    const host = deps(fs, git.port)
    expect(await initProject(host, { sessionCwd: '/newproj' })).toMatchObject({ ok: false, code: 'GIT_UNAVAILABLE' })
  })
})
