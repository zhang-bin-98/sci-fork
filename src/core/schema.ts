import { z } from 'zod'
import { publicationReferencesHaveOverlap } from './publication-references.js'

/**
 * Core schema layer: the exact on-disk Research Project formats from
 * docs/specs/m1-core-git.md. Pure TypeScript — no Node, DSH, Git, or browser
 * APIs. All parsers are total: they return a ParseResult and never throw on
 * untrusted input.
 */

// ---------------------------------------------------------------- constants

export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const NODE_ID_RE = /^node_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const EDGE_ID_RE = /^edge_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const EVIDENCE_ID_RE = /^ev_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const RESULT_ID_RE = /^res_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const QUESTION_ID_RE = /^question_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const FRAMING_LINK_ID_RE = /^qlink_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Endpoint ids: any node or result id. */
export const ENDPOINT_ID_RE = /^(?:node|res)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const PMID_REGEX = /^[1-9][0-9]{0,7}$/
export const DOI_REGEX = /^10\.\d{4,9}\/.+$/

export const MANIFEST_FILE = 'research.json'
/** The only paths SciFork ever stages or commits (architecture §11.2). */
export const MANAGED_PATHS = [
  'research.json',
  'questions',
  'question-links',
  'nodes',
  'edges',
  'evidence',
  'results',
] as const

export const MANIFEST_NAME_MAX = 200
export const ASSERTION_MAX = 4000
export const LIMITATIONS_MAX = 20
export const LIMITATION_MAX = 500
export const EVIDENCE_REFS_MAX = 50
export const PUBLICATION_REFS_MAX = 50
export const LOCATOR_SECTION_MAX = 500
export const LOCATOR_PAGE_MAX = 99999
export const PROVENANCE_MAX = 2000
export const QUESTION_MAX = 4000
export const CITATION_TITLE_MAX = 1000
export const CITATION_JOURNAL_MAX = 500
export const MACHINE_REVIEW_RATIONALE_MAX = 4000
export const BODY_MAX = 64 * 1024
export const OBSERVED_AT_RE = /^\d{4}-\d{2}-\d{2}$/

/** Count UTF-8 bytes without depending on a host-specific TextEncoder. */
export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

function isCalendarDate(value: string): boolean {
  if (!OBSERVED_AT_RE.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]!
}

export const OBSERVED_AT_SCHEMA = z.string().refine(isCalendarDate, 'must be a real YYYY-MM-DD calendar date')
export const BODY_SCHEMA = z.string().refine((value) => utf8ByteLength(value) <= BODY_MAX, `must be at most ${BODY_MAX} UTF-8 bytes`)
export const NON_EMPTY_BODY_SCHEMA = BODY_SCHEMA.refine((value) => value.trim().length > 0, 'must not be empty')

// ------------------------------------------------------------------- types

export type NodeKind = 'finding' | 'hypothesis' | 'prediction'
export type ConfidenceBand = 'low' | 'moderate' | 'high'
export type EvidenceReview = 'machine_reviewed' | 'reviewed' | 'rejected'
export type ResultStatus = 'draft' | 'validated' | 'superseded'
export type Relation = 'supports' | 'contradicts' | 'causes' | 'associated_with' | 'predicts'
export type EdgeBasis = 'literature' | 'experiment' | 'ai_inference'
export type EvidenceDirection = 'supports' | 'contradicts' | 'context'
/** Node/edge evidence references only accept supporting or contradicting roles. */
export type EvidenceRole = 'supports' | 'contradicts'
export type FramingRelation = 'frames'

// -------------------------------------------------------------- parse result

export interface ParseFailure {
  ok: false
  issues: string[]
}
export interface ParseSuccess<T> {
  ok: true
  value: T
}
export type ParseResult<T> = ParseSuccess<T> | ParseFailure

interface ZodSafeOutcome<T> {
  success: true
  data: T
}

export function resultOf<T>(
  outcome: ZodSafeOutcome<T> | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
): ParseResult<T> {
  if (outcome.success) return { ok: true, value: outcome.data }
  return {
    ok: false,
    issues: outcome.error.issues.map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    ),
  }
}

// -------------------------------------------------------------- identifiers

/**
 * Normalize a PMID: trim and require 1-8 digits without a leading zero.
 * Returns undefined for anything else.
 */
export function normalizePmid(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return PMID_REGEX.test(trimmed) ? trimmed : undefined
}

export function validPmid(raw: unknown): boolean {
  return normalizePmid(raw) !== undefined
}

/**
 * Normalize a DOI: trim, strip `doi:`/`https://doi.org/` prefixes, lowercase
 * the case-insensitive directory indicator (`10.xxxx`), and preserve the
 * suffix verbatim. Returns undefined when the result is not a plausible DOI.
 */
export function normalizeDoi(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  const bare = trimmed.replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '')
  const slash = bare.indexOf('/')
  if (slash === -1) return undefined
  const directory = bare.slice(0, slash)
  const suffix = bare.slice(slash + 1)
  if (!/^10\.\d{4,9}$/i.test(directory) || suffix.length === 0) return undefined
  return `${directory.toLowerCase()}/${suffix}`
}

// ------------------------------------------------------------------ schemas

const UUID_SCHEMA = z.string().regex(UUID_RE, 'must be a lowercase uuid')

export const PUBLICATION_REFERENCE_SCHEMA = z
  .object({
    pmid: z.string().regex(PMID_REGEX, 'pmid must be 1-8 digits without a leading zero').optional(),
    doi: z.string().regex(DOI_REGEX, 'doi must be a normalized 10.<registrant>/<suffix> identifier').optional(),
  })
  .strict()
  .refine((ref) => ref.pmid !== undefined || ref.doi !== undefined, {
    message: 'publication_ref requires a pmid or a doi',
  })
export type PublicationReference = z.infer<typeof PUBLICATION_REFERENCE_SCHEMA>

export const PUBLICATION_REFERENCES_SCHEMA = z
  .array(PUBLICATION_REFERENCE_SCHEMA)
  .min(1)
  .max(PUBLICATION_REFS_MAX)
  .refine((references) => !publicationReferencesHaveOverlap(references), {
    message: 'publication_refs must not repeat a PMID or DOI',
  })

export const LOCATOR_SCHEMA = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pubmed_abstract') }).strict(),
  z
    .object({
      kind: z.literal('pdf'),
      page: z.number().int().min(1).max(LOCATOR_PAGE_MAX).optional(),
      section: z.string().min(1).max(LOCATOR_SECTION_MAX).optional(),
    })
    .strict()
    .refine((locator) => locator.page !== undefined || locator.section !== undefined, {
      message: 'pdf locator requires a page or a section',
    }),
])
export type Locator = z.infer<typeof LOCATOR_SCHEMA>

export const CITATION_SNAPSHOT_SCHEMA = z
  .object({
    title: z.string().min(1).max(CITATION_TITLE_MAX),
    journal: z.string().min(1).max(CITATION_JOURNAL_MAX).optional(),
    year: z.number().int().min(1000).max(9999).optional(),
  })
  .strict()
export type CitationSnapshot = z.infer<typeof CITATION_SNAPSHOT_SCHEMA>

const EVIDENCE_REF_SCHEMA = z
  .object({
    id: z.string().regex(EVIDENCE_ID_RE, 'must be an ev_<uuid> id'),
    role: z.enum(['supports', 'contradicts']),
  })
  .strict()
export type EvidenceRef = z.infer<typeof EVIDENCE_REF_SCHEMA>

export const EVIDENCE_DATA_SCHEMA = z
  .object({
    id: z.string().regex(EVIDENCE_ID_RE, 'must be an ev_<uuid> id'),
    publication_ref: PUBLICATION_REFERENCE_SCHEMA,
    locator: LOCATOR_SCHEMA,
    assertion: z.string().min(1).max(ASSERTION_MAX),
    direction: z.enum(['supports', 'contradicts', 'context']),
    review_status: z.enum(['machine_reviewed', 'reviewed', 'rejected']),
    citation: CITATION_SNAPSHOT_SCHEMA.optional(),
    machine_review_rationale: z.string().min(1).max(MACHINE_REVIEW_RATIONALE_MAX).optional(),
    limitations: z
      .array(z.string().min(1).max(LIMITATION_MAX))
      .max(LIMITATIONS_MAX)
      .optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.review_status !== 'machine_reviewed') return
    if (evidence.citation === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['citation'],
        message: 'machine_reviewed evidence requires a citation snapshot',
      })
    }
    if (evidence.machine_review_rationale === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['machine_review_rationale'],
        message: 'machine_reviewed evidence requires a machine-review rationale',
      })
    }
  })
export type EvidenceData = z.infer<typeof EVIDENCE_DATA_SCHEMA>

export const QUESTION_DATA_SCHEMA = z
  .object({
    id: z.string().regex(QUESTION_ID_RE, 'must be a question_<uuid> id'),
    question: z.string().min(1).max(QUESTION_MAX),
    scope_assumptions: z
      .array(z.string().min(1).max(LIMITATION_MAX))
      .max(LIMITATIONS_MAX)
      .optional(),
  })
  .strict()
export type QuestionData = z.infer<typeof QUESTION_DATA_SCHEMA>

export const FRAMING_LINK_FILE_SCHEMA = z
  .object({
    id: z.string().regex(FRAMING_LINK_ID_RE, 'must be a qlink_<uuid> id'),
    from: z.string().regex(QUESTION_ID_RE, 'must be a question_<uuid> id'),
    to: z.string().regex(NODE_ID_RE, 'must be a node_<uuid> id'),
    relation: z.literal('frames'),
  })
  .strict()
export type FramingLinkFile = z.infer<typeof FRAMING_LINK_FILE_SCHEMA>

export const NODE_DATA_SCHEMA = z
  .object({
    id: z.string().regex(NODE_ID_RE, 'must be a node_<uuid> id'),
    kind: z.enum(['finding', 'hypothesis', 'prediction']),
    confidence: z.enum(['low', 'moderate', 'high']),
    evidence_refs: z.array(EVIDENCE_REF_SCHEMA).max(EVIDENCE_REFS_MAX).optional(),
  })
  .strict()
  .refine((node) => {
    const refs = node.evidence_refs ?? []
    return new Set(refs.map((ref) => ref.id)).size === refs.length
  }, 'evidence_refs must not repeat an evidence id')
export type NodeData = z.infer<typeof NODE_DATA_SCHEMA>

const EDGE_COMMON = {
  id: z.string().regex(EDGE_ID_RE, 'must be an edge_<uuid> id'),
  from: z.string().regex(ENDPOINT_ID_RE, 'must be a node_ or res_ id'),
  to: z.string().regex(ENDPOINT_ID_RE, 'must be a node_ or res_ id'),
  relation: z.enum(['supports', 'contradicts', 'causes', 'associated_with', 'predicts']),
  evidence_refs: z.array(EVIDENCE_REF_SCHEMA).max(EVIDENCE_REFS_MAX).optional(),
}

export const EDGE_FILE_SCHEMA = z
  .discriminatedUnion('basis', [
    z
      .object({
        ...EDGE_COMMON,
        basis: z.literal('literature'),
      })
      .strict()
      .refine(
        (edge) => (edge.evidence_refs?.length ?? 0) > 0,
        'literature edges require at least one evidence_ref',
      ),
    z
      .object({
        ...EDGE_COMMON,
        basis: z.literal('experiment'),
      })
      .strict(),
    z
      .object({
        ...EDGE_COMMON,
        basis: z.literal('ai_inference'),
        publication_refs: PUBLICATION_REFERENCES_SCHEMA,
        provenance: z.string().min(1).max(PROVENANCE_MAX),
        evidence_gap: z.string().min(1).max(PROVENANCE_MAX),
      })
      .strict(),
  ])
  .refine((edge) => edge.from !== edge.to, 'edge endpoints must differ')
export type EdgeFile = z.infer<typeof EDGE_FILE_SCHEMA>

export const RESULT_DATA_SCHEMA = z
  .object({
    id: z.string().regex(RESULT_ID_RE, 'must be a res_<uuid> id'),
    status: z.enum(['draft', 'validated', 'superseded']),
    observed_at: OBSERVED_AT_SCHEMA,
  })
  .strict()
export type ResultData = z.infer<typeof RESULT_DATA_SCHEMA>

export const MANIFEST_SCHEMA = z
  .object({
    schema_version: z.literal(1),
    project_id: UUID_SCHEMA,
    name: z.string().min(1).max(MANIFEST_NAME_MAX),
  })
  .strict()
export type ResearchManifest = z.infer<typeof MANIFEST_SCHEMA>

// ------------------------------------------------------------------ parsers

function parseJson(raw: string): ParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown }
  } catch {
    return { ok: false, issues: ['file is not valid JSON'] }
  }
}

function parseWith<T>(raw: string, parse: (value: unknown) => ParseResult<T>): ParseResult<T> {
  const json = parseJson(raw)
  if (!json.ok) return json
  return parse(json.value)
}

export function parseManifest(raw: string): ParseResult<ResearchManifest> {
  return parseWith(raw, (value) => resultOf(MANIFEST_SCHEMA.safeParse(value)))
}

export function parseEdgeFile(raw: string): ParseResult<EdgeFile> {
  return parseWith(raw, (value) => resultOf(EDGE_FILE_SCHEMA.safeParse(value)))
}

export function parseFramingLinkFile(raw: string): ParseResult<FramingLinkFile> {
  return parseWith(raw, (value) => resultOf(FRAMING_LINK_FILE_SCHEMA.safeParse(value)))
}

export function parseEvidenceData(value: unknown): ParseResult<EvidenceData> {
  return resultOf(EVIDENCE_DATA_SCHEMA.safeParse(value))
}

export function parseNodeData(value: unknown): ParseResult<NodeData> {
  return resultOf(NODE_DATA_SCHEMA.safeParse(value))
}

export function parseQuestionData(value: unknown): ParseResult<QuestionData> {
  return resultOf(QUESTION_DATA_SCHEMA.safeParse(value))
}

export function parseResultData(value: unknown): ParseResult<ResultData> {
  return resultOf(RESULT_DATA_SCHEMA.safeParse(value))
}

export function parsePublicationReference(value: unknown): ParseResult<PublicationReference> {
  return resultOf(PUBLICATION_REFERENCE_SCHEMA.safeParse(value))
}

// ----------------------------------------------------------- ids and paths

export type EntityType = 'question' | 'framing_link' | 'node' | 'edge' | 'evidence' | 'result'

/**
 * Map an entity id to its type from the id prefix. Undefined for anything
 * else; entity paths are always derived from validated ids, never from
 * caller-supplied paths.
 */
export function entityTypeOfId(id: string): EntityType | undefined {
  if (QUESTION_ID_RE.test(id)) return 'question'
  if (FRAMING_LINK_ID_RE.test(id)) return 'framing_link'
  if (NODE_ID_RE.test(id)) return 'node'
  if (EDGE_ID_RE.test(id)) return 'edge'
  if (EVIDENCE_ID_RE.test(id)) return 'evidence'
  if (RESULT_ID_RE.test(id)) return 'result'
  return undefined
}

/** Relative managed path for an entity id (forward slashes). */
export function entityFilePath(id: string): string | undefined {
  const type = entityTypeOfId(id)
  if (type === 'question') return `questions/${id}.md`
  if (type === 'framing_link') return `question-links/${id}.json`
  if (type === 'node') return `nodes/${id}.md`
  if (type === 'edge') return `edges/${id}.json`
  if (type === 'evidence') return `evidence/${id}.md`
  if (type === 'result') return `results/${id}.md`
  return undefined
}

/**
 * Strict managed file-name check: exactly `<entity id>.<md|json>` with the
 * matching prefix. Anything else inside a managed directory is a diagnostic.
 */
export function isValidManagedFileName(name: string): boolean {
  if (name.endsWith('.md')) {
    const id = name.slice(0, -'.md'.length)
    return QUESTION_ID_RE.test(id) || NODE_ID_RE.test(id) || EVIDENCE_ID_RE.test(id) || RESULT_ID_RE.test(id)
  }
  if (name.endsWith('.json')) {
    const id = name.slice(0, -'.json'.length)
    return FRAMING_LINK_ID_RE.test(id) || EDGE_ID_RE.test(id)
  }
  return false
}
