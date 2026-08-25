import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  applyCommand,
  backStep,
  forwardStep,
  initProject,
} from '../../src/host/apply-command.js'
import type { ResearchHostDeps } from '../../src/host/apply-command.js'
import type { SubprocessPort } from '../../src/host/contracts.js'
import { checkpointMessage, initCheckpointMessage } from '../../src/host/git-checkpoints.js'
import { FakeFs, FakeStorageDomainPort, scriptedGit } from './fakes.js'
import { uiStateDomainSpec, TABLE_UNDO, UI_STATE_DOMAIN } from '../../src/host/ui-state.js'
import type { ResearchCommand } from '../../src/core/commands.js'
import { projectRevision } from '../../src/core/revision.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const UUID_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const UUID_C = 'cccccccc-3333-4333-8333-333333333333'
const NODE = `node_${UUID_B}`
const EV = `ev_${UUID_B}`
const RES = `res_${UUID_B}`

const OLD_SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const NEW_SHA = 'fedcba0987654321fedcba0987654321fedcba09'
const RESTORE_SHA = '1111111122222222333333334444444455555555'

const MANIFEST = JSON.stringify({ schema_version: 1, project_id: PROJECT_ID, name: 'Apply' })

function revisionOf(fs: FakeFs): string {
  const files = new Map<string, string>()
  for (const [path, content] of fs.entries()) {
    if (path === '/proj/research.json' || /^\/proj\/(nodes|edges|evidence|results)\//.test(path)) {
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
    if (sub === 'ls-tree') {
      const path = argv[argv.length - 1]
      if (path === 'research.json') return { stdout: 'research.json\n' }
      if (path === 'nodes') return { stdout: `nodes/${NODE}.md\n` }
      return { stdout: '' }
    }
    if (sub === 'commit') {
      if (opts.failCommit === true) return { exitCode: 128, stdout: '' }
      currentHead = NEW_SHA
      return { stdout: '' }
    }
    return { stdout: '' }
  })
  return { port, calls, head: () => currentHead, moveHead: (next: string) => { currentHead = next } }
}

async function deps(fs: FakeFs, git: SubprocessPort, storage: FakeStorageDomainPort): Promise<ResearchHostDeps> {
  return {
    fs,
    subprocess: git,
    storage: await storage.open(uiStateDomainSpec()),
    hash: sha256,
  }
}

async function setup(fsEntries: Record<string, string>, gitOpts?: Parameters<typeof healthyGit>[0]) {
  const fs = new FakeFs(fsEntries)
  const git = healthyGit(gitOpts)
  const storage = new FakeStorageDomainPort()
  const host = await deps(fs, git.port, storage)
  return { fs, git, storage, host }
}

const CREATE_NODE: ResearchCommand = {
  kind: 'create_node',
  id: NODE,
  nodeKind: 'hypothesis',
  confidence: 'moderate',
  body: '# Claim\n\nBody.\n',
}

describe('applyCommand', () => {
  it('applies a create command end to end and records undo state', async () => {
    const { fs, git, host, storage } = await setup({ '/proj/research.json': MANIFEST })
    const before = revisionOf(fs)
    const result = await applyCommand(host, {
      sessionId: 'session-1',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: before,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('create_node')
    expect(result.checkpointId).toBe(NEW_SHA)
    expect(result.revision).toBe(revisionOf(fs))
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toContain('kind: hypothesis')

    const commitCall = git.calls.find((call) => call[1] === 'commit')
    expect(commitCall).toBeDefined()
    expect(commitCall![4]).toBe(checkpointMessage('create_node', NODE))

    const undoTable = storage.tableOf(UI_STATE_DOMAIN, TABLE_UNDO)
    const record = undoTable?.records.get(`${PROJECT_ID}:main`) as
      | { previousCheckpointId?: string; forwardCheckpointId?: string; recordedHead: string }
      | undefined
    expect(record?.recordedHead).toBe(NEW_SHA)
    expect(record?.previousCheckpointId).toBe(OLD_SHA)
    expect(record?.forwardCheckpointId).toBeUndefined()
  })

  it('rejects a stale project revision', async () => {
    const { host } = await setup({ '/proj/research.json': MANIFEST })
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: '0'.repeat(64),
    })
    expect(result).toMatchObject({ ok: false, code: 'STALE_REVISION' })
  })

  it('rejects an invalid project as read-only', async () => {
    const { host } = await setup({
      '/proj/research.json': MANIFEST,
      '/proj/nodes/readme.md': '# stray',
    })
    const before = revisionOf(new FakeFs({ '/proj/research.json': MANIFEST, '/proj/nodes/readme.md': '# stray' }))
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: before,
    })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })

  it('rejects mutations when the managed tree is dirty', async () => {
    const { fs, host } = await setup({ '/proj/research.json': MANIFEST }, { dirty: true })
    const before = revisionOf(fs)
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: before,
    })
    expect(result).toMatchObject({ ok: false, code: 'READ_ONLY_CONFLICT' })
  })

  it('rejects invalid commands with their planning issue code', async () => {
    const { fs, host } = await setup({ '/proj/research.json': MANIFEST })
    const before = revisionOf(fs)
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: { kind: 'create_node', id: NODE, nodeKind: 'finding', confidence: 'low', body: 'x' },
      expectedProjectRevision: before,
    })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })

  it('rolls back a create when the checkpoint fails', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const { port, calls } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') {
        return { stdout: argv.includes('--show-toplevel') ? '/proj\n' : `${OLD_SHA}\n` }
      }
      if (sub === 'ls-files') return { stdout: '' }
      if (sub === 'status') return { stdout: '' }
      if (sub === 'commit') return { exitCode: 128, stdout: '' }
      if (sub === 'rm' || sub === 'clean') {
        fs.deleteFile(`/proj/${argv[4]}`)
        return { stdout: '' }
      }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const host = await deps(fs, port, storage)
    const before = revisionOf(fs)
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: before,
    })
    expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_FAILED' })
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toBeUndefined()
    expect(calls.some((call) => call[1] === 'rm')).toBe(true)
  })

  it('checkpoints only the entity path planned by the command', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const { port, calls } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') {
        return { stdout: argv.includes('--show-toplevel') ? '/proj\n' : `${NEW_SHA}\n` }
      }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      if (sub === 'commit') return { stdout: '' }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const host = await deps(fs, port, storage)
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result.ok).toBe(true)
    const expectedPath = `nodes/${NODE}.md`
    expect(calls.find((call) => call[1] === 'add')).toEqual([
      'C:\\git\\git.exe', 'add', '--', expectedPath,
    ])
    expect(calls.find((call) => call[1] === 'commit')?.slice(5)).toEqual(['--', expectedPath])
  })

  it('reports rollback failure instead of claiming a clean rollback', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const { port } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') return { stdout: argv.includes('--show-toplevel') ? '/proj\n' : `${OLD_SHA}\n` }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      if (sub === 'commit') return { exitCode: 128, stdout: '' }
      if (sub === 'rm' || sub === 'clean') return { exitCode: 1, stdout: '' }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const host = await deps(fs, port, storage)
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_FAILED', recoverable: false })
    expect((result as { message?: string }).message).toMatch(/rollback failed/i)
  })

  it('does not treat a no-op git clean as a successful create rollback', async () => {
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    const { port } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') return { stdout: argv.includes('--show-toplevel') ? '/proj\n' : `${OLD_SHA}\n` }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      if (sub === 'commit' || sub === 'rm') return { exitCode: 128, stdout: '' }
      if (sub === 'clean') return { stdout: '' }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const host = await deps(fs, port, storage)

    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })

    expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_FAILED', recoverable: false })
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toBeDefined()
  })

  it('rolls back an update when the checkpoint fails', async () => {
    const nodeFile = `---\nid: ${NODE}\nkind: hypothesis\nconfidence: low\n---\n# Old\n\nBody.\n`
    const fs = new FakeFs({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: nodeFile,
    })
    const { port, calls } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') {
        return { stdout: argv.includes('--show-toplevel') ? '/proj\n' : `${OLD_SHA}\n` }
      }
      if (sub === 'ls-files') return { stdout: '' }
      if (sub === 'status') return { stdout: '' }
      if (sub === 'commit') return { exitCode: 128, stdout: '' }
      if (sub === 'checkout') {
        fs.writeExternal(`/proj/${argv[4]}`, nodeFile)
        return { stdout: '' }
      }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const host = await deps(fs, port, storage)
    const before = revisionOf(fs)
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: {
        kind: 'update_node',
        id: NODE,
        expectedFileVersion: sha256(nodeFile),
        body: '# New\n\nOther.\n',
      },
      expectedProjectRevision: before,
    })
    expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_FAILED' })
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toBe(nodeFile)
    expect(calls.some((call) => call[1] === 'checkout' && call[2] === 'HEAD')).toBe(true)
  })

  it('does not overwrite an external target edit during rollback', async () => {
    const nodeFile = `---\nid: ${NODE}\nkind: hypothesis\nconfidence: low\n---\n# Old\n\nBody.\n`
    const targetPath = `/proj/nodes/${NODE}.md`
    const otherPath = `/proj/nodes/${UUID_C}.md`
    const otherFile = `---\nid: ${UUID_C}\nkind: hypothesis\nconfidence: low\n---\n# Other\n\nBody.\n`
    const externalFile = `${nodeFile}external edit\n`
    const fs = new FakeFs({
      '/proj/research.json': MANIFEST,
      [targetPath]: nodeFile,
    })
    let targetReads = 0
    fs.onBeforeWrite = (path) => {
      if (path === targetPath) fs.writeExternal(otherPath, otherFile)
    }
    fs.onBeforeReadText = (path) => {
      if (path === targetPath) {
        targetReads += 1
        // Reads 1 and 2 belong to the initial and post-write snapshots. The
        // third read is the compensation ownership check.
        if (targetReads === 3) fs.writeExternal(targetPath, externalFile)
      }
    }
    const { port, calls } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') return { stdout: argv.includes('--show-toplevel') ? '/proj\n' : `${OLD_SHA}\n` }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const host = await deps(fs, port, storage)
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: {
        kind: 'update_node',
        id: NODE,
        expectedFileVersion: sha256(nodeFile),
        body: '# New\n\nOther.\n',
      },
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_FAILED', recoverable: false })
    expect(fs.contentOf(targetPath)).toBe(externalFile)
    expect(calls.some((call) => call[1] === 'checkout' && call[2] === 'HEAD')).toBe(false)
  })

  it('rejects an update whose target changed externally', async () => {
    const nodeFile = `---\nid: ${NODE}\nkind: hypothesis\nconfidence: low\n---\n# Old\n\nBody.\n`
    const { fs, host } = await setup({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: nodeFile,
    })
    const before = revisionOf(fs)
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: {
        kind: 'update_node',
        id: NODE,
        expectedFileVersion: '0'.repeat(64),
        body: '# New\n\nOther.\n',
      },
      expectedProjectRevision: before,
    })
    expect(result).toMatchObject({ ok: false, code: 'STALE_TARGET' })
  })

  it('rejects a target edited after the initial project snapshot', async () => {
    const nodeFile = `---\nid: ${NODE}\nkind: hypothesis\nconfidence: low\n---\n# Old\n\nBody.\n`
    const { fs, host } = await setup({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: nodeFile,
    })
    let edited = false
    fs.onAfterReadText = (path) => {
      if (!edited && path === `/proj/nodes/${NODE}.md`) {
        edited = true
        fs.writeExternal(path, `${nodeFile}external\n`)
      }
    }
    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: {
        kind: 'update_node',
        id: NODE,
        expectedFileVersion: sha256(nodeFile),
        body: '# New\n',
      },
      expectedProjectRevision: revisionOf(fs),
    })
    expect(result).toMatchObject({ ok: false, code: 'STALE_TARGET' })
    expect(fs.contentOf(`/proj/nodes/${NODE}.md`)).toContain('external')
  })

  it('rolls back its target when another managed file changes after preflight', async () => {
    const otherNode = `node_${UUID_C}`
    const otherPath = `/proj/nodes/${otherNode}.md`
    const otherFile = `---\nid: ${otherNode}\nkind: hypothesis\nconfidence: low\n---\n# External\n\nBody.\n`
    const targetPath = `/proj/nodes/${NODE}.md`
    const fs = new FakeFs({ '/proj/research.json': MANIFEST })
    let injected = false
    fs.onBeforeWrite = (path) => {
      if (!injected && path === targetPath) {
        injected = true
        fs.writeExternal(otherPath, otherFile)
      }
    }
    let currentHead = OLD_SHA
    const { port, calls } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') {
        return { stdout: argv.includes('--show-toplevel') ? '/proj\n' : `${currentHead}\n` }
      }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      if (sub === 'commit') {
        currentHead = NEW_SHA
        return { stdout: '' }
      }
      if (sub === 'rm' || sub === 'clean') {
        fs.deleteFile(`/proj/${argv.at(-1)}`)
        return { stdout: '' }
      }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const host = await deps(fs, port, storage)

    const result = await applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: revisionOf(fs),
    })

    expect(result).toMatchObject({ ok: false, code: 'STALE_REVISION' })
    expect(fs.contentOf(targetPath)).toBeUndefined()
    expect(fs.contentOf(otherPath)).toBe(otherFile)
    expect(calls.some((call) => call[1] === 'commit')).toBe(false)
    expect(storage.tableOf(UI_STATE_DOMAIN, TABLE_UNDO)?.size).toBe(0)
  })

  it('serializes concurrent mutations on one project', async () => {
    const { fs, host } = await setup({ '/proj/research.json': MANIFEST })
    const before = revisionOf(fs)
    const first = applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: CREATE_NODE,
      expectedProjectRevision: before,
    })
    const second = applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: {
        kind: 'create_result',
        id: RES,
        observedAt: '2026-08-24',
        body: '# R\n\nBody.\n',
      },
      expectedProjectRevision: before,
    })
    const [a, b] = await Promise.all([first, second])
    expect(a.ok).toBe(true)
    // the second mutation read the project after the first committed
    expect(b).toMatchObject({ ok: false, code: 'STALE_REVISION' })
  })
})

describe('backStep and forwardStep', () => {
  const nodeFile = `---\nid: ${NODE}\nkind: hypothesis\nconfidence: low\n---\n# Old\n\nBody.\n`

  async function setupWithUndo(record: Record<string, unknown>, gitOpts?: Parameters<typeof healthyGit>[0]) {
    const { fs, git, storage, host } = await setup({ '/proj/research.json': MANIFEST, [`/proj/nodes/${NODE}.md`]: nodeFile }, gitOpts)
    const undoTable = storage.tableOf(UI_STATE_DOMAIN, TABLE_UNDO)!
    undoTable.records.set(`${PROJECT_ID}:main`, {
      branch: 'main',
      recordedHead: OLD_SHA,
      lastCheckpointId: NEW_SHA,
      ...record,
    })
    return { fs, git, host, storage }
  }

  it('restores the previous checkpoint and enables one forward step', async () => {
    const { fs, git, host, storage } = await setupWithUndo({ previousCheckpointId: RESTORE_SHA })
    const before = revisionOf(fs)
    const result = await backStep(host, { sessionCwd: '/proj', expectedProjectRevision: before })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.checkpointId).toBe(NEW_SHA)
    expect(git.calls.some((call) => call[1] === 'checkout' && call[2] === RESTORE_SHA)).toBe(true)
    const commit = git.calls.find((call) => call[1] === 'commit')
    expect(commit).toContain(`scifork: back to ${RESTORE_SHA.slice(0, 12)}`)
    const undoTable = storage.tableOf(UI_STATE_DOMAIN, TABLE_UNDO)!
    const record = undoTable.records.get(`${PROJECT_ID}:main`) as { forwardCheckpointId?: string }
    expect(record.forwardCheckpointId).toBe(NEW_SHA)
  })

  it('includes managed files removed during restore in the restore commit', async () => {
    const { fs, git, host } = await setupWithUndo({
      previousCheckpointId: RESTORE_SHA,
    })
    fs.writeExternal(`/proj/results/${RES}.md`, `---\nid: ${RES}\nstatus: draft\nobserved_at: "2026-08-24"\n---\nresult\n`)
    const before = revisionOf(fs)
    const result = await backStep(host, { sessionCwd: '/proj', expectedProjectRevision: before })
    expect(result.ok).toBe(true)
    const commit = git.calls.find((call) => call[1] === 'commit')
    expect(commit).toContain(`results/${RES}.md`)
  })

  it('serializes navigation with mutations on one project', async () => {
    const { fs, git, host } = await setupWithUndo({ previousCheckpointId: RESTORE_SHA })
    const originalSpawn = git.port.spawn.bind(git.port)
    git.port.spawn = (spec) => {
      if (spec.argv[1] === 'checkout' && spec.argv[2] === RESTORE_SHA) {
        fs.writeExternal(`/proj/nodes/${NODE}.md`, `${nodeFile}restored\n`)
      }
      return originalSpawn(spec)
    }
    const before = revisionOf(fs)
    const back = backStep(host, { sessionCwd: '/proj', expectedProjectRevision: before })
    const mutation = applyCommand(host, {
      sessionId: 's',
      sessionCwd: '/proj',
      command: { kind: 'create_result', id: RES, observedAt: '2026-08-24', body: '# R\n' },
      expectedProjectRevision: before,
    })
    const [backResult, mutationResult] = await Promise.all([back, mutation])
    expect([backResult.ok, mutationResult.ok]).toContain(true)
    expect([backResult, mutationResult].some((value) => !value.ok && value.code === 'STALE_REVISION')).toBe(true)
  })

  it('fails when no previous checkpoint is recorded', async () => {
    const { fs, host } = await setupWithUndo({})
    const before = revisionOf(fs)
    const result = await backStep(host, { sessionCwd: '/proj', expectedProjectRevision: before })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })

  it('reports a managed-tree conflict before navigation', async () => {
    const { fs, host } = await setupWithUndo({ previousCheckpointId: RESTORE_SHA }, { dirty: true })
    const result = await backStep(host, { sessionCwd: '/proj', expectedProjectRevision: revisionOf(fs) })
    expect(result).toMatchObject({ ok: false, code: 'READ_ONLY_CONFLICT' })
  })

  it('clears undo state when HEAD moved externally', async () => {
    const { fs, git, host, storage } = await setupWithUndo({ previousCheckpointId: RESTORE_SHA })
    git.moveHead('9999999999999999999999999999999999999999')
    const before = revisionOf(fs)
    const result = await backStep(host, { sessionCwd: '/proj', expectedProjectRevision: before })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
    const undoTable = storage.tableOf(UI_STATE_DOMAIN, TABLE_UNDO)!
    expect(undoTable.records.size).toBe(0)
  })

  it('forwards to the restored-away checkpoint after a back', async () => {
    const { fs, git, host, storage } = await setupWithUndo({ previousCheckpointId: RESTORE_SHA })
    const before = revisionOf(fs)
    const back = await backStep(host, { sessionCwd: '/proj', expectedProjectRevision: before })
    expect(back.ok).toBe(true)

    // after Back the undo record exposes forwardCheckpointId
    const undoTable = storage.tableOf(UI_STATE_DOMAIN, TABLE_UNDO)!
    const afterBack = undoTable.records.get(`${PROJECT_ID}:main`) as { forwardCheckpointId?: string }
    expect(afterBack.forwardCheckpointId).toBe(NEW_SHA)

    const afterRevision = revisionOf(fs)
    const forward = await forwardStep(host, { sessionCwd: '/proj', expectedProjectRevision: afterRevision })
    expect(forward.ok).toBe(true)
    if (!forward.ok) return
    expect(git.calls.some((call) => call[1] === 'checkout' && call[2] === NEW_SHA)).toBe(true)
  })

  it('rejects forward when nothing was backed away', async () => {
    const { fs, host } = await setupWithUndo({ previousCheckpointId: RESTORE_SHA })
    const before = revisionOf(fs)
    const result = await forwardStep(host, { sessionCwd: '/proj', expectedProjectRevision: before })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })
})

describe('initProject', () => {
  it('initializes a new project with a baseline checkpoint', async () => {
    const fs = new FakeFs({})
    const { port, calls } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { exitCode: 128, stdout: '' }
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') return { stdout: `${NEW_SHA}\n` }
      if (sub === 'ls-files') return { stdout: '' }
      if (sub === 'status') return { stdout: '' }
      if (sub === 'init') return { stdout: '' }
      if (sub === 'commit') return { stdout: '' }
      if (sub === 'config') {
        const key = argv[argv.length - 1]
        if (key === 'user.name') return { stdout: 'Ada\n' }
        if (key === 'user.email') return { stdout: 'ada@example.com\n' }
        return { exitCode: 1 }
      }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const mkdirs: string[] = []
    const host = {
      ...await deps(fs, port, storage),
      mkdirs: (root: string) => {
        mkdirs.push(root)
      },
    }
    const result = await initProject(host, { sessionCwd: '/newproj' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.name).toBe('newproj')
    expect(result.checkpointId).toBe(NEW_SHA)
    expect(mkdirs).toEqual(['/newproj'])
    expect(fs.contentOf('/newproj/research.json')).toContain(result.projectId)
    const commitCall = calls.find((call) => call[1] === 'commit')
    expect(commitCall?.[4]).toBe(initCheckpointMessage())
    const undoTable = storage.tableOf(UI_STATE_DOMAIN, TABLE_UNDO)
    const record = undoTable?.records.get(`${result.projectId}:main`) as { previousCheckpointId?: string }
    expect(record.previousCheckpointId).toBeUndefined()
  })

  it('removes a staged manifest when the baseline checkpoint fails', async () => {
    const fs = new FakeFs({})
    const { port, calls } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { exitCode: 128, stdout: '' }
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') return { exitCode: 128, stdout: '' }
      if (sub === 'ls-files' || sub === 'status' || sub === 'init') return { stdout: '' }
      if (sub === 'config') return { stdout: 'configured\n' }
      if (sub === 'commit') return { exitCode: 128, stdout: '' }
      if (sub === 'rm' || sub === 'clean') {
        fs.deleteFile('/newproj/research.json')
        return { stdout: '' }
      }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const host = { ...await deps(fs, port, storage), mkdirs: () => {} }

    const result = await initProject(host, { sessionCwd: '/newproj' })

    expect(result).toMatchObject({ ok: false, code: 'CHECKPOINT_FAILED' })
    expect(fs.contentOf('/newproj/research.json')).toBeUndefined()
    expect(calls.some((call) => call[1] === 'rm' && call.at(-1) === 'research.json')).toBe(true)
    expect(calls.some((call) => call[1] === 'clean' && call.at(-1) === 'research.json')).toBe(true)
  })

  it('rejects a detached repository before writing or checkpointing', async () => {
    const fs = new FakeFs({})
    const { port, calls } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { stdout: '/newproj\n' }
      if (sub === 'symbolic-ref') return { exitCode: 1, stdout: '' }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const mkdirs: string[] = []
    const host = {
      ...await deps(fs, port, storage),
      mkdirs: (root: string) => {
        mkdirs.push(root)
      },
    }

    const result = await initProject(host, { sessionCwd: '/newproj' })

    expect(result).toMatchObject({ ok: false, code: 'GIT_STATE_UNSUPPORTED' })
    expect(fs.contentOf('/newproj/research.json')).toBeUndefined()
    expect(mkdirs).toEqual([])
    expect(calls.some((call) => call[1] === 'commit')).toBe(false)
    expect(calls.some((call) => call[1] === 'config')).toBe(false)
  })

  it('refuses when a project already exists above', async () => {
    const { host } = await setup({ '/proj/research.json': MANIFEST })
    const result = await initProject(host, { sessionCwd: '/proj/deep' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })

  it('refuses a cwd inside a foreign repository', async () => {
    const fs = new FakeFs({})
    const git = healthyGit({ toplevel: '/other' })
    const storage = new FakeStorageDomainPort()
    const host = await deps(fs, git.port, storage)
    const result = await initProject(host, { sessionCwd: '/newproj' })
    expect(result).toMatchObject({ ok: false, code: 'PROJECT_REPOSITORY_MISMATCH' })
  })

  it('returns a structured failure when managed directories cannot be created', async () => {
    const fs = new FakeFs({})
    const { port } = scriptedGit((argv) => {
      const sub = argv[1]
      if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { exitCode: 128, stdout: '' }
      if (sub === 'init') return { stdout: '' }
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') return { exitCode: 128, stdout: '' }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      if (sub === 'config') return { stdout: 'configured\n' }
      return { stdout: '' }
    })
    const storage = new FakeStorageDomainPort()
    const host = {
      ...await deps(fs, port, storage),
      mkdirs: () => {
        throw new Error('permission denied')
      },
    }
    const result = await initProject(host, { sessionCwd: '/newproj' })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_ENTITY', recoverable: false })
    expect(fs.contentOf('/newproj/research.json')).toBeUndefined()
  })

  it('refuses when git identity is missing', async () => {
    const fs = new FakeFs({})
    const gitPort = scriptedGit((argv, cwd) => {
      const sub = argv[1]
      if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { exitCode: 128, stdout: '' }
      if (sub === 'init') return { stdout: '' }
      if (sub === 'symbolic-ref') return { stdout: 'main\n' }
      if (sub === 'rev-parse') return { exitCode: 128, stdout: '' }
      if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
      if (sub === 'config') return { exitCode: 1, stdout: '' }
      return { stdout: '' }
    }).port
    const storage = new FakeStorageDomainPort()
    const host = await deps(fs, gitPort, storage)
    const result = await initProject(host, { sessionCwd: '/newproj' })
    expect(result).toMatchObject({ ok: false, code: 'GIT_UNAVAILABLE' })
  })
})
