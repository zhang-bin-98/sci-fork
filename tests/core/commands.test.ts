import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { parseCommand, planCommand } from '../../src/core/commands.js'
import type { PlanResult, ResearchCommand } from '../../src/core/commands.js'
import { parseAndValidateProject } from '../../src/core/validator.js'
import { fileVersion } from '../../src/core/revision.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

function writeContent(plan: PlanResult): string {
  if (!plan.ok || plan.writeKind === 'delete') {
    throw new Error('expected a write plan')
  }
  return plan.content
}

const UUID_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const UUID_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const UUID_C = 'cccccccc-3333-4333-8333-333333333333'
const NODE = `node_${UUID_A}`
const NODE_B = `node_${UUID_B}`
const EV = `ev_${UUID_A}`
const RES = `res_${UUID_A}`
const EDGE = `edge_${UUID_A}`

const MANIFEST = JSON.stringify({ schema_version: 1, project_id: UUID_A, name: 'Commands' })

function evidenceFile(id: string, reviewStatus: string, direction: string): [string, string] {
  return [
    `evidence/${id}.md`,
    [
      '---',
      `id: ${id}`,
      'publication_ref:',
      '  pmid: "12345678"',
      'locator:',
      '  kind: pubmed_abstract',
      `assertion: "Assertion for ${id}."`,
      `direction: ${direction}`,
      `review_status: ${reviewStatus}`,
      '---',
      'note',
    ].join('\n') + '\n',
  ]
}

function nodeFile(id: string, kind: string, refs = ''): [string, string] {
  return [
    `nodes/${id}.md`,
    [
      '---',
      `id: ${id}`,
      `kind: ${kind}`,
      'confidence: moderate',
      refs,
      '---',
      '# Node\n\nBody.\n',
    ].filter((l) => l !== '').join('\n') + '\n',
  ]
}

function resultFile(id: string, status: string): [string, string] {
  return [
    `results/${id}.md`,
    `---\nid: ${id}\nstatus: ${status}\nobserved_at: "2026-08-24"\n---\n# R\n\nBody.\n`,
  ]
}

function edgeFile(id: string, from: string, to: string): [string, string] {
  return [`edges/${id}.json`, JSON.stringify({ id, from, to, relation: 'supports', basis: 'experiment' })]
}

function build(files: [string, string][]) {
  return parseAndValidateProject(new Map([['research.json', MANIFEST], ...files]), sha256)
}

function versionOf(projectFiles: ReadonlyMap<string, string>, id: string, type: 'node' | 'evidence' | 'result' | 'edge'): string {
  const dir = type === 'node' ? 'nodes' : type === 'evidence' ? 'evidence' : type === 'edge' ? 'edges' : 'results'
  const ext = type === 'edge' ? '.json' : '.md'
  const content = projectFiles.get(`${dir}/${id}${ext}`)
  return content !== undefined ? fileVersion(content, sha256) : ''
}

describe('parseCommand', () => {
  it('parses every command kind', () => {
    const commands: unknown[] = [
      {
        kind: 'create_evidence_assertion',
        id: EV,
        publicationRef: { pmid: '12345678' },
        locator: { kind: 'pubmed_abstract' },
        assertion: 'Claim.',
        direction: 'supports',
      },
      { kind: 'review_evidence_assertion', id: EV, expectedFileVersion: 'a'.repeat(64), reviewStatus: 'reviewed' },
      { kind: 'create_node', id: NODE, nodeKind: 'hypothesis', confidence: 'moderate', body: 'body' },
      { kind: 'update_node', id: NODE, expectedFileVersion: 'b'.repeat(64), body: 'new body' },
      { kind: 'create_edge', id: EDGE, from: RES, to: NODE, relation: 'causes', basis: 'experiment' },
      { kind: 'update_edge', id: EDGE, expectedFileVersion: 'c'.repeat(64), relation: 'associated_with' },
      { kind: 'create_result', id: RES, observedAt: '2026-08-24', body: 'body' },
      { kind: 'update_result', id: RES, expectedFileVersion: 'd'.repeat(64), status: 'validated' },
      { kind: 'import_draft_item', id: EV, index: 0, draft: { unused: true } },
      { kind: 'delete_edge', id: EDGE, expectedFileVersion: 'e'.repeat(64) },
      { kind: 'delete_node', id: NODE, expectedFileVersion: 'f'.repeat(64) },
    ]
    for (const raw of commands) {
      const parsed = parseCommand(raw)
      expect(parsed.ok).toBe(true)
    }
  })

  it('rejects unknown kinds, extra fields, and missing fields', () => {
    expect(parseCommand({ kind: 'delete_result', id: RES, expectedFileVersion: 'a'.repeat(64) }).ok).toBe(false)
    expect(parseCommand({
      kind: 'create_node', id: NODE, nodeKind: 'hypothesis', confidence: 'moderate', body: 'x', extra: 1,
    }).ok).toBe(false)
    expect(parseCommand({ kind: 'create_node', id: NODE, nodeKind: 'hypothesis', confidence: 'moderate' }).ok).toBe(false)
  })

  it('rejects update commands without any change', () => {
    expect(parseCommand({ kind: 'update_node', id: NODE, expectedFileVersion: 'a'.repeat(64) }).ok).toBe(false)
    expect(parseCommand({ kind: 'update_result', id: RES, expectedFileVersion: 'a'.repeat(64) }).ok).toBe(false)
    expect(parseCommand({ kind: 'update_edge', id: EDGE, expectedFileVersion: 'a'.repeat(64) }).ok).toBe(false)
  })

  it('rejects update_edge attempts to move endpoints', () => {
    expect(parseCommand({
      kind: 'update_edge', id: EDGE, expectedFileVersion: 'a'.repeat(64), from: NODE,
    }).ok).toBe(false)
  })
})

describe('planCommand: create_evidence_assertion', () => {
  it('renders a candidate assertion with normalized identifiers', () => {
    const project = build([])
    const command = parseCommand({
      kind: 'create_evidence_assertion',
      id: EV,
      publicationRef: { doi: 'https://doi.org/10.1000/ABC' },
      locator: { kind: 'pubmed_abstract' },
      assertion: 'STAT3 is phosphorylated.',
      direction: 'supports',
    })
    if (!command.ok) throw new Error('parse failed')
    const plan = planCommand(project, command.value, sha256)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.path).toBe(`evidence/${EV}.md`)
    expect(plan.writeKind).toBe('create')
    expect(writeContent(plan)).toContain('review_status: candidate')
    expect(writeContent(plan)).toContain('doi: 10.1000/ABC')
  })

  it('renders files that re-parse without diagnostics', () => {
    const project = build([])
    for (const raw of [
      {
        kind: 'create_evidence_assertion',
        id: EV,
        publicationRef: { pmid: '12345678', doi: 'https://doi.org/10.1000/ABC' },
        locator: { kind: 'pubmed_abstract' },
        assertion: 'STAT3 is phosphorylated: yes.',
        direction: 'supports',
        limitations: ['in vitro', 'n = 3'],
      },
      {
        kind: 'create_node',
        id: NODE,
        nodeKind: 'hypothesis',
        confidence: 'moderate',
        body: '# Claim\n\nBody with a colon: yes.\n',
      },
      {
        kind: 'create_result',
        id: RES,
        observedAt: '2026-08-24',
        body: '# Result\n\n- item\n- item\n',
      },
    ]) {
      const command = parseCommand(raw)
      if (!command.ok) throw new Error('parse failed')
      const plan = planCommand(project, command.value, sha256)
      if (!plan.ok) throw new Error('plan failed')
      const reparsed = parseAndValidateProject(new Map([['research.json', MANIFEST], [plan.path, writeContent(plan)]]), sha256)
      expect(reparsed.diagnostics).toEqual([])
    }
  })

  it('rejects duplicate ids and missing publication refs', () => {
    const project = build([evidenceFile(EV, 'candidate', 'supports')])
    const duplicate = planCommand(project, {
      kind: 'create_evidence_assertion',
      id: EV,
      publicationRef: { pmid: '12345678' },
      locator: { kind: 'pubmed_abstract' },
      assertion: 'x',
      direction: 'supports',
    }, sha256)
    expect(duplicate.ok).toBe(false)

    const missing = planCommand(project, {
      kind: 'create_evidence_assertion',
      id: `ev_${UUID_C}`,
      locator: { kind: 'pubmed_abstract' },
      assertion: 'x',
      direction: 'supports',
    }, sha256)
    expect(missing.ok).toBe(false)
  })
})

describe('planCommand: review_evidence_assertion', () => {
  const reviewed = () => build([evidenceFile(EV, 'candidate', 'supports')])

  it('renders the reviewed state and enforces the state machine', () => {
    const project = reviewed()
    const version = versionOf(project.files, EV, 'evidence')
    const plan = planCommand(project, {
      kind: 'review_evidence_assertion',
      id: EV,
      expectedFileVersion: version,
      reviewStatus: 'reviewed',
    }, sha256)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(writeContent(plan)).toContain('review_status: reviewed')
    expect(plan.writeKind).toBe('update')
  })

  it('rejects terminal-to-live transitions', () => {
    const project = build([evidenceFile(EV, 'rejected', 'supports')])
    const version = versionOf(project.files, EV, 'evidence')
    const plan = planCommand(project, {
      kind: 'review_evidence_assertion',
      id: EV,
      expectedFileVersion: version,
      reviewStatus: 'reviewed',
    }, sha256)
    expect(plan.ok).toBe(false)
  })

  it('rejects a stale expectedFileVersion', () => {
    const project = reviewed()
    const plan = planCommand(project, {
      kind: 'review_evidence_assertion',
      id: EV,
      expectedFileVersion: '0'.repeat(64),
      reviewStatus: 'reviewed',
    }, sha256)
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.issues.some((issue) => issue.code === 'STALE_TARGET')).toBe(true)
    }
  })
})

describe('planCommand: nodes', () => {
  const withReviewedSupport = () => build([
    evidenceFile(EV, 'reviewed', 'supports'),
    nodeFile(NODE, 'hypothesis'),
  ])

  it('creates hypotheses without support and findings only with reviewed support', () => {
    const project = withReviewedSupport()
    const hypothesis = planCommand(project, {
      kind: 'create_node',
      id: NODE_B,
      nodeKind: 'hypothesis',
      confidence: 'low',
      body: 'body',
    }, sha256)
    expect(hypothesis.ok).toBe(true)

    const findingNoSupport = planCommand(project, {
      kind: 'create_node',
      id: NODE_B,
      nodeKind: 'finding',
      confidence: 'low',
      body: 'body',
    }, sha256)
    expect(findingNoSupport.ok).toBe(false)

    const findingWithSupport = planCommand(project, {
      kind: 'create_node',
      id: NODE_B,
      nodeKind: 'finding',
      confidence: 'low',
      evidenceRefs: [{ id: EV, role: 'supports' }],
      body: 'body',
    }, sha256)
    expect(findingWithSupport.ok).toBe(true)
  })

  it('rejects references to unreviewed evidence', () => {
    const project = build([
      evidenceFile(EV, 'candidate', 'supports'),
      nodeFile(NODE, 'hypothesis'),
    ])
    const plan = planCommand(project, {
      kind: 'create_node',
      id: NODE_B,
      nodeKind: 'hypothesis',
      confidence: 'low',
      evidenceRefs: [{ id: EV, role: 'supports' }],
      body: 'body',
    }, sha256)
    expect(plan.ok).toBe(false)
  })

  it('promotes a hypothesis to a finding with support', () => {
    const project = withReviewedSupport()
    const version = versionOf(project.files, NODE, 'node')
    const plan = planCommand(project, {
      kind: 'update_node',
      id: NODE,
      expectedFileVersion: version,
      nodeKind: 'finding',
      evidenceRefs: [{ id: EV, role: 'supports' }],
    }, sha256)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(writeContent(plan)).toContain('kind: finding')
    expect(writeContent(plan)).toContain(`id: ${EV}`)
    // body survives the update
    expect(writeContent(plan)).toContain('Body.')
  })

  it('rejects demotion-relevant invalid updates and stale versions', () => {
    const project = withReviewedSupport()
    const stale = planCommand(project, {
      kind: 'update_node',
      id: NODE,
      expectedFileVersion: '9'.repeat(64),
      nodeKind: 'hypothesis',
    }, sha256)
    expect(stale.ok).toBe(false)

    const unknown = planCommand(project, {
      kind: 'update_node',
      id: NODE_B,
      expectedFileVersion: '9'.repeat(64),
      confidence: 'high',
    }, sha256)
    expect(unknown.ok).toBe(false)
  })
})

describe('planCommand: edges', () => {
  const projectWithEndpoints = () => build([
    nodeFile(NODE, 'hypothesis'),
    nodeFile(NODE_B, 'prediction'),
    resultFile(RES, 'validated'),
  ])

  it('creates valid edges and rejects invalid basis payloads', () => {
    const project = projectWithEndpoints()
    const ok = planCommand(project, {
      kind: 'create_edge',
      id: EDGE,
      from: NODE,
      to: NODE_B,
      relation: 'causes',
      basis: 'ai_inference',
      provenance: 'model simulation',
      evidenceGap: 'no direct measurement',
    }, sha256)
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.path).toBe(`edges/${EDGE}.json`)

    const noGap = planCommand(project, {
      kind: 'create_edge',
      id: EDGE,
      from: NODE,
      to: NODE_B,
      relation: 'causes',
      basis: 'ai_inference',
      provenance: 'model simulation',
    }, sha256)
    expect(noGap.ok).toBe(false)

    const literatureNoRefs = planCommand(project, {
      kind: 'create_edge',
      id: EDGE,
      from: NODE,
      to: NODE_B,
      relation: 'causes',
      basis: 'literature',
    }, sha256)
    expect(literatureNoRefs.ok).toBe(false)

    const missingEndpoint = planCommand(project, {
      kind: 'create_edge',
      id: EDGE,
      from: NODE,
      to: `node_${UUID_C}`,
      relation: 'causes',
      basis: 'experiment',
    }, sha256)
    expect(missingEndpoint.ok).toBe(false)
  })

  it('enforces predicts endpoint kinds', () => {
    const project = projectWithEndpoints()
    const valid = planCommand(project, {
      kind: 'create_edge',
      id: EDGE,
      from: NODE,
      to: NODE_B,
      relation: 'predicts',
      basis: 'ai_inference',
      provenance: 'bounded simulation',
      evidenceGap: 'not experimentally tested',
    }, sha256)
    expect(valid.ok).toBe(true)

    const invalid = planCommand(project, {
      kind: 'create_edge',
      id: EDGE,
      from: NODE_B,
      to: NODE,
      relation: 'predicts',
      basis: 'ai_inference',
      provenance: 'bounded simulation',
      evidenceGap: 'not experimentally tested',
    }, sha256)
    expect(invalid.ok).toBe(false)
  })

  it('updates relation and re-renders while keeping endpoints', () => {
    const project = projectWithEndpoints()
    const created = planCommand(project, {
      kind: 'create_edge',
      id: EDGE,
      from: NODE,
      to: NODE_B,
      relation: 'causes',
      basis: 'experiment',
    }, sha256)
    if (!created.ok) throw new Error('create failed')
    // simulate the write for the version check
    const withEdge = build([
      nodeFile(NODE, 'hypothesis'),
      nodeFile(NODE_B, 'prediction'),
      resultFile(RES, 'validated'),
      [`edges/${EDGE}.json`, writeContent(created)],
    ])
    const version = versionOf(withEdge.files, EDGE, 'edge')
    const updated = planCommand(withEdge, {
      kind: 'update_edge',
      id: EDGE,
      expectedFileVersion: version,
      relation: 'associated_with',
    }, sha256)
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(writeContent(updated)).toContain('"relation": "associated_with"')
    expect(writeContent(updated)).toContain(`"from": "${NODE}"`)
  })

  it('drops ai-inference-only fields when changing basis', () => {
    const project = projectWithEndpoints()
    const created = planCommand(project, {
      kind: 'create_edge',
      id: EDGE,
      from: NODE,
      to: NODE_B,
      relation: 'causes',
      basis: 'ai_inference',
      provenance: 'model simulation',
      evidenceGap: 'no direct measurement',
    }, sha256)
    if (!created.ok) throw new Error('create failed')
    const withEdge = build([
      nodeFile(NODE, 'hypothesis'),
      nodeFile(NODE_B, 'prediction'),
      resultFile(RES, 'validated'),
      [`edges/${EDGE}.json`, writeContent(created)],
    ])
    const version = versionOf(withEdge.files, EDGE, 'edge')
    const updated = planCommand(withEdge, {
      kind: 'update_edge',
      id: EDGE,
      expectedFileVersion: version,
      basis: 'experiment',
    }, sha256)
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(writeContent(updated)).not.toContain('provenance')
    expect(writeContent(updated)).not.toContain('evidence_gap')
  })
})

describe('planCommand: deletion', () => {
  it('plans one detached Hypothesis/Prediction or Edge deletion with a current file version', () => {
    const detached = build([nodeFile(NODE, 'hypothesis')])
    const deleteNode = planCommand(detached, {
      kind: 'delete_node',
      id: NODE,
      expectedFileVersion: versionOf(detached.files, NODE, 'node'),
    }, sha256)
    expect(deleteNode).toMatchObject({
      ok: true,
      path: `nodes/${NODE}.md`,
      writeKind: 'delete',
      entityId: NODE,
    })
    expect(deleteNode).not.toHaveProperty('content')

    const withEdge = build([
      nodeFile(NODE, 'hypothesis'),
      nodeFile(NODE_B, 'prediction'),
      edgeFile(EDGE, NODE, NODE_B),
    ])
    const deleteEdge = planCommand(withEdge, {
      kind: 'delete_edge',
      id: EDGE,
      expectedFileVersion: versionOf(withEdge.files, EDGE, 'edge'),
    }, sha256)
    expect(deleteEdge).toMatchObject({
      ok: true,
      path: `edges/${EDGE}.json`,
      writeKind: 'delete',
      entityId: EDGE,
    })
  })

  it('rejects stale targets, connected nodes, Findings, and support-critical Edges', () => {
    const connected = build([
      nodeFile(NODE, 'hypothesis'),
      nodeFile(NODE_B, 'prediction'),
      edgeFile(EDGE, NODE, NODE_B),
    ])
    expect(planCommand(connected, {
      kind: 'delete_node',
      id: NODE,
      expectedFileVersion: versionOf(connected.files, NODE, 'node'),
    }, sha256).ok).toBe(false)
    expect(planCommand(connected, {
      kind: 'delete_node',
      id: NODE_B,
      expectedFileVersion: '0'.repeat(64),
    }, sha256).ok).toBe(false)

    const finding = build([
      evidenceFile(EV, 'reviewed', 'supports'),
      nodeFile(NODE, 'finding', `evidence_refs:\n  - id: ${EV}\n    role: supports\n`),
    ])
    expect(planCommand(finding, {
      kind: 'delete_node',
      id: NODE,
      expectedFileVersion: versionOf(finding.files, NODE, 'node'),
    }, sha256).ok).toBe(false)

    const supportedFinding = build([
      resultFile(RES, 'validated'),
      nodeFile(NODE, 'finding'),
      edgeFile(EDGE, RES, NODE),
    ])
    expect(supportedFinding.diagnostics).toEqual([])
    expect(planCommand(supportedFinding, {
      kind: 'delete_edge',
      id: EDGE,
      expectedFileVersion: versionOf(supportedFinding.files, EDGE, 'edge'),
    }, sha256).ok).toBe(false)
  })
})

describe('planCommand: results', () => {
  const withResult = () => build([resultFile(RES, 'draft')])

  it('creates draft results and validates status transitions', () => {
    const project = withResult()
    const create = planCommand(project, {
      kind: 'create_result',
      id: `res_${UUID_B}`,
      observedAt: '2026-08-25',
      body: '# R\n\nBody.\n',
    }, sha256)
    expect(create.ok).toBe(true)
    if (!create.ok) return
    expect(writeContent(create)).toContain('status: draft')

    const version = versionOf(project.files, RES, 'result')
    const validate = planCommand(project, {
      kind: 'update_result',
      id: RES,
      expectedFileVersion: version,
      status: 'validated',
    }, sha256)
    expect(validate.ok).toBe(true)

    const invalidTransition = planCommand(project, {
      kind: 'update_result',
      id: RES,
      expectedFileVersion: version,
      status: 'superseded',
    }, sha256)
    // draft -> superseded is allowed per the M1 spec state machine
    expect(invalidTransition.ok).toBe(true)
  })

  it('rejects superseded results from revalidating', () => {
    const project = build([resultFile(RES, 'superseded')])
    const version = versionOf(project.files, RES, 'result')
    const plan = planCommand(project, {
      kind: 'update_result',
      id: RES,
      expectedFileVersion: version,
      status: 'validated',
    }, sha256)
    expect(plan.ok).toBe(false)
  })
})

describe('planCommand: import_draft_item', () => {
  const validDraft = {
    schemaVersion: 1,
    producer: {
      retrievalSkill: 'pubmed-search',
      formatterSkill: 'scifork-research',
      generatedAt: '2026-08-24T10:00:00.000Z',
    },
    evidenceCandidates: [
      {
        publicationRef: { pmid: '12345678' },
        assertion: 'Imported claim.',
        locator: { kind: 'pubmed_abstract' },
        direction: 'supports',
      },
    ],
  }

  it('converts a validated candidate into a candidate assertion', () => {
    const project = build([])
    const plan = planCommand(project, {
      kind: 'import_draft_item',
      id: EV,
      index: 0,
      draft: validDraft,
    }, sha256)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.path).toBe(`evidence/${EV}.md`)
    expect(writeContent(plan)).toContain('review_status: candidate')
    expect(writeContent(plan)).toContain("pmid: '12345678'")
  })

  it('rejects invalid drafts, unimportable candidates, and bad indices', () => {
    const project = build([])
    const unimportable = {
      ...validDraft,
      evidenceCandidates: [{
        assertion: 'No identifiers.',
        locator: { kind: 'pdf', page: 1 },
        direction: 'supports',
      }],
    }
    for (const raw of [
      { kind: 'import_draft_item', id: EV, index: 0, draft: { invalid: true } },
      { kind: 'import_draft_item', id: EV, index: 0, draft: unimportable },
      { kind: 'import_draft_item', id: EV, index: 5, draft: validDraft },
    ] as unknown as ResearchCommand[]) {
      const plan = planCommand(project, raw, sha256)
      expect(plan.ok).toBe(false)
      if (!plan.ok) {
        expect(plan.issues.some((issue) => issue.code === 'INVALID_IMPORT_DRAFT')).toBe(true)
      }
    }
  })

  it('rejects duplicate target ids', () => {
    const project = build([evidenceFile(EV, 'candidate', 'supports')])
    const plan = planCommand(project, {
      kind: 'import_draft_item',
      id: EV,
      index: 0,
      draft: validDraft,
    }, sha256)
    expect(plan.ok).toBe(false)
  })
})
