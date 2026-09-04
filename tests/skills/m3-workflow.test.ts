import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planCommand } from '../../src/core/commands.js'
import { validateImportDraft } from '../../src/core/import-draft.js'
import { parseAndValidateProject } from '../../src/core/validator.js'

const hash = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')
const projectId = 'aaaaaaaa-1111-4111-8111-111111111111'
const evidenceId = 'ev_bbbbbbbb-2222-4222-8222-222222222222'

const emptyProject = parseAndValidateProject(
  new Map([['research.json', JSON.stringify({ schema_version: 1, project_id: projectId, name: 'M3 workflow' })]]),
  hash,
)

describe('M3 retrieval to import workflow', () => {
  it('accepts a retrieval result formatted by scifork-research and plans one machine-reviewed import', () => {
    const draft = {
      schemaVersion: 1,
      producer: {
        retrievalSkill: 'alternative-retrieval',
        formatterSkill: 'scifork-research',
        generatedAt: '2026-08-30T00:00:00.000Z',
      },
      evidenceCandidates: [{
        publicationRef: { pmid: '12345678' },
        assertion: 'The retrieved study reports the prespecified observation.',
        locator: { kind: 'pubmed_abstract' },
        direction: 'supports',
        citation: { title: 'Imported source article', journal: 'Example Journal', year: 2025 },
        machineReviewRationale: 'Identity, locator, entailment, direction, and limitations checked.',
        limitations: ['observational design'],
      }],
    }
    const validated = validateImportDraft(draft)
    expect(validated.ok).toBe(true)
    const planned = planCommand(emptyProject, {
      kind: 'import_draft_item',
      id: evidenceId,
      index: 0,
      draft,
    }, hash)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.path).toBe(`evidence/${evidenceId}.md`)
    expect(planned.content).toContain('review_status: machine_reviewed')
    expect(planned.content).toContain("pmid: '12345678'")
    expect(planned.content).not.toContain('review_status: reviewed')
  })

  it('keeps an identifier-free PDF candidate in the Draft but refuses persistence', () => {
    const draft = {
      schemaVersion: 1,
      producer: {
        retrievalSkill: 'pdf-parser',
        formatterSkill: 'scifork-research',
        generatedAt: '2026-08-30T00:00:00.000Z',
      },
      evidenceCandidates: [{
        assertion: 'A claim extracted from a local PDF.',
        locator: { kind: 'pdf', page: 4 },
        direction: 'context',
      }],
    }
    const validated = validateImportDraft(draft)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(validated.value.assessments[0]?.importable).toBe(false)
    const planned = planCommand(emptyProject, {
      kind: 'import_draft_item',
      id: evidenceId,
      index: 0,
      draft,
    }, hash)
    expect(planned.ok).toBe(false)
    if (planned.ok) return
    expect(planned.issues[0]?.code).toBe('INVALID_IMPORT_DRAFT')
  })

  it('ships the helper and security policy in the package source tree', () => {
    expect(readFileSync(join(process.cwd(), 'skills', 'pubmed-search', 'helper.mjs'), 'utf8')).toContain('NCBI_API_KEY')
    expect(readFileSync(join(process.cwd(), 'SECURITY.md'), 'utf8')).toContain('127.0.0.1')
  })
})
