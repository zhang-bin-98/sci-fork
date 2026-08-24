import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { registerResearchTools } from '../../src/host/tools.js'
import type { ResearchHostDeps } from '../../src/host/apply-command.js'
import { FakeFs, FakeStorageDomainPort, FakeToolsPort, scriptedGit } from './fakes.js'
import { TABLE_FOCUS, TABLE_UNDO, UI_STATE_DOMAIN, uiStateDomainSpec } from '../../src/host/ui-state.js'
import type { ToolRunContext } from '../../src/host/contracts.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const UUID_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const NODE = `node_${UUID_B}`
const EV = `ev_${UUID_B}`
const RES = `res_${UUID_B}`
const OLD_SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const NEW_SHA = 'fedcba0987654321fedcba0987654321fedcba09'

const MANIFEST = JSON.stringify({ schema_version: 1, project_id: PROJECT_ID, name: 'Tools' })

const NODE_FILE = [
  '---',
  `id: ${NODE}`,
  'kind: hypothesis',
  'confidence: moderate',
  'evidence_refs:',
  `  - id: ${EV}`,
  '    role: supports',
  '---',
  '# STAT3 hypothesis\n\nSTAT3 mediates proliferation.\n',
].join('\n') + '\n'

const EV_FILE = [
  '---',
  `id: ${EV}`,
  'publication_ref:',
  '  pmid: "12345678"',
  'locator:',
  '  kind: pubmed_abstract',
  'assertion: "STAT3 is phosphorylated."',
  'direction: supports',
  'review_status: reviewed',
  '---',
  'note',
].join('\n') + '\n'

function healthyGit() {
  const { port } = scriptedGit((argv, cwd) => {
    const sub = argv[1]
    if (sub === 'symbolic-ref') return { stdout: 'main\n' }
    if (sub === 'rev-parse') {
      if (argv.includes('--show-toplevel')) return { stdout: `${cwd}\n` }
      return { stdout: `${OLD_SHA}\n` }
    }
    if (sub === 'ls-files') return { stdout: '' }
    if (sub === 'status') return { stdout: '' }
    return { stdout: '' }
  })
  return { port }
}

async function host(fs: FakeFs, storage: FakeStorageDomainPort): Promise<ResearchHostDeps> {
  return {
    fs,
    subprocess: healthyGit().port,
    storage: await storage.open(uiStateDomainSpec()),
    hash: sha256,
  }
}

function execFor(cwd = '/proj'): ToolRunContext {
  return {
    agent: { id: 'session-1', session: { header: { cwd } } },
    signal: new AbortController().signal,
  }
}

async function registered(entries: Record<string, string> = { '/proj/research.json': MANIFEST }) {
  const fs = new FakeFs(entries)
  const storage = new FakeStorageDomainPort()
  const tools = new FakeToolsPort()
  const deps = await host(fs, storage)
  const dispose = registerResearchTools({ ...deps, tools })
  const byName = new Map(tools.definitions.map((definition) => [definition.name, definition]))
  return { fs, storage, tools, dispose, byName, deps }
}

describe('registerResearchTools', () => {
  it('declares the three tools with schemas and timeouts', async () => {
    const { tools, dispose } = await registered()
    expect(tools.definitions.map((d) => d.name).sort()).toEqual([
      'research_graph_apply',
      'research_graph_focus',
      'research_graph_read',
    ])
    const read = tools.definitions.find((d) => d.name === 'research_graph_read')!
    expect(read.parameters).toMatchObject({ type: 'object', required: ['operation'] })
    expect(read.timeoutMs).toBe(15000)
    expect(read.isConcurrencySafe?.({})).toBe(false)
    const apply = tools.definitions.find((d) => d.name === 'research_graph_apply')!
    expect(apply.timeoutMs).toBe(30000)
    expect(apply.parameters).toMatchObject({ required: ['command', 'expectedProjectRevision'] })
    dispose()
    expect(tools.disposals).toHaveLength(3)
  })

  it('renders outputs as JSON text blocks', async () => {
    const { byName } = await registered()
    const read = byName.get('research_graph_read')!
    const blocks = read.output.render({}, { ok: true, x: 1 })
    expect(blocks).toEqual([{ type: 'text', text: JSON.stringify({ ok: true, x: 1 }) }])
  })
})

describe('research_graph_read', () => {
  it('summarizes a valid project', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
      [`/proj/evidence/${EV}.md`]: EV_FILE,
    })
    const read = byName.get('research_graph_read')!
    const value = await read.execute({ operation: 'summary' }, execFor())
    expect(value).toMatchObject({
      ok: true,
      projectId: PROJECT_ID,
      counts: { nodes: 1, edges: 0, evidenceAssertions: 1, results: 0 },
      readOnly: false,
    })
    expect((value as { revision: string }).revision).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports read-only mode for invalid projects', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      '/proj/nodes/readme.md': '# stray',
    })
    const read = byName.get('research_graph_read')!
    const value = await read.execute({ operation: 'summary' }, execFor())
    expect(value).toMatchObject({ ok: true, readOnly: true })
    expect((value as { diagnosticCount: number }).diagnosticCount).toBeGreaterThan(0)
  })

  it('returns entities and neighborhoods', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
      [`/proj/evidence/${EV}.md`]: EV_FILE,
    })
    const read = byName.get('research_graph_read')!
    const entity = await read.execute({ operation: 'entity', entityId: NODE }, execFor())
    expect(entity).toMatchObject({ ok: true, entity: { type: 'node', kind: 'hypothesis' } })
    const missing = await read.execute({ operation: 'entity', entityId: `node_${UUID_B.replace('b', 'c')}` }, execFor())
    expect(missing).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
    const neighborhood = await read.execute({ operation: 'neighborhood', entityId: NODE }, execFor())
    expect(neighborhood).toMatchObject({ ok: true })
    const edges = (neighborhood as { edges: unknown[] }).edges
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: EV, to: NODE, source: 'evidence_ref' })
  })

  it('finds entities by case-insensitive substring', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
    })
    const read = byName.get('research_graph_read')!
    const value = await read.execute({ operation: 'find', query: 'proliferation', limit: 5 }, execFor())
    expect(value).toMatchObject({ ok: true, matches: [{ id: NODE, type: 'node' }] })
    const none = await read.execute({ operation: 'find', query: 'zzz', limit: 5 }, execFor())
    expect(none).toMatchObject({ ok: true, matches: [] })
  })

  it('reports checkpoint state from the undo record', async () => {
    const { byName, storage } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
      [`/proj/evidence/${EV}.md`]: EV_FILE,
    })
    storage.tableOf(UI_STATE_DOMAIN, TABLE_UNDO)!.records.set(`${PROJECT_ID}:main`, {
      branch: 'main',
      recordedHead: OLD_SHA,
      lastCheckpointId: NEW_SHA,
      previousCheckpointId: OLD_SHA,
    })
    const read = byName.get('research_graph_read')!
    const value = await read.execute({ operation: 'checkpoint' }, execFor())
    expect(value).toMatchObject({
      ok: true,
      branch: 'main',
      head: OLD_SHA,
      lastCheckpointId: NEW_SHA,
      backAvailable: true,
      forwardAvailable: false,
    })
  })

  it('returns SESSION_UNAVAILABLE without a session cwd', async () => {
    const { byName } = await registered()
    const read = byName.get('research_graph_read')!
    const noAgent: ToolRunContext = { signal: new AbortController().signal }
    const value = await read.execute({ operation: 'summary' }, noAgent)
    expect(value).toMatchObject({ ok: false, code: 'SESSION_UNAVAILABLE' })
  })
})

describe('research_graph_apply', () => {
  it('applies a valid command', async () => {
    const { byName, fs } = await registered()
    const files = [...fs.entries()].filter(([path]) => path.startsWith('/proj/'))
    const revision = sha256(
      files.map(([path, content]) => `${path.slice('/proj/'.length)}\n${sha256(content)}\n`).join(''),
    )
    const apply = byName.get('research_graph_apply')!
    const value = await apply.execute({
      command: {
        kind: 'create_result',
        id: RES,
        observedAt: '2026-08-24',
        body: '# R\n\nBody.\n',
      },
      expectedProjectRevision: revision,
    }, execFor())
    expect(value).toMatchObject({ ok: true, entityId: RES, kind: 'create_result' })
    expect(fs.contentOf(`/proj/results/${RES}.md`)).toContain('status: draft')
  })

  it('rejects invalid commands and malformed command objects', async () => {
    const { byName, fs } = await registered()
    const files = [...fs.entries()].filter(([path]) => path.startsWith('/proj/'))
    const revision = sha256(
      files.map(([path, content]) => `${path.slice('/proj/'.length)}\n${sha256(content)}\n`).join(''),
    )
    const apply = byName.get('research_graph_apply')!
    const invalid = await apply.execute({
      command: { kind: 'create_node', id: NODE, nodeKind: 'finding', confidence: 'low', body: 'x' },
      expectedProjectRevision: revision,
    }, execFor())
    expect(invalid).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
    const malformed = await apply.execute({ command: { kind: 'destroy' }, expectedProjectRevision: 'x' }, execFor())
    expect(malformed).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })
})

describe('research_graph_focus', () => {
  it('writes and clears the focus sidecar without touching files', async () => {
    const { byName, storage, fs } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
    })
    const focus = byName.get('research_graph_focus')!
    const set = await focus.execute({ focusEntityId: NODE, pathIds: [] }, execFor())
    expect(set).toMatchObject({ ok: true, focus: { focusEntityId: NODE, pathIds: [] } })
    const table = storage.tableOf(UI_STATE_DOMAIN, TABLE_FOCUS)!
    expect(table.records.get(`session-1:${PROJECT_ID}`)).toEqual({ focusEntityId: NODE, pathIds: [] })
    const entries = fs.entries()
    expect([...entries.keys()].every((path) => path.endsWith('research.json') || path.includes(`/${NODE}.md`))).toBe(true)

    const cleared = await focus.execute({ focusEntityId: '' }, execFor())
    expect(cleared).toMatchObject({ ok: true, focus: undefined })
    expect(table.records.size).toBe(0)
  })

  it('rejects unknown focus entities', async () => {
    const { byName } = await registered()
    const focus = byName.get('research_graph_focus')!
    const value = await focus.execute({ focusEntityId: `node_${UUID_B.replace('b', 'd')}` }, execFor())
    expect(value).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })

  it('validates path entries', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
    })
    const focus = byName.get('research_graph_focus')!
    const value = await focus.execute({ focusEntityId: NODE, pathIds: [NODE] }, execFor())
    expect(value).toMatchObject({ ok: true })
    const unknownPath = await focus.execute({ focusEntityId: NODE, pathIds: ['node_x'] }, execFor())
    expect(unknownPath).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
  })
})
