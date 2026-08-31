import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { parseProject } from '../../src/core/parser.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

const UUID = '01234567-89ab-4cde-8f01-23456789abcd'
const MANIFEST = JSON.stringify({
  schema_version: 1,
  project_id: UUID,
  name: 'Parser Project',
})

function nodeMd(id: string, body = '# Claim\n\nBody text.\n'): string {
  return `---\nid: ${id}\nkind: hypothesis\nconfidence: moderate\n---\n${body}`
}

function evidenceMd(id: string, extra = ''): string {
  return [
    '---',
    `id: ${id}`,
    'publication_ref:',
    '  pmid: "12345678"',
    'locator:',
    '  kind: pubmed_abstract',
    'assertion: "STAT3 is phosphorylated."',
    'direction: supports',
    'review_status: candidate',
    extra,
    '---',
    'Context notes.',
  ].filter((line) => line !== '').join('\n') + '\n'
}

function edgeJson(id: string, from: string, to: string): string {
  return JSON.stringify({
    id,
    from,
    to,
    relation: 'supports',
    basis: 'experiment',
  })
}

function questionMd(id: string, body = ''): string {
  return `---\nid: ${id}\nquestion: What are the key drivers of bone aging?\nscope_assumptions:\n  - mammalian skeletal aging\n---\n${body}`
}

function framingLinkJson(id: string, from: string, to: string): string {
  return JSON.stringify({ id, from, to, relation: 'addresses' })
}

describe('parseProject', () => {
  it('parses a complete valid project', () => {
    const node = `node_${UUID}`
    const ev = `ev_${UUID}`
    const question = `question_${UUID}`
    const framingLink = `qlink_${UUID}`
    const files = new Map([
      ['research.json', MANIFEST],
      [`questions/${question}.md`, questionMd(question)],
      [`question-links/${framingLink}.json`, framingLinkJson(framingLink, node, question)],
      [`nodes/${node}.md`, nodeMd(node)],
      [`evidence/${ev}.md`, evidenceMd(ev)],
    ])
    const project = parseProject(files, sha256)
    expect(project.diagnostics).toEqual([])
    expect(project.manifest).toEqual({
      schema_version: 1,
      project_id: UUID,
      name: 'Parser Project',
    })
    expect(project.nodes.size).toBe(1)
    expect(project.questions.get(question)?.question).toContain('bone aging')
    expect(project.framingLinks.get(framingLink)).toMatchObject({
      from: node,
      to: question,
      relation: 'addresses',
    })
    expect(project.nodes.get(node)?.body).toContain('Body text.')
    expect(project.evidenceAssertions.get(ev)?.assertion).toBe('STAT3 is phosphorylated.')
    expect(project.projectRevision).toMatch(/^[0-9a-f]{64}$/)
    expect([...project.files.entries()]).toEqual([...files.entries()])
  })

  it('allows optional Question notes but strictly validates Question and Framing Link files', () => {
    const node = `node_${UUID}`
    const question = `question_${UUID}`
    const framingLink = `qlink_${UUID}`
    const project = parseProject(new Map([
      ['research.json', MANIFEST],
      [`nodes/${node}.md`, nodeMd(node)],
      [`questions/${question}.md`, questionMd(question)],
      [`question-links/${framingLink}.json`, framingLinkJson(framingLink, node, question)],
    ]), sha256)
    expect(project.diagnostics).toEqual([])
    expect(project.questions.get(question)?.body).toBe('')
  })

  it('reports a missing manifest and still returns the entities', () => {
    const node = `node_${UUID}`
    const project = parseProject(new Map([[`nodes/${node}.md`, nodeMd(node)]]), sha256)
    expect(project.manifest).toBeUndefined()
    expect(project.diagnostics.some((d) => d.code === 'invalid_manifest')).toBe(true)
    expect(project.nodes.size).toBe(1)
  })

  it('distinguishes an unsupported schema version', () => {
    const manifest = JSON.stringify({ schema_version: 2, project_id: UUID, name: 'x' })
    const project = parseProject(new Map([['research.json', manifest]]), sha256)
    expect(project.diagnostics.some((d) => d.code === 'unsupported_schema_version')).toBe(true)
  })

  it('flags unknown files in managed directories', () => {
    const files = new Map<string, string>([
      ['research.json', MANIFEST],
      ['nodes/readme.md', '# hi'],
      ['nodes/deep/node_other.md', nodeMd(`node_${UUID}`)],
      [`edges/edge_${UUID}.json`, edgeJson(`edge_${UUID}`, `res_${UUID}`, `node_${UUID}`)],
    ])
    const project = parseProject(files, sha256)
    const unknown = project.diagnostics.filter((d) => d.code === 'unknown_managed_file')
    expect(unknown).toHaveLength(2)
  })

  it('rejects id/filename mismatches', () => {
    const node = `node_${UUID}`
    const files = new Map([
      ['research.json', MANIFEST],
      [`nodes/node_00000000-0000-4000-8000-000000000000.md`, nodeMd(node)],
    ])
    const project = parseProject(files, sha256)
    expect(project.diagnostics.some((d) => d.code === 'id_filename_mismatch')).toBe(true)
    expect(project.nodes.size).toBe(0)
  })

  it('requires a non-empty body for nodes and results but not evidence', () => {
    const node = `node_${UUID}`
    const res = `res_${UUID}`
    const ev = `ev_${UUID}`
    const files = new Map([
      ['research.json', MANIFEST],
      [`nodes/${node}.md`, nodeMd(node, '')],
      [`results/${res}.md`, `---\nid: ${res}\nstatus: draft\nobserved_at: "2026-08-24"\n---\n`],
      [`evidence/${ev}.md`, evidenceMd(ev)],
    ])
    const project = parseProject(files, sha256)
    const emptyBody = project.diagnostics.filter((d) => d.code === 'invalid_entity')
    expect(emptyBody).toHaveLength(2)
    expect(project.evidenceAssertions.size).toBe(1)
  })

  it('normalizes DOIs found in hand-authored files', () => {
    const ev = `ev_${UUID}`
    const md = [
      '---',
      `id: ${ev}`,
      'publication_ref:',
      '  doi: "https://doi.org/10.1000/XYZ-9"',
      'locator:',
      '  kind: pubmed_abstract',
      'assertion: "Claim."',
      'direction: context',
      'review_status: candidate',
      '---',
    ].join('\n') + '\n'
    const project = parseProject(new Map([
      ['research.json', MANIFEST],
      [`evidence/${ev}.md`, md],
    ]), sha256)
    expect(project.diagnostics).toEqual([])
    expect(project.evidenceAssertions.get(ev)?.publication_ref).toEqual({ doi: '10.1000/XYZ-9' })
  })

  it('parses files with Windows line endings', () => {
    const node = `node_${UUID}`
    const md = `---\r\nid: ${node}\r\nkind: prediction\r\nconfidence: low\r\n---\r\n# P\r\n\r\nText.\r\n`
    const project = parseProject(new Map([
      ['research.json', MANIFEST],
      [`nodes/${node}.md`, md],
    ]), sha256)
    expect(project.diagnostics).toEqual([])
    expect(project.nodes.get(node)?.kind).toBe('prediction')
  })

  it('reports invalid YAML front matter without throwing', () => {
    const files = new Map([
      ['research.json', MANIFEST],
      [`nodes/node_${UUID}.md`, '---\nid: [unclosed\n---\nbody'],
    ])
    const project = parseProject(files, sha256)
    expect(project.diagnostics.some((d) => d.code === 'invalid_entity')).toBe(true)
    expect(project.nodes.size).toBe(0)
  })

  it('reports a null publication reference without throwing', () => {
    const ev = `ev_${UUID}`
    const project = parseProject(new Map([
      ['research.json', MANIFEST],
      [`evidence/${ev}.md`, [
        '---',
        `id: ${ev}`,
        'publication_ref: null',
        'locator:',
        '  kind: pubmed_abstract',
        'assertion: "Claim."',
        'direction: supports',
        'review_status: candidate',
        '---',
        'Body.',
      ].join('\n') + '\n'],
    ]), sha256)
    expect(project.diagnostics.some((d) => d.path === `evidence/${ev}.md` && d.code === 'invalid_entity')).toBe(true)
    expect(project.evidenceAssertions.size).toBe(0)
  })

  it('reports a non-object manifest without throwing', () => {
    const project = parseProject(new Map([
      ['research.json', 'null'],
    ]), sha256)
    expect(project.manifest).toBeUndefined()
    expect(project.diagnostics).toContainEqual({
      path: 'research.json',
      code: 'invalid_manifest',
      message: 'research.json must contain a JSON object',
    })
  })

  it('reports non-object front matter without throwing', () => {
    const node = `node_${UUID}`
    const project = parseProject(new Map([
      ['research.json', MANIFEST],
      [`nodes/${node}.md`, '---\n- item\n---\nBody.\n'],
    ]), sha256)
    expect(project.nodes.size).toBe(0)
    expect(project.diagnostics).toContainEqual({
      path: `nodes/${node}.md`,
      code: 'invalid_entity',
      message: 'front matter must be a YAML object',
    })
  })

  it('enforces the body limit in UTF-8 bytes', () => {
    const node = `node_${UUID}`
    const body = '中'.repeat(22000)
    const project = parseProject(new Map([
      ['research.json', MANIFEST],
      [`nodes/${node}.md`, nodeMd(node, body)],
    ]), sha256)
    expect(project.diagnostics.some((d) => d.message.includes('body exceeds'))).toBe(true)
  })

  it('parses edge JSON files into edges', () => {
    const node = `node_${UUID}`
    const res = `res_${UUID}`
    const edge = `edge_${UUID}`
    const files = new Map([
      ['research.json', MANIFEST],
      [`nodes/${node}.md`, nodeMd(node)],
      [`results/${res}.md`, `---\nid: ${res}\nstatus: validated\nobserved_at: "2026-08-24"\n---\n# R\n\nText.\n`],
      [`edges/${edge}.json`, edgeJson(edge, res, node)],
    ])
    const project = parseProject(files, sha256)
    expect(project.diagnostics).toEqual([])
    expect(project.edges.get(edge)?.relation).toBe('supports')
  })
})
