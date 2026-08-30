import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { parseAndValidateProject, validateProject } from '../../src/core/validator.js'
import type { LoadedProject } from '../../src/core/parser.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

const UUID_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const UUID_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const UUID_C = 'cccccccc-3333-4333-8333-333333333333'
const UUID_D = 'dddddddd-4444-4444-8444-444444444444'
const NODE = `node_${UUID_A}`
const NODE_B = `node_${UUID_B}`
const EV = `ev_${UUID_A}`
const EV_B = `ev_${UUID_B}`
const EV_C = `ev_${UUID_C}`
const RES = `res_${UUID_A}`
const EDGE = `edge_${UUID_A}`
const EDGE_B = `edge_${UUID_B}`

const MANIFEST = JSON.stringify({ schema_version: 1, project_id: UUID_A, name: 'Validator' })

function evidenceFile(id: string, reviewStatus: string, direction: string, body = 'note\n'): [string, string] {
  const md = [
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
    body,
  ].join('\n') + '\n'
  return [`evidence/${id}.md`, md]
}

function nodeFile(id: string, kind: string, refs: string): [string, string] {
  const md = [
    '---',
    `id: ${id}`,
    `kind: ${kind}`,
    'confidence: moderate',
    refs,
    '---',
    '# Node\n\nBody.\n',
  ].filter((line) => line !== '').join('\n') + '\n'
  return [`nodes/${id}.md`, md]
}

function edgeJsonFile(id: string, from: string, to: string, extra: Record<string, unknown> = {}): [string, string] {
  return [
    `edges/${id}.json`,
    JSON.stringify({ id, from, to, relation: 'supports', basis: 'experiment', ...extra }),
  ]
}

function resultFile(id: string, status: string): [string, string] {
  const md = [
    '---',
    `id: ${id}`,
    `status: ${status}`,
    'observed_at: "2026-08-24"',
    '---',
    '# Result\n\nBody.\n',
  ].join('\n') + '\n'
  return [`results/${id}.md`, md]
}

function build(files: [string, string][]): LoadedProject {
  return parseAndValidateProject(new Map([['research.json', MANIFEST], ...files]), sha256)
}

const SUPPORTING_REFS = `evidence_refs:\n  - id: ${EV}\n    role: supports\n`

describe('validateProject', () => {
  it('accepts a finding supported by a reviewed supporting assertion', () => {
    const project = build([
      evidenceFile(EV, 'reviewed', 'supports'),
      nodeFile(NODE, 'finding', SUPPORTING_REFS),
    ])
    expect(project.diagnostics).toEqual([])
  })

  it('accepts a finding supported by a validated result edge', () => {
    const project = build([
      resultFile(RES, 'validated'),
      nodeFile(NODE, 'finding', ''),
      edgeJsonFile(EDGE, RES, NODE),
    ])
    expect(project.diagnostics).toEqual([])
  })

  it('accepts hypotheses and predictions without support', () => {
    const project = build([
      nodeFile(NODE, 'hypothesis', ''),
      nodeFile(NODE_B, 'prediction', ''),
    ])
    expect(project.diagnostics).toEqual([])
  })

  it('accepts predicts only from a finding or hypothesis to a prediction', () => {
    const valid = build([
      nodeFile(NODE, 'hypothesis', ''),
      nodeFile(NODE_B, 'prediction', ''),
      edgeJsonFile(EDGE, NODE, NODE_B, {
        relation: 'predicts',
        basis: 'ai_inference',
        provenance: 'bounded simulation',
        evidence_gap: 'not experimentally tested',
      }),
    ])
    expect(valid.diagnostics).toEqual([])

    const invalid = build([
      nodeFile(NODE, 'prediction', ''),
      nodeFile(NODE_B, 'hypothesis', ''),
      edgeJsonFile(EDGE, NODE, NODE_B, {
        relation: 'predicts',
        basis: 'ai_inference',
        provenance: 'bounded simulation',
        evidence_gap: 'not experimentally tested',
      }),
    ])
    expect(invalid.diagnostics.some((diagnostic) => diagnostic.code === 'invalid_predicts_endpoints')).toBe(true)
  })

  it('flags references to unknown evidence', () => {
    const project = build([
      nodeFile(NODE, 'hypothesis', `evidence_refs:\n  - id: ${EV}\n    role: supports\n`),
    ])
    expect(project.diagnostics.some((d) => d.code === 'unknown_reference')).toBe(true)
  })

  it('flags references to unreviewed and rejected evidence', () => {
    const candidate = build([
      evidenceFile(EV, 'candidate', 'supports'),
      nodeFile(NODE, 'hypothesis', SUPPORTING_REFS),
    ])
    expect(candidate.diagnostics.some((d) => d.code === 'evidence_not_reviewed')).toBe(true)

    const rejected = build([
      evidenceFile(EV, 'rejected', 'supports'),
      nodeFile(NODE, 'hypothesis', SUPPORTING_REFS),
    ])
    expect(rejected.diagnostics.some((d) => d.code === 'evidence_not_reviewed')).toBe(true)
  })

  it('flags role/direction mismatches and context references', () => {
    const mismatch = build([
      evidenceFile(EV, 'reviewed', 'contradicts'),
      nodeFile(NODE, 'hypothesis', SUPPORTING_REFS),
    ])
    expect(mismatch.diagnostics.some((d) => d.code === 'role_direction_mismatch')).toBe(true)

    const context = build([
      evidenceFile(EV, 'reviewed', 'context'),
      nodeFile(NODE, 'hypothesis', SUPPORTING_REFS),
    ])
    expect(context.diagnostics.some((d) => d.code === 'role_direction_mismatch')).toBe(true)
  })

  it('flags findings that lack the support threshold', () => {
    const unsupported = build([nodeFile(NODE, 'finding', '')])
    expect(unsupported.diagnostics.some((d) => d.code === 'finding_lacks_support')).toBe(true)
  })

  it('does not count candidate evidence or draft results toward support', () => {
    const candidateEvidence = build([
      evidenceFile(EV, 'candidate', 'supports'),
      nodeFile(NODE, 'finding', SUPPORTING_REFS),
    ])
    expect(candidateEvidence.diagnostics.some((d) => d.code === 'finding_lacks_support')).toBe(true)

    const draftResult = build([
      resultFile(RES, 'draft'),
      nodeFile(NODE, 'finding', ''),
      edgeJsonFile(EDGE, RES, NODE),
    ])
    expect(draftResult.diagnostics.some((d) => d.code === 'finding_lacks_support')).toBe(true)

    const contradiction = build([
      evidenceFile(EV, 'reviewed', 'supports'),
      evidenceFile(EV_B, 'reviewed', 'contradicts'),
      nodeFile(NODE, 'finding', `evidence_refs:\n  - id: ${EV_B}\n    role: contradicts\n`),
    ])
    expect(contradiction.diagnostics.some((d) => d.code === 'finding_lacks_support')).toBe(true)
  })

  it('flags edges with unknown endpoints', () => {
    const missing = `res_${UUID_D}`
    const project = build([
      nodeFile(NODE, 'hypothesis', ''),
      edgeJsonFile(EDGE, RES, NODE),
      edgeJsonFile(EDGE_B, NODE, missing),
    ])
    const unknown = project.diagnostics.filter((d) => d.code === 'unknown_endpoint')
    expect(unknown).toHaveLength(2)
  })

  it('flags edge evidence refs that are unknown or unreviewed', () => {
    const unknown = build([
      nodeFile(NODE, 'hypothesis', ''),
      nodeFile(NODE_B, 'hypothesis', ''),
      edgeJsonFile(EDGE, NODE, NODE_B, {
        basis: 'literature',
        evidence_refs: [{ id: EV, role: 'supports' }],
      }),
    ])
    expect(unknown.diagnostics.some((d) => d.code === 'unknown_reference')).toBe(true)

    const unreviewed = build([
      evidenceFile(EV, 'candidate', 'supports'),
      nodeFile(NODE, 'hypothesis', ''),
      nodeFile(NODE_B, 'hypothesis', ''),
      edgeJsonFile(EDGE, NODE, NODE_B, {
        basis: 'literature',
        evidence_refs: [{ id: EV, role: 'supports' }],
      }),
    ])
    expect(unreviewed.diagnostics.some((d) => d.code === 'evidence_not_reviewed')).toBe(true)
  })

  it('merges parser and validator diagnostics through parseAndValidateProject', () => {
    const project = build([
      ['nodes/readme.md', '# stray'],
      nodeFile(NODE, 'hypothesis', SUPPORTING_REFS),
    ])
    expect(project.diagnostics.some((d) => d.code === 'unknown_managed_file')).toBe(true)
    expect(project.diagnostics.some((d) => d.code === 'unknown_reference')).toBe(true)
  })

  it('returns no extra diagnostics when validateProject is called twice', () => {
    const project = build([
      evidenceFile(EV, 'reviewed', 'supports'),
      nodeFile(NODE, 'finding', SUPPORTING_REFS),
    ])
    expect(validateProject(project)).toEqual([])
    expect(validateProject(project)).toEqual([])
  })

  it('reports an evidence ref whose role contradicts but direction supports', () => {
    const project = build([
      evidenceFile(EV, 'reviewed', 'supports'),
      nodeFile(NODE, 'hypothesis', `evidence_refs:\n  - id: ${EV}\n    role: contradicts\n`),
    ])
    expect(project.diagnostics.some((d) => d.code === 'role_direction_mismatch')).toBe(true)
  })
})
