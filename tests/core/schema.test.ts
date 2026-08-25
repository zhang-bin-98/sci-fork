import { describe, expect, it } from 'vitest'
import {
  ASSERTION_MAX,
  BODY_MAX,
  EVIDENCE_REFS_MAX,
  LIMITATION_MAX,
  LIMITATIONS_MAX,
  MANIFEST_FILE,
  MANAGED_PATHS,
  MANIFEST_NAME_MAX,
  PROVENANCE_MAX,
  LOCATOR_SECTION_MAX,
  entityFilePath,
  entityTypeOfId,
  isValidManagedFileName,
  normalizeDoi,
  normalizePmid,
  parseManifest,
  parseEdgeFile,
  parseEvidenceData,
  parseNodeData,
  parseResultData,
  parsePublicationReference,
  validPmid,
} from '../../src/core/schema.js'

const UUID = '01234567-89ab-4cde-8f01-23456789abcd'
const EV = `ev_${UUID}`
const NODE = `node_${UUID}`
const RES = `res_${UUID}`

describe('manifest', () => {
  it('accepts a valid manifest', () => {
    const parsed = parseManifest(JSON.stringify({
      schema_version: 1,
      project_id: UUID,
      name: 'My Research',
    }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value).toEqual({
        schema_version: 1,
        project_id: UUID,
        name: 'My Research',
      })
    }
  })

  it('rejects an unsupported schema version', () => {
    const parsed = parseManifest(JSON.stringify({
      schema_version: 2,
      project_id: UUID,
      name: 'x',
    }))
    expect(parsed.ok).toBe(false)
  })

  it('rejects unknown manifest keys', () => {
    const parsed = parseManifest(JSON.stringify({
      schema_version: 1,
      project_id: UUID,
      name: 'x',
      extra: true,
    }))
    expect(parsed.ok).toBe(false)
  })

  it('rejects an empty or oversized name', () => {
    expect(parseManifest(JSON.stringify({
      schema_version: 1, project_id: UUID, name: '',
    })).ok).toBe(false)
    expect(parseManifest(JSON.stringify({
      schema_version: 1, project_id: UUID, name: 'n'.repeat(MANIFEST_NAME_MAX + 1),
    })).ok).toBe(false)
  })

  it('rejects a malformed project id', () => {
    expect(parseManifest(JSON.stringify({
      schema_version: 1, project_id: 'not-a-uuid', name: 'x',
    })).ok).toBe(false)
  })
})

describe('publication reference', () => {
  it('normalizes PMIDs and DOIs', () => {
    expect(normalizePmid('  12345678 ')).toBe('12345678')
    expect(normalizePmid('abc')).toBeUndefined()
    expect(normalizePmid('01234567')).toBeUndefined()
    expect(normalizePmid('123456789')).toBeUndefined()
    expect(validPmid('12345678')).toBe(true)
    expect(validPmid('123456789')).toBe(false)

    expect(normalizeDoi('10.1000/ABC-123')).toBe('10.1000/ABC-123')
    expect(normalizeDoi('https://doi.org/10.1000/xyz')).toBe('10.1000/xyz')
    expect(normalizeDoi('doi:10.1000/xyz')).toBe('10.1000/xyz')
    expect(normalizeDoi('  http://dx.doi.org/10.1000/abc ')).toBe('10.1000/abc')
    expect(normalizeDoi('10.1000/ABC')).toBe('10.1000/ABC')
    expect(normalizeDoi('not-a-doi')).toBeUndefined()
    expect(normalizeDoi('10./suffix')).toBeUndefined()
    expect(normalizeDoi('10.1000/')).toBeUndefined()
  })

  it('accepts a reference with only a PMID or only a DOI', () => {
    const pmidOnly = parsePublicationReference({ pmid: '12345678' })
    expect(pmidOnly.ok).toBe(true)
    const doiOnly = parsePublicationReference({ doi: '10.1000/abc' })
    expect(doiOnly.ok).toBe(true)
  })

  it('rejects a reference with no identifiers or unknown keys', () => {
    expect(parsePublicationReference({}).ok).toBe(false)
    expect(parsePublicationReference({ pmid: '12345678', x: 1 }).ok).toBe(false)
    expect(parsePublicationReference({ pmid: 'abc' }).ok).toBe(false)
  })
})

describe('locator', () => {
  it('accepts pubmed_abstract and pdf locators', () => {
    const data = {
      id: EV,
      publication_ref: { pmid: '12345678' },
      assertion: 'a',
      direction: 'supports',
      review_status: 'candidate',
    }
    expect(parseEvidenceData({ ...data, locator: { kind: 'pubmed_abstract' } }).ok).toBe(true)
    expect(parseEvidenceData({ ...data, locator: { kind: 'pdf', page: 3 } }).ok).toBe(true)
    expect(parseEvidenceData({ ...data, locator: { kind: 'pdf', section: 'Results' } }).ok).toBe(true)
    expect(parseEvidenceData({ ...data, locator: { kind: 'pdf', page: 3, section: 'Results' } }).ok).toBe(true)
  })

  it('rejects a pdf locator without page or section, and out-of-range values', () => {
    const data = {
      id: EV,
      publication_ref: { pmid: '12345678' },
      assertion: 'a',
      direction: 'supports',
      review_status: 'candidate',
    }
    expect(parseEvidenceData({ ...data, locator: { kind: 'pdf' } }).ok).toBe(false)
    expect(parseEvidenceData({ ...data, locator: { kind: 'pdf', page: 0 } }).ok).toBe(false)
    expect(parseEvidenceData({
      ...data, locator: { kind: 'pdf', section: 's'.repeat(LOCATOR_SECTION_MAX + 1) },
    }).ok).toBe(false)
    expect(parseEvidenceData({ ...data, locator: { kind: 'pdf', page: 1, extra: true } }).ok).toBe(false)
    expect(parseEvidenceData({ ...data, locator: { kind: 'other' } }).ok).toBe(false)
  })
})

describe('evidence assertion data', () => {
  const base = {
    id: EV,
    publication_ref: { pmid: '12345678' },
    locator: { kind: 'pubmed_abstract' as const },
    assertion: 'STAT3 is phosphorylated.',
    direction: 'supports' as const,
    review_status: 'candidate' as const,
  }

  it('accepts a full valid record', () => {
    expect(parseEvidenceData(base).ok).toBe(true)
    expect(parseEvidenceData({
      ...base,
      limitations: ['in vitro only'],
      publication_ref: { pmid: '12345678', doi: '10.1000/abc' },
    }).ok).toBe(true)
  })

  it('rejects empty assertion, bad direction, and bad review status', () => {
    expect(parseEvidenceData({ ...base, assertion: '' }).ok).toBe(false)
    expect(parseEvidenceData({
      ...base, assertion: 'a'.repeat(ASSERTION_MAX + 1),
    }).ok).toBe(false)
    expect(parseEvidenceData({ ...base, direction: 'other' }).ok).toBe(false)
    expect(parseEvidenceData({ ...base, review_status: 'accepted' }).ok).toBe(false)
  })

  it('rejects limitation lists beyond the caps', () => {
    expect(parseEvidenceData({
      ...base, limitations: Array.from({ length: LIMITATIONS_MAX + 1 }, (_, i) => `l${i}`),
    }).ok).toBe(false)
    expect(parseEvidenceData({
      ...base, limitations: ['x'.repeat(LIMITATION_MAX + 1)],
    }).ok).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(parseEvidenceData({ ...base, status: 'reviewed' }).ok).toBe(false)
  })

  it('rejects a malformed evidence id', () => {
    expect(parseEvidenceData({ ...base, id: 'ev_123' }).ok).toBe(false)
    expect(parseEvidenceData({ ...base, id: NODE }).ok).toBe(false)
  })
})

describe('node data', () => {
  const base = {
    id: NODE,
    kind: 'hypothesis' as const,
    confidence: 'moderate' as const,
  }

  it('accepts all three kinds and optional evidence refs', () => {
    expect(parseNodeData(base).ok).toBe(true)
    expect(parseNodeData({ ...base, kind: 'finding' }).ok).toBe(true)
    expect(parseNodeData({ ...base, kind: 'prediction' }).ok).toBe(true)
    expect(parseNodeData({
      ...base, evidence_refs: [{ id: EV, role: 'supports' }],
    }).ok).toBe(true)
  })

  it('rejects the removed status field and unknown keys', () => {
    expect(parseNodeData({ ...base, status: 'plausible' }).ok).toBe(false)
    expect(parseNodeData({ ...base, extra: 1 }).ok).toBe(false)
  })

  it('rejects invalid confidence, kind, and evidence role', () => {
    expect(parseNodeData({ ...base, confidence: 'certain' }).ok).toBe(false)
    expect(parseNodeData({ ...base, kind: 'claim' }).ok).toBe(false)
    expect(parseNodeData({
      ...base, evidence_refs: [{ id: EV, role: 'context' }],
    }).ok).toBe(false)
    expect(parseNodeData({
      ...base, evidence_refs: [{ id: 'not-evidence', role: 'supports' }],
    }).ok).toBe(false)
  })

  it('rejects duplicate evidence refs and lists beyond the cap', () => {
    expect(parseNodeData({
      ...base,
      evidence_refs: [
        { id: EV, role: 'supports' },
        { id: EV, role: 'supports' },
      ],
    }).ok).toBe(false)
    expect(parseNodeData({
      ...base,
      evidence_refs: Array.from(
        { length: EVIDENCE_REFS_MAX + 1 },
        (_, i) => ({ id: `ev_00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, role: 'supports' as const }),
      ),
    }).ok).toBe(false)
  })
})

describe('edge data', () => {
  const base = {
    id: `edge_${UUID}`,
    from: RES,
    to: NODE,
    relation: 'supports' as const,
    basis: 'experiment' as const,
  }

  it('accepts experiment edges without evidence refs', () => {
    expect(parseEdgeFile(JSON.stringify(base)).ok).toBe(true)
  })

  it('requires evidence refs for literature basis', () => {
    expect(parseEdgeFile(JSON.stringify({ ...base, basis: 'literature' })).ok).toBe(false)
    expect(parseEdgeFile(JSON.stringify({
      ...base,
      basis: 'literature',
      evidence_refs: [{ id: EV, role: 'supports' }],
    })).ok).toBe(true)
  })

  it('requires provenance and evidence gap for ai_inference basis', () => {
    expect(parseEdgeFile(JSON.stringify({ ...base, basis: 'ai_inference' })).ok).toBe(false)
    expect(parseEdgeFile(JSON.stringify({
      ...base, basis: 'ai_inference', provenance: 'model x',
    })).ok).toBe(false)
    expect(parseEdgeFile(JSON.stringify({
      ...base,
      basis: 'ai_inference',
      provenance: 'model x',
      evidence_gap: 'no direct measurement',
    })).ok).toBe(true)
  })

  it('rejects self edges, malformed endpoints, and unknown keys', () => {
    expect(parseEdgeFile(JSON.stringify({ ...base, from: NODE, to: NODE })).ok).toBe(false)
    expect(parseEdgeFile(JSON.stringify({ ...base, from: 'x_1' })).ok).toBe(false)
    expect(parseEdgeFile(JSON.stringify({ ...base, to: 'y_1' })).ok).toBe(false)
    expect(parseEdgeFile(JSON.stringify({ ...base, relation: 'inhibits' })).ok).toBe(false)
    expect(parseEdgeFile(JSON.stringify({ ...base, extra: true })).ok).toBe(false)
    expect(parseEdgeFile(JSON.stringify({
      ...base, provenance: 'x'.repeat(PROVENANCE_MAX + 1),
    })).ok).toBe(false)
  })
})

describe('result data', () => {
  const base = {
    id: RES,
    status: 'validated' as const,
    observed_at: '2026-08-24',
  }

  it('accepts all three statuses and a valid date', () => {
    expect(parseResultData(base).ok).toBe(true)
    expect(parseResultData({ ...base, status: 'draft' }).ok).toBe(true)
    expect(parseResultData({ ...base, status: 'superseded' }).ok).toBe(true)
  })

  it('rejects invalid status, date, and unknown keys', () => {
    expect(parseResultData({ ...base, status: 'accepted' }).ok).toBe(false)
    expect(parseResultData({ ...base, observed_at: '24.08.2026' }).ok).toBe(false)
    expect(parseResultData({ ...base, observed_at: '2026-8-24' }).ok).toBe(false)
    expect(parseResultData({ ...base, extra: 1 }).ok).toBe(false)
    expect(parseResultData({ ...base, observed_at: '2026-02-31' }).ok).toBe(false)
  })
})

describe('identifiers and file names', () => {
  it('maps ids to entity types and file paths', () => {
    expect(entityTypeOfId(NODE)).toBe('node')
    expect(entityTypeOfId(EV)).toBe('evidence')
    expect(entityTypeOfId(RES)).toBe('result')
    expect(entityTypeOfId(`edge_${UUID}`)).toBe('edge')
    expect(entityTypeOfId('other_1')).toBeUndefined()

    expect(entityFilePath(NODE)).toBe(`nodes/${NODE}.md`)
    expect(entityFilePath(EV)).toBe(`evidence/${EV}.md`)
    expect(entityFilePath(RES)).toBe(`results/${RES}.md`)
    expect(entityFilePath(`edge_${UUID}`)).toBe(`edges/edge_${UUID}.json`)
    expect(entityFilePath('other_1')).toBeUndefined()
  })

  it('validates managed file names strictly', () => {
    expect(isValidManagedFileName(`${NODE}.md`)).toBe(true)
    expect(isValidManagedFileName(`${EV}.md`)).toBe(true)
    expect(isValidManagedFileName(`${RES}.md`)).toBe(true)
    expect(isValidManagedFileName(`edge_${UUID}.json`)).toBe(true)
    expect(isValidManagedFileName('readme.md')).toBe(false)
    expect(isValidManagedFileName(`${NODE}.json`)).toBe(false)
    expect(isValidManagedFileName(`edge_${UUID}.md`)).toBe(false)
    expect(isValidManagedFileName(`${NODE.toUpperCase()}.md`)).toBe(false)
    expect(isValidManagedFileName(`node_${UUID}.txt`)).toBe(false)
  })

  it('exposes the manifest file name and managed paths', () => {
    expect(MANIFEST_FILE).toBe('research.json')
    expect(MANAGED_PATHS).toEqual(['research.json', 'nodes', 'edges', 'evidence', 'results'])
  })
})

describe('body limits', () => {
  it('defines a bounded entity body size', () => {
    expect(BODY_MAX).toBe(64 * 1024)
  })
})
