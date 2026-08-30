import yaml from 'js-yaml'
import { z } from 'zod'
import { assessCandidate, validateImportDraft } from './import-draft.js'
import type { LoadedProject } from './parser.js'
import { fileVersion, HASH_RE, type HashFn } from './revision.js'
import {
  ASSERTION_MAX,
  BODY_SCHEMA,
  EDGE_ID_RE,
  ENDPOINT_ID_RE,
  EVIDENCE_ID_RE,
  EVIDENCE_REFS_MAX,
  PUBLICATION_REFS_MAX,
  LIMITATION_MAX,
  LIMITATIONS_MAX,
  LOCATOR_SCHEMA,
  NODE_ID_RE,
  RESULT_ID_RE,
  EDGE_FILE_SCHEMA,
  NON_EMPTY_BODY_SCHEMA,
  NODE_DATA_SCHEMA,
  OBSERVED_AT_SCHEMA,
  entityFilePath,
  normalizeDoi,
  normalizePmid,
  resultOf,
  type ConfidenceBand,
  type EdgeBasis,
  type EdgeFile,
  type EvidenceData,
  type EvidenceDirection,
  type EvidenceRef,
  type EvidenceReview,
  type Locator,
  type NodeData,
  type NodeKind,
  type ParseResult,
  type PublicationReference,
  type Relation,
  type ResearchManifest,
  type ResultData,
  type ResultStatus,
} from './schema.js'
import { evidenceRefIssues, findingHasSupport, predictsEndpointsValid } from './validator.js'

/**
 * Typed single-entity commands (architecture §6.1). One command persists
 * exactly one entity. `planCommand` validates a command against the current
 * project state and renders the exact file to write; the Host owns reading,
 * atomic replacement, re-validation, and the Git checkpoint.
 */

// ------------------------------------------------------------- wire schemas

const EVIDENCE_REF_COMMAND_SCHEMA = z
  .object({
    id: z.string().regex(EVIDENCE_ID_RE, 'must be an ev_<uuid> id'),
    role: z.enum(['supports', 'contradicts']),
  })
  .strict()

const PUBLICATION_REF_COMMAND_SCHEMA = z
  .object({
    pmid: z.string().optional(),
    doi: z.string().optional(),
  })
  .strict()

const HASH_SCHEMA = z.string().regex(HASH_RE, 'must be a 64-char lowercase hex SHA-256')

const NODE_KIND_SCHEMA = z.enum(['finding', 'hypothesis', 'prediction'])
const CONFIDENCE_SCHEMA = z.enum(['low', 'moderate', 'high'])
const RELATION_SCHEMA = z.enum(['supports', 'contradicts', 'causes', 'associated_with', 'predicts'])
const BASIS_SCHEMA = z.enum(['literature', 'experiment', 'ai_inference'])
const DIRECTION_SCHEMA = z.enum(['supports', 'contradicts', 'context'])
const LIMITATIONS_SCHEMA = z.array(z.string().min(1).max(LIMITATION_MAX)).max(LIMITATIONS_MAX)

export const RESEARCH_COMMAND_SCHEMA = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create_evidence_assertion'),
      id: z.string().regex(EVIDENCE_ID_RE, 'must be an ev_<uuid> id'),
      publicationRef: PUBLICATION_REF_COMMAND_SCHEMA.optional(),
      locator: LOCATOR_SCHEMA,
      assertion: z.string().min(1).max(ASSERTION_MAX),
      direction: DIRECTION_SCHEMA,
      limitations: LIMITATIONS_SCHEMA.optional(),
      body: BODY_SCHEMA.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('review_evidence_assertion'),
      id: z.string().regex(EVIDENCE_ID_RE, 'must be an ev_<uuid> id'),
      expectedFileVersion: HASH_SCHEMA,
      reviewStatus: z.enum(['reviewed', 'rejected']),
      limitations: LIMITATIONS_SCHEMA.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('create_node'),
      id: z.string().regex(NODE_ID_RE, 'must be a node_<uuid> id'),
      nodeKind: NODE_KIND_SCHEMA,
      confidence: CONFIDENCE_SCHEMA,
      evidenceRefs: z.array(EVIDENCE_REF_COMMAND_SCHEMA).max(EVIDENCE_REFS_MAX).optional(),
      body: NON_EMPTY_BODY_SCHEMA,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_node'),
      id: z.string().regex(NODE_ID_RE, 'must be a node_<uuid> id'),
      expectedFileVersion: HASH_SCHEMA,
      nodeKind: NODE_KIND_SCHEMA.optional(),
      confidence: CONFIDENCE_SCHEMA.optional(),
      evidenceRefs: z.array(EVIDENCE_REF_COMMAND_SCHEMA).max(EVIDENCE_REFS_MAX).optional(),
      body: NON_EMPTY_BODY_SCHEMA.optional(),
    })
    .strict()
    .refine(
      (command) =>
        command.nodeKind !== undefined ||
        command.confidence !== undefined ||
        command.evidenceRefs !== undefined ||
        command.body !== undefined,
      'update_node requires at least one change',
    ),
  z
    .object({
      kind: z.literal('create_edge'),
      id: z.string().regex(EDGE_ID_RE, 'must be an edge_<uuid> id'),
      from: z.string().regex(ENDPOINT_ID_RE, 'must be a node_ or res_ id'),
      to: z.string().regex(ENDPOINT_ID_RE, 'must be a node_ or res_ id'),
      relation: RELATION_SCHEMA,
      basis: BASIS_SCHEMA,
      evidenceRefs: z.array(EVIDENCE_REF_COMMAND_SCHEMA).max(EVIDENCE_REFS_MAX).optional(),
      publicationRefs: z.array(PUBLICATION_REF_COMMAND_SCHEMA).max(PUBLICATION_REFS_MAX).optional(),
      provenance: z.string().min(1).max(2000).optional(),
      evidenceGap: z.string().min(1).max(2000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_edge'),
      id: z.string().regex(EDGE_ID_RE, 'must be an edge_<uuid> id'),
      expectedFileVersion: HASH_SCHEMA,
      relation: RELATION_SCHEMA.optional(),
      basis: BASIS_SCHEMA.optional(),
      evidenceRefs: z.array(EVIDENCE_REF_COMMAND_SCHEMA).max(EVIDENCE_REFS_MAX).optional(),
      publicationRefs: z.array(PUBLICATION_REF_COMMAND_SCHEMA).max(PUBLICATION_REFS_MAX).optional(),
      provenance: z.string().min(1).max(2000).optional(),
      evidenceGap: z.string().min(1).max(2000).optional(),
    })
    .strict()
    .refine(
      (command) =>
        command.relation !== undefined ||
        command.basis !== undefined ||
        command.evidenceRefs !== undefined ||
        command.publicationRefs !== undefined ||
        command.provenance !== undefined ||
        command.evidenceGap !== undefined,
      'update_edge requires at least one change',
    ),
  z
    .object({
      kind: z.literal('create_result'),
      id: z.string().regex(RESULT_ID_RE, 'must be a res_<uuid> id'),
      observedAt: OBSERVED_AT_SCHEMA,
      body: NON_EMPTY_BODY_SCHEMA,
    })
    .strict(),
  z
    .object({
      kind: z.literal('update_result'),
      id: z.string().regex(RESULT_ID_RE, 'must be a res_<uuid> id'),
      expectedFileVersion: HASH_SCHEMA,
      status: z.enum(['draft', 'validated', 'superseded']).optional(),
      observedAt: OBSERVED_AT_SCHEMA.optional(),
      body: NON_EMPTY_BODY_SCHEMA.optional(),
    })
    .strict()
    .refine(
      (command) =>
        command.status !== undefined || command.observedAt !== undefined || command.body !== undefined,
      'update_result requires at least one change',
    ),
  z
    .object({
      kind: z.literal('import_draft_item'),
      id: z.string().regex(EVIDENCE_ID_RE, 'must be an ev_<uuid> id'),
      index: z.number().int().min(0).max(49),
      draft: z.unknown(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('delete_edge'),
      id: z.string().regex(EDGE_ID_RE, 'must be an edge_<uuid> id'),
      expectedFileVersion: HASH_SCHEMA,
    })
    .strict(),
  z
    .object({
      kind: z.literal('delete_node'),
      id: z.string().regex(NODE_ID_RE, 'must be a node_<uuid> id'),
      expectedFileVersion: HASH_SCHEMA,
    })
    .strict(),
])
export type ResearchCommand = z.infer<typeof RESEARCH_COMMAND_SCHEMA>

export function parseCommand(raw: unknown): ParseResult<ResearchCommand> {
  return resultOf(RESEARCH_COMMAND_SCHEMA.safeParse(raw))
}

// ---------------------------------------------------------------- planning

export interface CommandIssue {
  code: string
  message: string
  entityId?: string
}

export type PlanResult =
  | { ok: true; path: string; content: string; entityId: string; kind: string; writeKind: 'create' | 'update' }
  | { ok: true; path: string; entityId: string; kind: string; writeKind: 'delete' }
  | { ok: false; issues: CommandIssue[] }

interface CommandView {
  kind: ResearchCommand['kind']
}

const YAML_DUMP_OPTIONS = { lineWidth: -1, noRefs: true, sortKeys: false } as const

function renderMarkdown(data: Record<string, unknown>, body: string): string {
  return `---\n${yaml.dump(data, YAML_DUMP_OPTIONS)}---\n${body}`
}

function renderEdge(edge: EdgeFile): string {
  return JSON.stringify(edge, null, 2) + '\n'
}

function nodeFrontMatter(data: NodeData): Record<string, unknown> {
  const frontMatter: Record<string, unknown> = {
    id: data.id,
    kind: data.kind,
    confidence: data.confidence,
  }
  if (data.evidence_refs !== undefined) frontMatter['evidence_refs'] = data.evidence_refs
  return frontMatter
}

function evidenceFrontMatter(data: EvidenceData): Record<string, unknown> {
  const frontMatter: Record<string, unknown> = {
    id: data.id,
    publication_ref: data.publication_ref,
    locator: data.locator,
    assertion: data.assertion,
    direction: data.direction,
    review_status: data.review_status,
  }
  if (data.limitations !== undefined) frontMatter['limitations'] = data.limitations
  return frontMatter
}

function resultFrontMatter(data: ResultData): Record<string, unknown> {
  return { id: data.id, status: data.status, observed_at: data.observed_at }
}

function commandIssue(code: string, message: string, entityId?: string): CommandIssue {
  return entityId !== undefined ? { code, message, entityId } : { code, message }
}

function currentFile(project: LoadedProject, id: string): string | undefined {
  const path = entityFilePath(id)
  return path !== undefined ? project.files.get(path) : undefined
}

function checkAbsent(project: LoadedProject, id: string, issues: CommandIssue[]): boolean {
  if (currentFile(project, id) !== undefined) {
    issues.push(commandIssue('INVALID_ENTITY', `entity ${id} already exists`, id))
    return false
  }
  return true
}

function checkVersion(
  project: LoadedProject,
  id: string,
  expectedVersion: string,
  hash: HashFn,
  issues: CommandIssue[],
): string | undefined {
  const content = currentFile(project, id)
  if (content === undefined) {
    issues.push(commandIssue('INVALID_ENTITY', `entity ${id} does not exist`, id))
    return undefined
  }
  if (fileVersion(content, hash) !== expectedVersion) {
    issues.push(commandIssue('STALE_TARGET', `entity ${id} changed since it was read`, id))
    return undefined
  }
  return content
}

interface NormalizedReference {
  ok: true
  value: PublicationReference
}

function normalizeCommandPublicationRef(
  ref: { pmid?: string | undefined; doi?: string | undefined } | undefined,
): NormalizedReference | { ok: false; message: string } {
  if (ref === undefined) {
    return { ok: false, message: 'publicationRef with a valid pmid or doi is required' }
  }
  const pmid = ref.pmid !== undefined ? normalizePmid(ref.pmid) : undefined
  const doi = ref.doi !== undefined ? normalizeDoi(ref.doi) : undefined
  if (ref.pmid !== undefined && pmid === undefined) return { ok: false, message: 'publicationRef.pmid is invalid' }
  if (ref.doi !== undefined && doi === undefined) return { ok: false, message: 'publicationRef.doi is invalid' }
  if (pmid === undefined && doi === undefined) {
    return { ok: false, message: 'publicationRef requires a valid pmid or doi' }
  }
  const value: PublicationReference = {
    ...(pmid !== undefined ? { pmid } : {}),
    ...(doi !== undefined ? { doi } : {}),
  }
  return { ok: true, value }
}

const REVIEW_TRANSITIONS: Record<EvidenceReview, readonly EvidenceReview[]> = {
  candidate: ['reviewed', 'rejected'],
  reviewed: ['rejected'],
  rejected: [],
}

const RESULT_TRANSITIONS: Record<ResultStatus, readonly ResultStatus[]> = {
  draft: ['validated', 'superseded'],
  validated: ['superseded'],
  superseded: [],
}

function pushEvidenceRefIssues(project: LoadedProject, path: string, refs: readonly EvidenceRef[] | undefined, issues: CommandIssue[]): void {
  for (const diagnostic of evidenceRefIssues(project, path, refs)) {
    issues.push(commandIssue('INVALID_ENTITY', diagnostic.message))
  }
}

function planCreateEvidence(project: LoadedProject, command: Extract<ResearchCommand, { kind: 'create_evidence_assertion' }>, issues: CommandIssue[]): { content: string } | undefined {
  if (!checkAbsent(project, command.id, issues)) return undefined
  const reference = normalizeCommandPublicationRef(command.publicationRef)
  if (!reference.ok) {
    issues.push(commandIssue('INVALID_ENTITY', reference.message, command.id))
    return undefined
  }
  const data: EvidenceData = {
    id: command.id,
    publication_ref: reference.value,
    locator: command.locator,
    assertion: command.assertion,
    direction: command.direction,
    review_status: 'candidate',
    ...(command.limitations !== undefined ? { limitations: command.limitations } : {}),
  }
  return { content: renderMarkdown(evidenceFrontMatter(data), command.body ?? '') }
}

function planReviewEvidence(project: LoadedProject, command: Extract<ResearchCommand, { kind: 'review_evidence_assertion' }>, hash: HashFn, issues: CommandIssue[]): { content: string } | undefined {
  if (checkVersion(project, command.id, command.expectedFileVersion, hash, issues) === undefined) return undefined
  const current = project.evidenceAssertions.get(command.id)
  if (current === undefined) {
    issues.push(commandIssue('INVALID_ENTITY', `evidence ${command.id} does not exist`, command.id))
    return undefined
  }
  if (!REVIEW_TRANSITIONS[current.review_status].includes(command.reviewStatus)) {
    issues.push(
      commandIssue('INVALID_ENTITY', `evidence ${command.id} cannot move from ${current.review_status} to ${command.reviewStatus}`, command.id),
    )
    return undefined
  }
  const data: EvidenceData = {
    ...current,
    review_status: command.reviewStatus,
    ...(command.limitations !== undefined ? { limitations: command.limitations } : {}),
  }
  return { content: renderMarkdown(evidenceFrontMatter(data), current.body) }
}

function planCreateNode(project: LoadedProject, command: Extract<ResearchCommand, { kind: 'create_node' }>, issues: CommandIssue[]): { content: string } | undefined {
  if (!checkAbsent(project, command.id, issues)) return undefined
  const refs = command.evidenceRefs ?? []
  const data: NodeData = {
    id: command.id,
    kind: command.nodeKind,
    confidence: command.confidence,
    ...(command.evidenceRefs !== undefined ? { evidence_refs: command.evidenceRefs } : {}),
  }
  const parsed = NODE_DATA_SCHEMA.safeParse(data)
  if (!parsed.success) {
    for (const issueMessage of parsed.error.issues.map((i) => i.message)) {
      issues.push(commandIssue('INVALID_ENTITY', issueMessage, command.id))
    }
    return undefined
  }
  pushEvidenceRefIssues(project, entityFilePath(command.id) ?? '', refs, issues)
  if (command.nodeKind === 'finding' && !findingHasSupport(project, command.id, refs)) {
    issues.push(
      commandIssue('INVALID_ENTITY', `finding ${command.id} needs a reviewed supporting assertion or a validated result edge`, command.id),
    )
  }
  return { content: renderMarkdown(nodeFrontMatter(data), command.body) }
}

function planUpdateNode(project: LoadedProject, command: Extract<ResearchCommand, { kind: 'update_node' }>, hash: HashFn, issues: CommandIssue[]): { content: string } | undefined {
  if (checkVersion(project, command.id, command.expectedFileVersion, hash, issues) === undefined) return undefined
  const current = project.nodes.get(command.id)
  if (current === undefined) {
    issues.push(commandIssue('INVALID_ENTITY', `node ${command.id} does not exist`, command.id))
    return undefined
  }
  const refs = command.evidenceRefs ?? current.evidence_refs
  const data: NodeData = {
    id: command.id,
    kind: command.nodeKind ?? current.kind,
    confidence: command.confidence ?? current.confidence,
    ...(refs !== undefined ? { evidence_refs: refs } : {}),
  }
  const parsed = NODE_DATA_SCHEMA.safeParse(data)
  if (!parsed.success) {
    for (const issueMessage of parsed.error.issues.map((i) => i.message)) {
      issues.push(commandIssue('INVALID_ENTITY', issueMessage, command.id))
    }
    return undefined
  }
  pushEvidenceRefIssues(project, entityFilePath(command.id) ?? '', refs, issues)
  if (data.kind === 'finding' && !findingHasSupport(project, command.id, refs)) {
    issues.push(
      commandIssue('INVALID_ENTITY', `finding ${command.id} needs a reviewed supporting assertion or a validated result edge`, command.id),
    )
  }
  return { content: renderMarkdown(nodeFrontMatter(data), command.body ?? current.body) }
}

interface EdgeShape {
  id: string
  from: string
  to: string
  relation: Relation
  basis: EdgeBasis
  evidence_refs?: EvidenceRef[]
  publication_refs?: { pmid?: string | undefined; doi?: string | undefined }[]
  provenance?: string
  evidence_gap?: string
}

function edgeToDisk(command: {
  id: string
  from: string
  to: string
  relation: Relation
  basis: EdgeBasis
  evidenceRefs?: EvidenceRef[] | undefined
  publicationRefs?: { pmid?: string | undefined; doi?: string | undefined }[] | undefined
  provenance?: string | undefined
  evidenceGap?: string | undefined
}): EdgeShape {
  return {
    id: command.id,
    from: command.from,
    to: command.to,
    relation: command.relation,
    basis: command.basis,
    ...(command.evidenceRefs !== undefined ? { evidence_refs: command.evidenceRefs } : {}),
    ...(command.publicationRefs !== undefined
      ? {
          publication_refs: command.publicationRefs.map((reference) => ({
            ...(reference.pmid !== undefined
              ? { pmid: normalizePmid(reference.pmid) ?? reference.pmid }
              : {}),
            ...(reference.doi !== undefined
              ? { doi: normalizeDoi(reference.doi) ?? reference.doi }
              : {}),
          })),
        }
      : {}),
    ...(command.provenance !== undefined ? { provenance: command.provenance } : {}),
    ...(command.evidenceGap !== undefined ? { evidence_gap: command.evidenceGap } : {}),
  }
}

function validateEdgeShape(project: LoadedProject, shape: EdgeShape, issues: CommandIssue[]): EdgeFile | undefined {
  const parsed = EDGE_FILE_SCHEMA.safeParse(shape)
  if (!parsed.success) {
    for (const issueMessage of parsed.error.issues.map((i) => i.message)) {
      issues.push(commandIssue('INVALID_ENTITY', issueMessage, shape.id))
    }
    return undefined
  }
  if (project.nodes.get(shape.from) === undefined && project.results.get(shape.from) === undefined) {
    issues.push(commandIssue('INVALID_ENTITY', `edge endpoint ${shape.from} does not exist`, shape.id))
  }
  if (project.nodes.get(shape.to) === undefined && project.results.get(shape.to) === undefined) {
    issues.push(commandIssue('INVALID_ENTITY', `edge endpoint ${shape.to} does not exist`, shape.id))
  }
  if (shape.relation === 'predicts' && !predictsEndpointsValid(project, shape.from, shape.to)) {
    issues.push(
      commandIssue(
        'INVALID_ENTITY',
        `predicts edge ${shape.id} must connect a Finding/Hypothesis to a Prediction`,
        shape.id,
      ),
    )
  }
  pushEvidenceRefIssues(project, entityFilePath(shape.id) ?? '', shape.evidence_refs, issues)
  return parsed.data
}

function planCreateEdge(project: LoadedProject, command: Extract<ResearchCommand, { kind: 'create_edge' }>, issues: CommandIssue[]): { content: string } | undefined {
  if (!checkAbsent(project, command.id, issues)) return undefined
  const edge = validateEdgeShape(project, edgeToDisk(command), issues)
  if (edge === undefined) return undefined
  return { content: renderEdge(edge) }
}

function planUpdateEdge(project: LoadedProject, command: Extract<ResearchCommand, { kind: 'update_edge' }>, hash: HashFn, issues: CommandIssue[]): { content: string } | undefined {
  if (checkVersion(project, command.id, command.expectedFileVersion, hash, issues) === undefined) return undefined
  const edgeEntity = project.edges.get(command.id)
  if (edgeEntity === undefined) {
    issues.push(commandIssue('INVALID_ENTITY', `edge ${command.id} does not exist`, command.id))
    return undefined
  }
  const current: EdgeShape = {
    id: edgeEntity.id,
    from: edgeEntity.from,
    to: edgeEntity.to,
    relation: edgeEntity.relation,
    basis: edgeEntity.basis,
    ...('evidence_refs' in edgeEntity && edgeEntity.evidence_refs !== undefined
      ? { evidence_refs: edgeEntity.evidence_refs }
      : {}),
    ...('publication_refs' in edgeEntity && edgeEntity.publication_refs !== undefined
      ? { publication_refs: edgeEntity.publication_refs }
      : {}),
    ...('provenance' in edgeEntity && edgeEntity.provenance !== undefined
      ? { provenance: edgeEntity.provenance }
      : {}),
    ...('evidence_gap' in edgeEntity && edgeEntity.evidence_gap !== undefined
      ? { evidence_gap: edgeEntity.evidence_gap }
      : {}),
  }
  const basis = command.basis ?? current.basis
  if (
    basis !== 'ai_inference' &&
    (command.publicationRefs !== undefined ||
      command.provenance !== undefined ||
      command.evidenceGap !== undefined)
  ) {
    issues.push(
      commandIssue(
        'INVALID_ENTITY',
        'publicationRefs, provenance, and evidenceGap are only valid for ai_inference edges',
        command.id,
      ),
    )
    return undefined
  }
  const shape: EdgeShape = {
    id: current.id,
    from: current.from,
    to: current.to,
    relation: command.relation ?? current.relation,
    basis,
    ...(command.evidenceRefs !== undefined
      ? { evidence_refs: command.evidenceRefs }
      : current.evidence_refs !== undefined
        ? { evidence_refs: current.evidence_refs }
        : {}),
    ...(basis === 'ai_inference'
      ? {
          ...(command.publicationRefs !== undefined
            ? {
                publication_refs: command.publicationRefs.map((reference) => ({
                  ...(reference.pmid !== undefined
                    ? { pmid: normalizePmid(reference.pmid) ?? reference.pmid }
                    : {}),
                  ...(reference.doi !== undefined
                    ? { doi: normalizeDoi(reference.doi) ?? reference.doi }
                    : {}),
                })),
              }
            : current.publication_refs !== undefined
              ? { publication_refs: current.publication_refs }
              : {}),
          ...(command.provenance !== undefined
            ? { provenance: command.provenance }
            : current.provenance !== undefined
              ? { provenance: current.provenance }
              : {}),
          ...(command.evidenceGap !== undefined
            ? { evidence_gap: command.evidenceGap }
            : current.evidence_gap !== undefined
              ? { evidence_gap: current.evidence_gap }
              : {}),
        }
      : {}),
  }
  const edge = validateEdgeShape(project, shape, issues)
  if (edge === undefined) return undefined
  return { content: renderEdge(edge) }
}

function planCreateResult(project: LoadedProject, command: Extract<ResearchCommand, { kind: 'create_result' }>, issues: CommandIssue[]): { content: string } | undefined {
  if (!checkAbsent(project, command.id, issues)) return undefined
  const data: ResultData = {
    id: command.id,
    status: 'draft',
    observed_at: command.observedAt,
  }
  return { content: renderMarkdown(resultFrontMatter(data), command.body) }
}

function planUpdateResult(project: LoadedProject, command: Extract<ResearchCommand, { kind: 'update_result' }>, hash: HashFn, issues: CommandIssue[]): { content: string } | undefined {
  if (checkVersion(project, command.id, command.expectedFileVersion, hash, issues) === undefined) return undefined
  const current = project.results.get(command.id)
  if (current === undefined) {
    issues.push(commandIssue('INVALID_ENTITY', `result ${command.id} does not exist`, command.id))
    return undefined
  }
  if (command.status !== undefined && command.status !== current.status) {
    if (!RESULT_TRANSITIONS[current.status].includes(command.status)) {
      issues.push(
        commandIssue('INVALID_ENTITY', `result ${command.id} cannot move from ${current.status} to ${command.status}`, command.id),
      )
      return undefined
    }
  }
  const data: ResultData = {
    id: command.id,
    status: command.status ?? current.status,
    observed_at: command.observedAt ?? current.observed_at,
  }
  return { content: renderMarkdown(resultFrontMatter(data), command.body ?? current.body) }
}

function planImportDraftItem(project: LoadedProject, command: Extract<ResearchCommand, { kind: 'import_draft_item' }>, issues: CommandIssue[]): { content: string } | undefined {
  if (!checkAbsent(project, command.id, issues)) return undefined
  const validated = validateImportDraft(command.draft)
  if (!validated.ok) {
    for (const issue of validated.issues) {
      issues.push(commandIssue('INVALID_IMPORT_DRAFT', `${issue.code}: ${issue.message}`, command.id))
    }
    return undefined
  }
  const candidate = validated.value.draft.evidenceCandidates[command.index]
  const assessment = validated.value.assessments[command.index]
  if (candidate === undefined || assessment === undefined) {
    issues.push(commandIssue('INVALID_IMPORT_DRAFT', `candidate index ${command.index} is out of range`, command.id))
    return undefined
  }
  if (!assessment.importable || assessment.publicationRef === undefined) {
    issues.push(
      commandIssue('INVALID_IMPORT_DRAFT', `candidate ${command.index} is not importable: ${assessment.reasons.join('; ')}`, command.id),
    )
    return undefined
  }
  const data: EvidenceData = {
    id: command.id,
    publication_ref: assessment.publicationRef,
    locator: candidate.locator,
    assertion: candidate.assertion,
    direction: candidate.direction,
    review_status: 'candidate',
    ...(candidate.limitations !== undefined ? { limitations: candidate.limitations } : {}),
  }
  return { content: renderMarkdown(evidenceFrontMatter(data), '') }
}

function planDeleteEdge(
  project: LoadedProject,
  command: Extract<ResearchCommand, { kind: 'delete_edge' }>,
  hash: HashFn,
  issues: CommandIssue[],
): { delete: true } | undefined {
  if (checkVersion(project, command.id, command.expectedFileVersion, hash, issues) === undefined) return undefined
  if (!project.edges.has(command.id)) {
    issues.push(commandIssue('INVALID_ENTITY', `edge ${command.id} does not exist`, command.id))
    return undefined
  }

  const remainingEdges = new Map(project.edges)
  remainingEdges.delete(command.id)
  const afterRemoval = { ...project, edges: remainingEdges }
  for (const node of project.nodes.values()) {
    if (node.kind === 'finding' && !findingHasSupport(afterRemoval, node.id, node.evidence_refs)) {
      issues.push(
        commandIssue(
          'INVALID_ENTITY',
          `edge ${command.id} cannot be deleted because finding ${node.id} would lose required support`,
          command.id,
        ),
      )
    }
  }
  return { delete: true }
}

function planDeleteNode(
  project: LoadedProject,
  command: Extract<ResearchCommand, { kind: 'delete_node' }>,
  hash: HashFn,
  issues: CommandIssue[],
): { delete: true } | undefined {
  if (checkVersion(project, command.id, command.expectedFileVersion, hash, issues) === undefined) return undefined
  const node = project.nodes.get(command.id)
  if (node === undefined) {
    issues.push(commandIssue('INVALID_ENTITY', `node ${command.id} does not exist`, command.id))
    return undefined
  }
  if (node.kind === 'finding') {
    issues.push(commandIssue('INVALID_ENTITY', `finding ${command.id} cannot be physically deleted`, command.id))
  }
  const incident = [...project.edges.values()].filter(
    (edge) => edge.from === command.id || edge.to === command.id,
  )
  if (incident.length > 0) {
    issues.push(
      commandIssue(
        'INVALID_ENTITY',
        `node ${command.id} still has incident edges: ${incident.map((edge) => edge.id).sort().join(', ')}`,
        command.id,
      ),
    )
  }
  return { delete: true }
}

/**
 * Validate one command against the loaded project and plan one exact managed
 * file create, update, or deletion. Never mutates the project; the returned
 * path is derived from the entity id and stays inside the managed layout.
 */
export function planCommand(project: LoadedProject, command: ResearchCommand, hash: HashFn): PlanResult {
  const issues: CommandIssue[] = []
  let planned: { content: string } | { delete: true } | undefined
  switch (command.kind) {
    case 'create_evidence_assertion':
      planned = planCreateEvidence(project, command, issues)
      break
    case 'review_evidence_assertion':
      planned = planReviewEvidence(project, command, hash, issues)
      break
    case 'create_node':
      planned = planCreateNode(project, command, issues)
      break
    case 'update_node':
      planned = planUpdateNode(project, command, hash, issues)
      break
    case 'create_edge':
      planned = planCreateEdge(project, command, issues)
      break
    case 'update_edge':
      planned = planUpdateEdge(project, command, hash, issues)
      break
    case 'create_result':
      planned = planCreateResult(project, command, issues)
      break
    case 'update_result':
      planned = planUpdateResult(project, command, hash, issues)
      break
    case 'import_draft_item':
      planned = planImportDraftItem(project, command, issues)
      break
    case 'delete_edge':
      planned = planDeleteEdge(project, command, hash, issues)
      break
    case 'delete_node':
      planned = planDeleteNode(project, command, hash, issues)
      break
  }
  if (issues.length > 0 || planned === undefined) {
    return {
      ok: false,
      issues: issues.length > 0
        ? issues
        : [commandIssue('INVALID_ENTITY', 'command could not be planned')],
    }
  }
  const id = (command as CommandView & { id: string }).id
  const path = entityFilePath(id)
  if (path === undefined) {
    return { ok: false, issues: [commandIssue('INVALID_ENTITY', `invalid entity id ${id}`, id)] }
  }
  if ('delete' in planned) {
    return {
      ok: true,
      path,
      entityId: id,
      kind: command.kind,
      writeKind: 'delete',
    }
  }
  const writeKind: 'create' | 'update' =
    command.kind.startsWith('create') || command.kind === 'import_draft_item' ? 'create' : 'update'
  return {
    ok: true,
    path,
    content: planned.content,
    entityId: id,
    kind: command.kind,
    writeKind,
  }
}
