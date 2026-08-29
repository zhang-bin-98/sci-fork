import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { projectRevision } from '../../src/core/revision.js'
import {
  CompanionService,
  type CompanionServiceDeps,
} from '../../src/host/companion-service.js'
import type { SessionPort, SessionsPort } from '../../src/host/contracts.js'
import { PageKeyStore } from '../../src/host/page-keys.js'
import { uiStateDomainSpec } from '../../src/host/ui-state.js'
import { FakeFs, FakeStorageDomainPort, scriptedGit } from './fakes.js'

const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex')

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const OTHER_PROJECT_ID = 'dddddddd-4444-4444-8444-444444444444'
const UUID_NODE = 'bbbbbbbb-2222-4222-8222-222222222222'
const UUID_RESULT = 'cccccccc-3333-4333-8333-333333333333'
const NODE = `node_${UUID_NODE}`
const EVIDENCE = `ev_${UUID_NODE}`
const RESULT = `res_${UUID_RESULT}`
const EDGE = `edge_${UUID_NODE}`

const MANIFEST = JSON.stringify({
  schema_version: 1,
  project_id: PROJECT_ID,
  name: 'STAT3 resistance study',
})

const NODE_FILE = [
  '---',
  `id: ${NODE}`,
  'kind: hypothesis',
  'confidence: moderate',
  'evidence_refs:',
  `  - id: ${EVIDENCE}`,
  '    role: supports',
  '---',
  '# STAT3 sustains resistant-cell proliferation',
  '',
  'The interpretation remains provisional.',
].join('\n') + '\n'

const EVIDENCE_FILE = [
  '---',
  `id: ${EVIDENCE}`,
  'publication_ref:',
  '  pmid: "12345678"',
  'locator:',
  '  kind: pubmed_abstract',
  'assertion: "STAT3 phosphorylation increases after treatment."',
  'direction: supports',
  'review_status: reviewed',
  '---',
  'Reviewed note.',
].join('\n') + '\n'

const RESULT_FILE = [
  '---',
  `id: ${RESULT}`,
  'status: validated',
  'observed_at: "2026-08-20"',
  '---',
  'Viability increased by 28 percent.',
].join('\n') + '\n'

const EDGE_FILE = JSON.stringify({
  id: EDGE,
  from: RESULT,
  to: NODE,
  relation: 'supports',
  basis: 'ai_inference',
  provenance: 'Simulation proposal pending experimental review.',
  evidence_gap: 'Independent replication is still missing.',
})

function entries(manifest = MANIFEST): Record<string, string> {
  return {
    '/project/research.json': manifest,
    [`/project/nodes/${NODE}.md`]: NODE_FILE,
    [`/project/evidence/${EVIDENCE}.md`]: EVIDENCE_FILE,
    [`/project/results/${RESULT}.md`]: RESULT_FILE,
    [`/project/edges/${EDGE}.json`]: EDGE_FILE,
  }
}

function healthyGit() {
  return scriptedGit((argv, cwd) => {
    if (argv[1] === 'symbolic-ref') return { stdout: 'feat/m2-companion\n' }
    if (argv[1] === 'rev-parse') {
      if (argv.includes('--show-toplevel')) return { stdout: `${cwd}\n` }
      return { stdout: 'abcdef1234567890abcdef1234567890abcdef12\n' }
    }
    return { stdout: '' }
  }).port
}

class FakeSessions implements SessionsPort {
  readonly records = new Map<string, SessionPort>()

  get(id: string): SessionPort | undefined {
    return this.records.get(id)
  }
}

async function setup(files = entries()) {
  const fs = new FakeFs(files)
  const storagePort = new FakeStorageDomainPort()
  const storage = await storagePort.open(uiStateDomainSpec())
  const sessions = new FakeSessions()
  sessions.records.set('session-1', {
    id: 'session-1',
    header: { cwd: '/project' },
  })
  let byte = 1
  const pageKeys = new PageKeyStore((size) => Buffer.alloc(size, byte++))
  const deps: CompanionServiceDeps = {
    fs,
    subprocess: healthyGit(),
    hash: sha256,
    storage,
    sessions,
    pageKeys,
  }
  return { service: new CompanionService(deps), fs, storagePort, sessions, pageKeys }
}

describe('CompanionService launch and binding', () => {
  it('derives the project only from the live Session cwd and returns a fragment URL', async () => {
    const { service, pageKeys } = await setup()

    const result = await service.launch('session-1')

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('launch failed')
    expect(result.url).toMatch(/^\/scifork\/#key=[A-Za-z0-9_-]{43}$/)
    expect(result.url).not.toContain('?')
    const key = new URL(result.url, 'http://127.0.0.1').hash.slice('#key='.length)
    expect(pageKeys.resolve(key)).toEqual({
      sessionId: 'session-1',
      sessionCwd: '/project',
      projectRoot: '/project',
      projectId: PROJECT_ID,
    })
    expect(JSON.stringify(result)).not.toContain('/project')
  })

  it('rejects an unknown Session or a Session without cwd', async () => {
    const { service, sessions } = await setup()
    sessions.records.set('no-cwd', { id: 'no-cwd', header: {} })

    await expect(service.launch('missing')).resolves.toMatchObject({
      ok: false,
      code: 'SESSION_UNAVAILABLE',
    })
    await expect(service.launch('no-cwd')).resolves.toMatchObject({
      ok: false,
      code: 'SESSION_UNAVAILABLE',
    })
  })

  it('revokes the key when the Session is gone or the manifest project id is replaced', async () => {
    const { service, sessions, fs, pageKeys } = await setup()
    const launched = await service.launch('session-1')
    if (!launched.ok) throw new Error('launch failed')
    const key = launched.url.split('#key=')[1]!

    sessions.records.delete('session-1')
    await expect(service.snapshot(key)).resolves.toMatchObject({
      ok: false,
      code: 'PAGE_KEY_INVALID',
    })
    expect(pageKeys.resolve(key)).toBeUndefined()

    sessions.records.set('session-1', { id: 'session-1', header: { cwd: '/project' } })
    const relaunched = await service.launch('session-1')
    if (!relaunched.ok) throw new Error('relaunch failed')
    const nextKey = relaunched.url.split('#key=')[1]!
    fs.writeExternal(
      '/project/research.json',
      JSON.stringify({ schema_version: 1, project_id: OTHER_PROJECT_ID, name: 'Replacement' }),
    )
    await expect(service.snapshot(nextKey)).resolves.toMatchObject({
      ok: false,
      code: 'PAGE_KEY_INVALID',
    })
    expect(pageKeys.resolve(nextKey)).toBeUndefined()
  })
})

describe('CompanionService reads', () => {
  let setupState: Awaited<ReturnType<typeof setup>>
  let key: string

  beforeEach(async () => {
    setupState = await setup()
    const launched = await setupState.service.launch('session-1')
    if (!launched.ok) throw new Error('launch failed')
    key = launched.url.split('#key=')[1]!
  })

  it('returns a body-free projection with bounded labels and edge Evidence Gap', async () => {
    const result = await setupState.service.snapshot(key)

    expect(result).toMatchObject({
      ok: true,
      unchanged: false,
      project: {
        id: PROJECT_ID,
        name: 'STAT3 resistance study',
        readOnly: false,
        branch: 'feat/m2-companion',
      },
    })
    if (!result.ok || result.graph === undefined) throw new Error('snapshot failed')
    expect(result.graph.entities).toHaveLength(3)
    expect(result.graph.entities.find((entity) => entity.id === NODE)).toMatchObject({
      id: NODE,
      type: 'node',
      kind: 'hypothesis',
      label: 'STAT3 sustains resistant-cell proliferation',
    })
    expect(result.graph.edges.find((edge) => edge.id === EDGE)).toMatchObject({
      relation: 'supports',
      evidenceGap: 'Independent replication is still missing.',
    })
    expect(JSON.stringify(result.graph)).not.toContain('The interpretation remains provisional')
    for (const entity of result.graph.entities) {
      expect(entity.label.length).toBeLessThanOrEqual(240)
      expect(entity).not.toHaveProperty('body')
    }
  })

  it('omits an unchanged graph but still returns a Focus-only change', async () => {
    const first = await setupState.service.snapshot(key)
    if (!first.ok) throw new Error('snapshot failed')

    await expect(setupState.service.setFocus(key, NODE)).resolves.toMatchObject({
      ok: true,
      focus: { focusEntityId: NODE, pathIds: [] },
    })
    const unchanged = await setupState.service.snapshot(key, first.project.revision)

    expect(unchanged).toMatchObject({
      ok: true,
      unchanged: true,
      focus: { focusEntityId: NODE, pathIds: [] },
    })
    if (!unchanged.ok) throw new Error('unchanged snapshot failed')
    expect(unchanged.graph).toBeUndefined()
  })

  it('returns Markdown only for the requested managed entity and structured edge details', async () => {
    const node = await setupState.service.entity(key, NODE)
    expect(node).toMatchObject({
      ok: true,
      entity: { id: NODE, type: 'node', body: expect.stringContaining('provisional') },
    })

    const edge = await setupState.service.entity(key, EDGE)
    expect(edge).toMatchObject({
      ok: true,
      entity: {
        id: EDGE,
        type: 'edge',
        from: RESULT,
        to: NODE,
        evidenceGap: 'Independent replication is still missing.',
      },
    })
    if (!edge.ok) throw new Error('edge read failed')
    expect(edge.entity).not.toHaveProperty('body')
    await expect(setupState.service.entity(key, 'node_missing')).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_ENTITY',
    })
  })

  it('derives and truncates the Focus path without writing research files', async () => {
    const before = setupState.fs.entries()
    await setupState.service.setFocus(key, NODE)
    await expect(setupState.service.setFocus(key, RESULT)).resolves.toMatchObject({
      ok: true,
      focus: { focusEntityId: RESULT, pathIds: [NODE] },
    })
    await expect(setupState.service.setFocus(key, NODE)).resolves.toMatchObject({
      ok: true,
      focus: { focusEntityId: NODE, pathIds: [] },
    })
    expect(setupState.fs.entries()).toEqual(before)
  })

  it('marks schema diagnostics read-only without exposing an absolute path', async () => {
    setupState.fs.writeExternal('/project/research.json', '{"schema_version":1,"name":9}')
    const result = await setupState.service.snapshot(key)
    expect(result).toMatchObject({ ok: true, project: { readOnly: true } })
    expect(JSON.stringify(result)).not.toContain('/project')
  })
})

describe('fixture revision sanity', () => {
  it('uses the same public project revision formula as Core', () => {
    const files = new Map(
      Object.entries(entries()).map(([path, content]) => [path.slice('/project/'.length), content]),
    )
    expect(projectRevision(files, sha256)).toMatch(/^[a-f0-9]{64}$/)
  })
})
