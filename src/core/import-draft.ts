import { z } from 'zod'
import {
  ASSERTION_MAX,
  LIMITATION_MAX,
  LIMITATIONS_MAX,
  LOCATOR_SCHEMA,
  normalizeDoi,
  normalizePmid,
  utf8ByteLength,
  type PublicationReference,
} from './schema.js'

/**
 * Research Import Draft (architecture §6.2, product design §9): a transient
 * untrusted package of Evidence Candidates produced outside SciFork's
 * persistence boundary. The draft itself is never written to the Research
 * Project; only individually selected, importable candidates become
 * single-entity commands.
 */

export const MAX_IMPORT_DRAFT_BYTES = 256 * 1024
export const MAX_IMPORT_CANDIDATES = 50

const ISO_TIMESTAMP_SCHEMA = z.string().datetime({ offset: true })

export const EVIDENCE_CANDIDATE_SCHEMA = z
  .object({
    publicationRef: z
      .object({
        pmid: z.string().optional(),
        doi: z.string().optional(),
      })
      .strict()
      .optional(),
    assertion: z.string().min(1).max(ASSERTION_MAX),
    locator: LOCATOR_SCHEMA,
    direction: z.enum(['supports', 'contradicts', 'context']),
    limitations: z
      .array(z.string().min(1).max(LIMITATION_MAX))
      .max(LIMITATIONS_MAX)
      .optional(),
  })
  .strict()
export type EvidenceCandidate = z.infer<typeof EVIDENCE_CANDIDATE_SCHEMA>

export const RESEARCH_IMPORT_DRAFT_SCHEMA = z
  .object({
    schemaVersion: z.literal(1),
    producer: z
      .object({
        retrievalSkill: z.string().min(1).max(100),
        formatterSkill: z.literal('scifork-research'),
        generatedAt: ISO_TIMESTAMP_SCHEMA,
      })
      .strict(),
    evidenceCandidates: z.array(EVIDENCE_CANDIDATE_SCHEMA).max(MAX_IMPORT_CANDIDATES),
    warnings: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type ResearchImportDraft = z.infer<typeof RESEARCH_IMPORT_DRAFT_SCHEMA>

export interface ImportDraftIssue {
  path: string
  code: string
  message: string
}

/**
 * Per-candidate persistence admission: a candidate is importable only with a
 * valid PMID or normalized DOI. Both present → the PMID is canonical, the DOI
 * is an alias, and the caller must have the user confirm they name the same
 * publication (offline validation cannot verify identity consistency).
 */
export interface CandidateAssessment {
  importable: boolean
  publicationRef?: PublicationReference
  reasons: string[]
  warnings: string[]
}

export function assessCandidate(candidate: EvidenceCandidate): CandidateAssessment {
  const reasons: string[] = []
  const warnings: string[] = []
  const raw = candidate.publicationRef
  const pmid = raw?.pmid !== undefined ? normalizePmid(raw.pmid) : undefined
  const doi = raw?.doi !== undefined ? normalizeDoi(raw.doi) : undefined
  if (raw?.pmid !== undefined && pmid === undefined) {
    reasons.push('pmid is not a valid PMID')
  }
  if (raw?.doi !== undefined && doi === undefined) {
    reasons.push('doi is not a valid normalized DOI')
  }
  if (pmid === undefined && doi === undefined) {
    reasons.push('a valid PMID or DOI is required before this candidate can be persisted')
  }
  if (pmid !== undefined && doi !== undefined) {
    warnings.push('PMID_DOI_CONSISTENCY_UNVERIFIED')
  }
  if (reasons.length > 0) {
    return { importable: false, reasons, warnings }
  }
  const publicationRef: PublicationReference = {
    ...(pmid !== undefined ? { pmid } : {}),
    ...(doi !== undefined ? { doi } : {}),
  }
  return { importable: true, publicationRef, reasons: [], warnings }
}

export interface ValidatedImportDraft {
  draft: ResearchImportDraft
  serializedBytes: number
  assessments: CandidateAssessment[]
  issues: ImportDraftIssue[]
}

export type ImportDraftResult =
  | { ok: true; value: ValidatedImportDraft }
  | { ok: false; issues: ImportDraftIssue[] }

/**
 * Validate an untrusted draft end to end: schema, size cap, and per-candidate
 * admission. Total: never throws; invalid drafts report issues instead.
 */
export function validateImportDraft(raw: unknown): ImportDraftResult {
  const parsed = RESEARCH_IMPORT_DRAFT_SCHEMA.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: 'INVALID_SCHEMA',
        message: issue.message,
      })),
    }
  }
  const draft = parsed.data
  const serializedBytes = utf8ByteLength(JSON.stringify(draft))
  if (serializedBytes > MAX_IMPORT_DRAFT_BYTES) {
    return {
      ok: false,
      issues: [{
        path: '',
        code: 'DRAFT_TOO_LARGE',
        message: `draft serializes to ${serializedBytes} bytes; the cap is ${MAX_IMPORT_DRAFT_BYTES}`,
      }],
    }
  }
  return {
    ok: true,
    value: {
      draft,
      serializedBytes,
      assessments: draft.evidenceCandidates.map(assessCandidate),
      issues: [],
    },
  }
}
