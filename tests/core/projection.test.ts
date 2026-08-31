import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { buildProjection } from '../../src/core/projection.js'
import { parseProject } from '../../src/core/parser.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

const UUID_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const UUID_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const NODE = `node_${UUID_A}`
const NODE_B = `node_${UUID_B}`
const EV = `ev_${UUID_A}`
const RES = `res_${UUID_A}`
const EDGE = `edge_${UUID_A}`
const QUESTION = `question_${UUID_A}`
const QLINK = `qlink_${UUID_A}`

const MANIFEST = JSON.stringify({ schema_version: 1, project_id: UUID_A, name: 'Projection' })

function build(files: [string, string][]) {
  const project = parseProject(new Map([['research.json', MANIFEST], ...files]), sha256)
  return buildProjection(project)
}

describe('buildProjection', () => {
  const baseFiles: [string, string][] = [
    [
      `evidence/${EV}.md`,
      [
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
      ].join('\n') + '\n',
    ],
    [
      `nodes/${NODE}.md`,
      [
        '---',
        `id: ${NODE}`,
        'kind: finding',
        'confidence: high',
        'evidence_refs:',
        `  - id: ${EV}`,
        '    role: supports',
        '---',
        '# Finding\n\nBody.\n',
      ].join('\n') + '\n',
    ],
    [
      `nodes/${NODE_B}.md`,
      `---\nid: ${NODE_B}\nkind: hypothesis\nconfidence: low\n---\n# Hypothesis\n\nBody.\n`,
    ],
    [
      `results/${RES}.md`,
      `---\nid: ${RES}\nstatus: validated\nobserved_at: "2026-08-24"\n---\n# Result\n\nBody.\n`,
    ],
    [
      `questions/${QUESTION}.md`,
      `---\nid: ${QUESTION}\nquestion: What drives bone aging?\nscope_assumptions:\n  - mammalian aging\n---\nNotes.\n`,
    ],
    [
      `question-links/${QLINK}.json`,
      JSON.stringify({ id: QLINK, from: NODE_B, to: QUESTION, relation: 'addresses' }),
    ],
    [
      `edges/${EDGE}.json`,
      JSON.stringify({ id: EDGE, from: RES, to: NODE_B, relation: 'causes', basis: 'experiment' }),
    ],
  ]

  it('projects every entity type with its fields', () => {
    const projection = build(baseFiles)
    expect(projection.entities).toHaveLength(5)
    const byId = new Map(projection.entities.map((entity) => [entity.id, entity]))
    expect(byId.get(NODE)).toMatchObject({ type: 'node', kind: 'finding', confidence: 'high' })
    expect(byId.get(EV)).toMatchObject({
      type: 'evidence',
      direction: 'supports',
      reviewStatus: 'reviewed',
      publicationRef: { pmid: '12345678' },
    })
    expect(byId.get(RES)).toMatchObject({ type: 'result', status: 'validated' })
    expect(byId.get(QUESTION)).toMatchObject({
      type: 'question',
      question: 'What drives bone aging?',
      scopeAssumptions: ['mammalian aging'],
    })
  })

  it('projects edge files and evidence refs as edges', () => {
    const projection = build(baseFiles)
    const edgeEdges = projection.edges.filter((edge) => edge.source === 'edge')
    expect(edgeEdges).toEqual([
      { from: RES, to: NODE_B, relation: 'causes', basis: 'experiment', source: 'edge', id: EDGE },
    ])
    const evidenceEdges = projection.edges.filter((edge) => edge.source === 'evidence_ref')
    expect(evidenceEdges).toEqual([
      { from: EV, to: NODE, relation: 'supports', source: 'evidence_ref' },
    ])
    expect(projection.edges.filter((edge) => edge.source === 'framing_link')).toEqual([
      { from: NODE_B, to: QUESTION, relation: 'addresses', source: 'framing_link', id: QLINK },
    ])
  })

  it('reconstructs reverse relations without storing them', () => {
    const projection = build(baseFiles)
    const incoming = projection.edges.filter((edge) => edge.to === NODE_B)
    expect(incoming).toHaveLength(1)
    expect(incoming[0]?.from).toBe(RES)
  })

  it('orders entities and edges deterministically', () => {
    const first = build(baseFiles)
    const second = build([...baseFiles].reverse())
    expect(second.entities).toEqual(first.entities)
    expect(second.edges).toEqual(first.edges)
  })

  it('projects an empty project to empty lists', () => {
    const projection = build([])
    expect(projection.entities).toEqual([])
    expect(projection.edges).toEqual([])
  })
})
