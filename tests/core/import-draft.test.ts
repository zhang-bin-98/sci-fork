import { describe, expect, it } from 'vitest'
import {
  MAX_IMPORT_CANDIDATES,
  assessCandidate,
  validateImportDraft,
} from '../../src/core/import-draft.js'

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    producer: {
      retrievalSkill: 'pubmed-search',
      formatterSkill: 'scifork-research',
      generatedAt: '2026-08-24T10:00:00.000Z',
    },
    evidenceCandidates: [
      {
        publicationRef: { pmid: '12345678' },
        assertion: 'STAT3 is phosphorylated.',
        locator: { kind: 'pubmed_abstract' },
        direction: 'supports',
        citation: { title: 'STAT3 signaling study', journal: 'Example Journal', year: 2025 },
        machineReviewRationale: 'Identity, locator, entailment, direction, and limitations checked.',
        limitations: ['in vitro'],
      },
    ],
    ...overrides,
  }
}

describe('validateImportDraft', () => {
  it('accepts a valid draft and marks its candidates importable', () => {
    const result = validateImportDraft(draft())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.assessments).toHaveLength(1)
    expect(result.value.assessments[0]).toMatchObject({ importable: true })
    expect(result.value.assessments[0]?.publicationRef).toEqual({ pmid: '12345678' })
    expect(result.value.issues).toEqual([])
  })

  it('normalizes DOIs in candidate references', () => {
    const result = validateImportDraft(draft({
      evidenceCandidates: [{
        publicationRef: { doi: 'https://doi.org/10.1000/XYZ-9' },
        assertion: 'Claim.',
        locator: { kind: 'pubmed_abstract' },
        direction: 'context',
        citation: { title: 'DOI source article' },
        machineReviewRationale: 'Identity, locator, entailment, direction, and limitations checked.',
      }],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.assessments[0]?.publicationRef).toEqual({ doi: '10.1000/XYZ-9' })
  })

  it('warns when PMID/DOI consistency remains unresolved', () => {
    const result = validateImportDraft(draft({
      evidenceCandidates: [{
        publicationRef: { pmid: '12345678', doi: '10.1000/abc' },
        assertion: 'Claim.',
        locator: { kind: 'pubmed_abstract' },
        direction: 'supports',
      }],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.assessments[0]?.warnings).toContain('PMID_DOI_CONSISTENCY_UNVERIFIED')
  })

  it('keeps candidates without identifiers schema-valid but not importable', () => {
    const result = validateImportDraft(draft({
      evidenceCandidates: [{
        assertion: 'PDF content claim.',
        locator: { kind: 'pdf', page: 3 },
        direction: 'supports',
      }],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.assessments[0]?.importable).toBe(false)
    expect(result.value.assessments[0]?.reasons.length).toBeGreaterThan(0)
  })

  it('keeps candidates with invalid identifiers not importable', () => {
    const result = validateImportDraft(draft({
      evidenceCandidates: [{
        publicationRef: { pmid: 'not-a-pmid' },
        assertion: 'Claim.',
        locator: { kind: 'pubmed_abstract' },
        direction: 'supports',
      }],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.assessments[0]?.importable).toBe(false)
  })

  it('rejects a wrong formatter skill', () => {
    const result = validateImportDraft(draft({
      producer: {
        retrievalSkill: 'pubmed-search',
        formatterSkill: 'other-formatter',
        generatedAt: '2026-08-24T10:00:00.000Z',
      },
    }))
    expect(result.ok).toBe(false)
  })

  it('rejects an unparseable generatedAt timestamp', () => {
    const result = validateImportDraft(draft({
      producer: {
        retrievalSkill: 'pubmed-search',
        formatterSkill: 'scifork-research',
        generatedAt: 'yesterday',
      },
    }))
    expect(result.ok).toBe(false)
  })

  it('rejects non-ISO and impossible generatedAt timestamps', () => {
    for (const generatedAt of ['2026/08/24', '2026-02-30T10:00:00Z']) {
      const result = validateImportDraft(draft({
        producer: {
          retrievalSkill: 'pubmed-search',
          formatterSkill: 'scifork-research',
          generatedAt,
        },
      }))
      expect(result.ok).toBe(false)
    }
  })

  it('rejects candidate counts above the cap', () => {
    const candidates = Array.from({ length: MAX_IMPORT_CANDIDATES + 1 }, (_, i) => ({
      publicationRef: { pmid: String(10000000 + i) },
      assertion: `Claim ${i}.`,
      locator: { kind: 'pubmed_abstract' },
      direction: 'supports',
    }))
    expect(validateImportDraft(draft({ evidenceCandidates: candidates })).ok).toBe(false)
  })

  it('rejects drafts whose serialized form exceeds the byte cap', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      publicationRef: { pmid: String(10000000 + i) },
      assertion: `Claim ${i}. `.padEnd(4000, 'x'),
      locator: { kind: 'pubmed_abstract' },
      direction: 'supports',
      limitations: Array.from({ length: 20 }, (_, j) => `limitation ${j}`.padEnd(500, 'y')),
    }))
    const result = validateImportDraft(draft({ evidenceCandidates: candidates }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'DRAFT_TOO_LARGE')).toBe(true)
    }
  })

  it('rejects unknown keys anywhere in the draft', () => {
    const withReviewStatus = draft({
      evidenceCandidates: [{
        publicationRef: { pmid: '12345678' },
        assertion: 'Claim.',
        locator: { kind: 'pubmed_abstract' },
        direction: 'supports',
        review_status: 'reviewed',
      }],
    })
    expect(validateImportDraft(withReviewStatus).ok).toBe(false)
    expect(validateImportDraft(draft({ extraField: true })).ok).toBe(false)
  })

  it('rejects a pdf locator without page or section', () => {
    const result = validateImportDraft(draft({
      evidenceCandidates: [{
        publicationRef: { pmid: '12345678' },
        assertion: 'Claim.',
        locator: { kind: 'pdf' },
        direction: 'supports',
      }],
    }))
    expect(result.ok).toBe(false)
  })

  it('rejects an empty or oversized assertion', () => {
    expect(validateImportDraft(draft({
      evidenceCandidates: [{
        publicationRef: { pmid: '12345678' },
        assertion: '',
        locator: { kind: 'pubmed_abstract' },
        direction: 'supports',
      }],
    })).ok).toBe(false)
  })

  it('passes draft warnings through', () => {
    const result = validateImportDraft(draft({ warnings: ['abstract truncated'] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.draft.warnings).toEqual(['abstract truncated'])
  })
})

describe('assessCandidate', () => {
  it('rejects candidates whose publication ref has only invalid identifiers', () => {
    const assessment = assessCandidate({
      publicationRef: { pmid: '01234567' },
      assertion: 'Claim.',
      locator: { kind: 'pubmed_abstract' },
      direction: 'supports',
    })
    expect(assessment.importable).toBe(false)
    expect(assessment.reasons.length).toBeGreaterThan(0)
  })
})
