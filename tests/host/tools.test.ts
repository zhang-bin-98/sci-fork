import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { registerResearchTools } from '../../src/host/tools.js'
import type { ResearchToolsDeps } from '../../src/host/tools.js'
import { FakeFs, FakeStorageDomainPort, FakeToolsPort, scriptedGit } from './fakes.js'
import { TABLE_FOCUS, UI_STATE_DOMAIN, uiStateDomainSpec } from '../../src/host/ui-state.js'
import type { ToolRunContext } from '../../src/host/contracts.js'
import { projectRevision } from '../../src/core/revision.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const UUID_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const UUID_C = 'cccccccc-3333-4333-8333-333333333333'
const UUID_D = 'dddddddd-4444-4444-8444-444444444444'
const UUID_E = 'eeeeeeee-5555-4555-8555-555555555555'
const UUID_F = 'ffffffff-6666-4666-8666-666666666666'
const NODE = `node_${UUID_B}`
const OTHER_NODE = `node_${UUID_C}`
const EV = `ev_${UUID_B}`
const RES = `res_${UUID_B}`
const OTHER_RES = `res_${UUID_D}`
const UNRELATED_NODE = `node_${UUID_F}`
const EDGE = `edge_${UUID_B}`
const QUESTION = `question_${UUID_E}`
const FRAMING_LINK = `qlink_${UUID_F}`
const INCOMING_EDGE = `edge_${UUID_C}`
const OUTGOING_EDGE = `edge_${UUID_D}`
const CONVERGING_EDGE = `edge_${UUID_E}`
const OLD_SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const NEW_SHA = 'fedcba0987654321fedcba0987654321fedcba09'

const MANIFEST = JSON.stringify({ schema_version: 1, project_id: PROJECT_ID, name: 'Tools' })

function revisionOf(entries: ReadonlyMap<string, string>): string {
  return projectRevision(
    new Map(
      [...entries]
        .filter(([path]) => path.startsWith('/proj/'))
        .map(([path, content]) => [path.slice('/proj/'.length), content]),
    ),
    sha256,
  )
}

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

const EDGE_FILE = JSON.stringify({
  id: EDGE,
  from: NODE,
  to: `res_${UUID_B.replaceAll('b', 'c')}`,
  relation: 'associated_with',
  basis: 'experiment',
})

const OTHER_NODE_FILE = [
  '---',
  `id: ${OTHER_NODE}`,
  'kind: hypothesis',
  'confidence: moderate',
  'evidence_refs: []',
  '---',
  '# Upstream STAT3 hypothesis\n\nA long body that must not be in a neighbor card.\n',
].join('\n') + '\n'

const OTHER_RESULT_FILE = [
  '---',
  `id: ${OTHER_RES}`,
  'status: validated',
  'observed_at: "2026-08-30"',
  '---',
  '# Downstream assay result\n\nAnother body that must not be in a neighbor card.\n',
].join('\n') + '\n'

const UNRELATED_NODE_FILE = [
  '---',
  `id: ${UNRELATED_NODE}`,
  'kind: hypothesis',
  'confidence: low',
  'evidence_refs: []',
  '---',
  '# Unrelated control hypothesis\n',
].join('\n') + '\n'

const INCOMING_EDGE_FILE = JSON.stringify({
  id: INCOMING_EDGE,
  from: OTHER_NODE,
  to: NODE,
  relation: 'supports',
  basis: 'literature',
  evidence_refs: [{ id: EV, role: 'supports' }],
})

const OUTGOING_EDGE_FILE = JSON.stringify({
  id: OUTGOING_EDGE,
  from: NODE,
  to: OTHER_RES,
  relation: 'associated_with',
  basis: 'experiment',
})

const CONVERGING_EDGE_FILE = JSON.stringify({
  id: CONVERGING_EDGE,
  from: OTHER_NODE,
  to: OTHER_RES,
  relation: 'associated_with',
  basis: 'experiment',
})

const QUESTION_FILE = [
  '---',
  `id: ${QUESTION}`,
  'question: What drives treatment resistance?',
  'scope_assumptions:',
  '  - solid tumors',
  '---',
  'Open question.',
].join('\n') + '\n'

const FRAMING_LINK_FILE = JSON.stringify({
  id: FRAMING_LINK,
  from: QUESTION,
  to: NODE,
  relation: 'frames',
})

function healthyGit(statusOutput = '') {
  const { port } = scriptedGit((argv, cwd) => {
    const sub = argv[1]
    if (sub === 'symbolic-ref') return { stdout: 'main\n' }
    if (sub === 'rev-parse') {
      if (argv.includes('--show-toplevel')) return { stdout: `${cwd}\n` }
      return { stdout: `${OLD_SHA}\n` }
    }
    if (sub === 'ls-files') return { stdout: '' }
    if (sub === 'status') return { stdout: statusOutput }
    return { stdout: '' }
  })
  return { port }
}

async function host(
  fs: FakeFs,
  storage: FakeStorageDomainPort,
  subprocess = healthyGit().port,
): Promise<Omit<ResearchToolsDeps, 'tools'>> {
  return {
    fs,
    subprocess,
    storage: await storage.open(uiStateDomainSpec()),
    hash: sha256,
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access', workspaceRoot: '/' }) },
  }
}

function execFor(cwd = '/proj'): ToolRunContext {
  return {
    agent: { id: 'session-1', session: { id: 'session-1', header: { cwd } } },
    signal: new AbortController().signal,
  }
}

async function registered(
  entries: Record<string, string> = { '/proj/research.json': MANIFEST },
  subprocess = healthyGit().port,
) {
  const fs = new FakeFs(entries)
  const storage = new FakeStorageDomainPort()
  const tools = new FakeToolsPort()
  const deps = await host(fs, storage, subprocess)
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
    const readProperties = (read.parameters as {
      properties: { operation: { enum: string[] }; direction: { enum: string[] } }
    }).properties
    expect(readProperties.operation.enum).toContain('neighbors')
    expect(readProperties.direction.enum).toEqual(['incoming', 'outgoing', 'both'])
    expect(read.output.schema).toEqual({})
    expect(read.timeoutMs).toBe(15000)
    expect(read.isConcurrencySafe?.({})).toBe(false)
    const apply = tools.definitions.find((d) => d.name === 'research_graph_apply')!
    expect(apply.timeoutMs).toBe(30000)
    expect(apply.output.schema).toEqual({})
    expect(apply.parameters).toMatchObject({ required: ['command', 'expectedProjectRevision'] })
    const command = (apply.parameters as { properties: { command: Record<string, unknown> } }).properties.command
    expect(command).toMatchObject({ type: 'object', oneOf: expect.any(Array) })
    expect((command.oneOf as Array<{ properties: { kind: { const: string } } }>).map((branch) => branch.properties.kind.const))
      .toEqual(expect.arrayContaining([
        'create_question',
        'update_question',
        'create_framing_link',
        'delete_framing_link',
        'create_node',
        'update_edge',
        'import_draft_item',
        'delete_edge',
        'delete_node',
      ]))
    const edgeBranches = command.oneOf as Array<{ properties: Record<string, { enum?: string[]; const?: string }> }>
    for (const branch of edgeBranches.filter(({ properties }) => {
      const kind = properties['kind']?.const
      return kind === 'create_edge' || kind === 'update_edge'
    })) {
      expect(branch.properties['relation']?.enum).toContain('predicts')
      expect(branch.properties).toHaveProperty('publicationRefs')
    }
    const nodeBranches = command.oneOf as Array<{
      properties: { kind?: { const?: string }; body?: { description?: string } }
    }>
    for (const branch of nodeBranches.filter(({ properties }) => {
      const kind = properties.kind?.const
      return kind === 'create_node' || kind === 'update_node'
    })) {
      expect(branch.properties.body?.description).toContain('first non-empty paragraph')
      expect(branch.properties.body?.description).toContain('bold summary sentence')
    }
    const focus = tools.definitions.find((d) => d.name === 'research_graph_focus')!
    expect(focus.output.schema).toEqual({})
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

  it('reports an invalid manifest as a read-only project diagnostic', async () => {
    const { byName } = await registered({ '/proj/research.json': '{ not json' })
    const read = byName.get('research_graph_read')!
    const value = await read.execute({ operation: 'summary' }, execFor())

    expect(value).toMatchObject({
      ok: true,
      readOnly: true,
      diagnosticCount: 1,
    })
    expect(value).not.toHaveProperty('projectId')
    expect(value).not.toHaveProperty('name')
    expect(value).not.toHaveProperty('schemaVersion')
    expect(value).toEqual(JSON.parse(JSON.stringify(value)))
  })

  it('reports Git read-only state when a managed path is dirty', async () => {
    const dirtyGit = healthyGit(' M research.json\n')
    const { byName } = await registered({ '/proj/research.json': MANIFEST }, dirtyGit.port)
    const read = byName.get('research_graph_read')!
    const value = await read.execute({ operation: 'summary' }, execFor())
    expect(value).toMatchObject({
      ok: true,
      readOnly: true,
      gitError: { code: 'READ_ONLY_CONFLICT', message: 'managed paths have uncommitted changes' },
    })
    expect(value).not.toHaveProperty('branch')
    expect(value).not.toHaveProperty('head')
    expect(value).toEqual(JSON.parse(JSON.stringify(value)))

    const checkpoint = await read.execute({ operation: 'checkpoint' }, execFor())
    expect(checkpoint).not.toHaveProperty('branch')
    expect(checkpoint).not.toHaveProperty('head')
    expect(checkpoint).toEqual(JSON.parse(JSON.stringify(checkpoint)))
  })

  it('returns entities and neighborhoods', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
      [`/proj/evidence/${EV}.md`]: EV_FILE,
    })
    const read = byName.get('research_graph_read')!
    const entity = await read.execute({ operation: 'entity', entityId: NODE }, execFor())
    expect(entity).toMatchObject({
      ok: true,
      entity: { type: 'node', kind: 'hypothesis' },
      fileVersion: sha256(NODE_FILE),
    })
    const missing = await read.execute({ operation: 'entity', entityId: `node_${UUID_B.replace('b', 'c')}` }, execFor())
    expect(missing).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
    const neighborhood = await read.execute({ operation: 'neighborhood', entityId: NODE }, execFor())
    expect(neighborhood).toMatchObject({ ok: true })
    const edges = (neighborhood as { edges: unknown[] }).edges
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: EV, to: NODE, source: 'evidence_ref' })
  })

  it('reads open Questions and keeps framing out of scientific Node neighborhoods', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/questions/${QUESTION}.md`]: QUESTION_FILE,
      [`/proj/question-links/${FRAMING_LINK}.json`]: FRAMING_LINK_FILE,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
      [`/proj/evidence/${EV}.md`]: EV_FILE,
    })
    const read = byName.get('research_graph_read')!

    await expect(read.execute({ operation: 'entity', entityId: QUESTION }, execFor())).resolves.toMatchObject({
      ok: true,
      entity: {
        type: 'question',
        question: 'What drives treatment resistance?',
        framedEntities: [{ linkId: FRAMING_LINK, entityId: NODE }],
      },
      fileVersion: sha256(QUESTION_FILE),
    })
    const questionNeighbors = await read.execute(
      { operation: 'neighbors', entityId: QUESTION, direction: 'outgoing' },
      execFor(),
    )
    expect(questionNeighbors).toMatchObject({
      ok: true,
      neighbors: [{
        direction: 'outgoing',
        edge: { id: FRAMING_LINK, relation: 'frames', source: 'framing_link' },
        entity: { id: NODE, type: 'node' },
      }],
    })

    const nodeNeighbors = await read.execute(
      { operation: 'neighbors', entityId: NODE, direction: 'both' },
      execFor(),
    )
    expect(JSON.stringify(nodeNeighbors)).not.toContain(FRAMING_LINK)
    await expect(read.execute({ operation: 'entity', entityId: FRAMING_LINK }, execFor())).resolves.toMatchObject({
      ok: true,
      entity: { type: 'framing_link', from: QUESTION, to: NODE, relation: 'frames' },
    })
  })

  it('returns compact incoming, outgoing, or bidirectional neighbors without entity bodies', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
      [`/proj/nodes/${OTHER_NODE}.md`]: OTHER_NODE_FILE,
      [`/proj/nodes/${UNRELATED_NODE}.md`]: UNRELATED_NODE_FILE,
      [`/proj/evidence/${EV}.md`]: EV_FILE,
      [`/proj/results/${OTHER_RES}.md`]: OTHER_RESULT_FILE,
      [`/proj/edges/${INCOMING_EDGE}.json`]: INCOMING_EDGE_FILE,
      [`/proj/edges/${OUTGOING_EDGE}.json`]: OUTGOING_EDGE_FILE,
      [`/proj/edges/${CONVERGING_EDGE}.json`]: CONVERGING_EDGE_FILE,
    })
    const read = byName.get('research_graph_read')!

    const incoming = await read.execute(
      { operation: 'neighbors', entityId: NODE, direction: 'incoming' },
      execFor(),
    )
    expect(incoming).toMatchObject({ ok: true, entityId: NODE, direction: 'incoming' })
    expect((incoming as { neighbors: unknown[] }).neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'incoming',
          edge: expect.objectContaining({ from: EV, to: NODE, source: 'evidence_ref' }),
          entity: expect.objectContaining({ id: EV, type: 'evidence' }),
        }),
        expect.objectContaining({
          direction: 'incoming',
          edge: expect.objectContaining({ from: OTHER_NODE, to: NODE }),
          entity: expect.objectContaining({ id: OTHER_NODE, type: 'node' }),
        }),
      ]),
    )
    expect((incoming as { neighbors: unknown[] }).neighbors).toHaveLength(2)

    const outgoing = await read.execute(
      { operation: 'neighbors', entityId: NODE, direction: 'outgoing' },
      execFor(),
    )
    expect(outgoing).toMatchObject({
      ok: true,
      entityId: NODE,
      direction: 'outgoing',
      neighbors: [
        {
          direction: 'outgoing',
          edge: expect.objectContaining({ from: NODE, to: OTHER_RES }),
          entity: expect.objectContaining({ id: OTHER_RES, type: 'result' }),
        },
      ],
    })

    const both = await read.execute(
      { operation: 'neighbors', entityId: NODE },
      execFor(),
    )
    expect(both).toMatchObject({ ok: true, entityId: NODE, direction: 'both' })
    expect((both as { neighbors: unknown[] }).neighbors).toHaveLength(3)
    expect(JSON.stringify(both)).not.toContain(UNRELATED_NODE)
    expect(JSON.stringify(both)).not.toContain('A long body')
    expect(JSON.stringify(both)).not.toContain('Another body')

    const convergence = await read.execute(
      { operation: 'neighbors', entityId: OTHER_RES, direction: 'incoming' },
      execFor(),
    )
    expect(convergence).toMatchObject({ ok: true, entityId: OTHER_RES, direction: 'incoming' })
    expect((convergence as { neighbors: unknown[] }).neighbors).toHaveLength(2)

    const edge = await read.execute(
      { operation: 'neighbors', entityId: INCOMING_EDGE, direction: 'both' },
      execFor(),
    )
    expect(edge).toMatchObject({ ok: false, code: 'INVALID_ENTITY' })
    const invalidDirection = await read.execute(
      { operation: 'neighbors', entityId: NODE, direction: 'sideways' },
      execFor(),
    )
    expect(invalidDirection).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
  })

  it('reads and focuses stored edges', async () => {
    const { byName, storage } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
      [`/proj/results/${RES}.md`]: `---\nid: ${RES}\nstatus: draft\nobserved_at: 2026-08-24\n---\nresult\n`,
      [`/proj/edges/${EDGE}.json`]: EDGE_FILE,
    })
    const read = byName.get('research_graph_read')!
    const entity = await read.execute({ operation: 'entity', entityId: EDGE }, execFor())
    expect(entity).toMatchObject({ ok: true, entity: { type: 'edge', relation: 'associated_with', basis: 'experiment' } })
    const focus = byName.get('research_graph_focus')!
    const focused = await focus.execute({ focusEntityId: EDGE, pathIds: [EDGE] }, execFor())
    expect(focused).toMatchObject({ ok: true, focus: { focusEntityId: EDGE, pathIds: [EDGE] } })
    expect(storage.tableOf(UI_STATE_DOMAIN, TABLE_FOCUS)!.records.size).toBe(1)
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

  it('reports only the current Git checkpoint state', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
      [`/proj/evidence/${EV}.md`]: EV_FILE,
    })
    const read = byName.get('research_graph_read')!
    const value = await read.execute({ operation: 'checkpoint' }, execFor())
    expect(value).toMatchObject({
      ok: true,
      branch: 'main',
      head: OLD_SHA,
    })
    expect(value).not.toHaveProperty('lastCheckpointId')
    expect(value).not.toHaveProperty('backAvailable')
    expect(value).not.toHaveProperty('forwardAvailable')
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
    const revision = revisionOf(fs.entries())
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
    const revision = revisionOf(fs.entries())
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
    expect(cleared).toEqual({ ok: true })
    expect(Object.keys(cleared as Record<string, unknown>)).toEqual(['ok'])
    expect(cleared).toEqual(JSON.parse(JSON.stringify(cleared)))
    expect(table.records.size).toBe(0)

    const read = byName.get('research_graph_read')!
    const clearedRead = await read.execute({ operation: 'focus' }, execFor())
    expect(clearedRead).toEqual({ ok: true })
    expect(Object.keys(clearedRead as Record<string, unknown>)).toEqual(['ok'])
    expect(clearedRead).toEqual(JSON.parse(JSON.stringify(clearedRead)))
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

  it('rejects malformed focus arrays instead of silently filtering them', async () => {
    const { byName } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: NODE_FILE,
    })
    const focus = byName.get('research_graph_focus')!
    await expect(focus.execute({ focusEntityId: NODE, pathIds: [NODE, 42] }, execFor())).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_ENTITY',
    })
    await expect(focus.execute({ focusEntityId: 42 }, execFor())).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_ENTITY',
    })
  })
})
