import type { LoadedProject } from '../core/parser.js'
import { distinctPublicationReferenceCount } from '../core/publication-references.js'
import { buildProjection } from '../core/projection.js'
import {
  entityTypeOfId,
  type EvidenceRef,
  type PublicationReference,
} from '../core/schema.js'
import type {
  CompanionFailure,
  EntityDocument,
  EntityResponse,
  FocusResponse,
  FocusState,
  LaunchResponse,
  ProjectionEntitySummary,
  ProjectionEdgeSummary,
  LiteratureEvidenceItem,
  LiteratureProjection,
  SnapshotGraph,
  SnapshotProject,
  SnapshotResponse,
} from '../shared/companion-contract.js'
import { COMPANION_URL } from '../shared/routes.js'
import {
  loadProjectState,
  type ProjectContext,
  type ResearchHostDeps,
} from './apply-command.js'
import type { SessionsPort, StorageDomain } from './contracts.js'
import { boundedLabel } from './labels.js'
import { PageKeyStore, type PageBinding } from './page-keys.js'
import { readFocus, writeFocus } from './ui-state.js'

export interface CompanionServiceDeps extends ResearchHostDeps {
  storage: StorageDomain
  sessions: SessionsPort
  pageKeys: PageKeyStore
}

export interface CompanionApiPort {
  launch(sessionId: string, signal?: AbortSignal): Promise<LaunchResponse>
  snapshot(
    pageKey: string,
    sinceProjectRevision?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotResponse>
  entity(pageKey: string, entityId: string, signal?: AbortSignal): Promise<EntityResponse>
  setFocus(pageKey: string, entityId: string, signal?: AbortSignal): Promise<FocusResponse>
}

interface BoundProject {
  binding: PageBinding
  context: ProjectContext
}

function failure(
  code: string,
  message: string,
  recoverable = true,
  entityId?: string,
): CompanionFailure {
  return entityId === undefined
    ? { ok: false, code, message, recoverable }
    : { ok: false, code, message, recoverable, entityId }
}

function pageKeyInvalid(): CompanionFailure {
  return failure('PAGE_KEY_INVALID', 'Reopen the Companion from DSH.')
}

function entityExists(project: LoadedProject, entityId: string): boolean {
  const type = entityTypeOfId(entityId)
  if (type === 'question') return project.questions.has(entityId)
  if (type === 'framing_link') return project.framingLinks.has(entityId)
  if (type === 'node') return project.nodes.has(entityId)
  if (type === 'evidence') return project.evidenceAssertions.has(entityId)
  if (type === 'result') return project.results.has(entityId)
  if (type === 'edge') return project.edges.has(entityId)
  return false
}

interface ReferenceCounts {
  /** Deprecated v1 aliases retained for first-party bundle reload compatibility. */
  referenceCount: number
  reviewedEvidenceCount: number
  publicationCount: number
  machineReviewedEvidenceCount: number
  humanReviewedEvidenceCount: number
}

interface LiteratureInputs {
  evidenceRefs: EvidenceRef[]
  publicationRefs: PublicationReference[]
}

function nodeLiteratureInputs(project: LoadedProject, nodeId: string): LiteratureInputs {
  const node = project.nodes.get(nodeId)
  const evidenceRefs = [...(node?.evidence_refs ?? [])]
  const publicationRefs: PublicationReference[] = []
  for (const edge of project.edges.values()) {
    if (edge.from !== nodeId && edge.to !== nodeId) continue
    evidenceRefs.push(...(edge.evidence_refs ?? []))
    if (edge.basis === 'ai_inference') publicationRefs.push(...edge.publication_refs)
  }
  return { evidenceRefs, publicationRefs }
}

function questionLiteratureInputs(project: LoadedProject, questionId: string): LiteratureInputs {
  const evidenceRefs: EvidenceRef[] = []
  const publicationRefs: PublicationReference[] = []
  for (const link of project.framingLinks.values()) {
    if (link.from !== questionId) continue
    const inputs = nodeLiteratureInputs(project, link.to)
    evidenceRefs.push(...inputs.evidenceRefs)
    publicationRefs.push(...inputs.publicationRefs)
  }
  return { evidenceRefs, publicationRefs }
}

function referenceCounts(project: LoadedProject, inputs: LiteratureInputs): ReferenceCounts {
  const evidenceIds = new Set(inputs.evidenceRefs.map((ref) => ref.id))
  const publications = [...inputs.publicationRefs]
  let machineReviewedEvidenceCount = 0
  let humanReviewedEvidenceCount = 0
  for (const id of evidenceIds) {
    const evidence = project.evidenceAssertions.get(id)
    if (evidence === undefined) continue
    publications.push(evidence.publication_ref)
    if (evidence.review_status === 'machine_reviewed') machineReviewedEvidenceCount += 1
    if (evidence.review_status === 'reviewed') humanReviewedEvidenceCount += 1
  }
  const publicationCount = distinctPublicationReferenceCount(publications)
  return {
    referenceCount: publicationCount,
    reviewedEvidenceCount: humanReviewedEvidenceCount,
    publicationCount,
    machineReviewedEvidenceCount,
    humanReviewedEvidenceCount,
  }
}

function nodeReferenceCounts(project: LoadedProject, nodeId: string): ReferenceCounts {
  return referenceCounts(project, nodeLiteratureInputs(project, nodeId))
}

function samePublication(left: PublicationReference, right: PublicationReference): boolean {
  return (
    (left.pmid !== undefined && left.pmid === right.pmid) ||
    (left.doi !== undefined && left.doi === right.doi)
  )
}

function evidenceItem(project: LoadedProject, id: string): LiteratureEvidenceItem | undefined {
  const evidence = project.evidenceAssertions.get(id)
  if (evidence === undefined) return undefined
  return {
    id: evidence.id,
    publicationRef: evidence.publication_ref,
    ...(evidence.citation !== undefined ? { citation: evidence.citation } : {}),
    assertion: evidence.assertion,
    locator: evidence.locator,
    direction: evidence.direction,
    ...(evidence.limitations !== undefined ? { limitations: evidence.limitations } : {}),
    ...(evidence.machine_review_rationale !== undefined
      ? { machineReviewRationale: evidence.machine_review_rationale }
      : {}),
    reviewStatus: evidence.review_status,
  }
}

function literatureProjection(project: LoadedProject, inputs: LiteratureInputs): LiteratureProjection {
  const items = [...new Set(inputs.evidenceRefs.map((ref) => ref.id))]
    .map((id) => evidenceItem(project, id))
    .filter((item): item is LiteratureEvidenceItem => item !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id))
  const retrievalOnly = inputs.publicationRefs.filter(
    (reference, index, all) =>
      !items.some((item) => samePublication(item.publicationRef, reference)) &&
      all.findIndex((candidate) => samePublication(candidate, reference)) === index,
  )
  return {
    humanReviewed: items.filter((item) => item.reviewStatus === 'reviewed'),
    machineReviewed: items.filter((item) => item.reviewStatus === 'machine_reviewed'),
    candidate: items.filter((item) => item.reviewStatus === 'candidate'),
    rejected: items.filter((item) => item.reviewStatus === 'rejected'),
    retrievalOnly,
  }
}

function graphSnapshot(project: LoadedProject): SnapshotGraph {
  const projection = buildProjection(project)
  const entities: ProjectionEntitySummary[] = projection.entities.map((entity) => {
    if (entity.type === 'question') {
      return {
        id: entity.id,
        type: entity.type,
        label: boundedLabel(entity.question, 'Research Question'),
      }
    }
    if (entity.type === 'node') {
      const counts = nodeReferenceCounts(project, entity.id)
      return {
        id: entity.id,
        type: entity.type,
        kind: entity.kind,
        confidence: entity.confidence,
        ...counts,
        label: boundedLabel(entity.body, entity.kind),
      }
    }
    if (entity.type === 'evidence') {
      return {
        id: entity.id,
        type: entity.type,
        direction: entity.direction,
        reviewStatus: entity.reviewStatus,
        label: boundedLabel(entity.assertion, 'Evidence Assertion'),
      }
    }
    return {
      id: entity.id,
      type: entity.type,
      status: entity.status,
      observedAt: entity.observedAt,
      label: boundedLabel(entity.body, 'Result'),
    }
  })

  const edges: ProjectionEdgeSummary[] = projection.edges.map((edge) => {
    const stored = edge.id === undefined ? undefined : project.edges.get(edge.id)
    return {
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      source: edge.source,
      ...(edge.id !== undefined ? { id: edge.id } : {}),
      ...(edge.basis !== undefined ? { basis: edge.basis } : {}),
      ...(stored?.basis === 'ai_inference'
        ? { evidenceGap: stored.evidence_gap.slice(0, 2000) }
        : {}),
    }
  })
  return { entities, edges }
}

function entityDocument(project: LoadedProject, entityId: string): EntityDocument | undefined {
  const type = entityTypeOfId(entityId)
  if (type === 'question') {
    const question = project.questions.get(entityId)
    if (question === undefined) return undefined
    const framedEntityIds = [...project.framingLinks.values()]
      .filter((link) => link.from === entityId)
      .map((link) => link.to)
      .sort()
    const counts = referenceCounts(project, questionLiteratureInputs(project, entityId))
    return {
      id: question.id,
      type,
      question: question.question,
      scopeAssumptions: question.scope_assumptions ?? [],
      body: question.body,
      framedEntityIds,
      publicationCount: counts.publicationCount,
      machineReviewedEvidenceCount: counts.machineReviewedEvidenceCount,
      humanReviewedEvidenceCount: counts.humanReviewedEvidenceCount,
    }
  }
  if (type === 'framing_link') {
    const link = project.framingLinks.get(entityId)
    return link === undefined
      ? undefined
      : { id: link.id, type, from: link.from, to: link.to, relation: link.relation }
  }
  if (type === 'node') {
    const node = project.nodes.get(entityId)
    return node === undefined
      ? undefined
      : {
          id: node.id,
          type,
          kind: node.kind,
          confidence: node.confidence,
          evidenceRefs: node.evidence_refs ?? [],
          ...nodeReferenceCounts(project, node.id),
          literature: literatureProjection(project, nodeLiteratureInputs(project, node.id)),
          body: node.body,
        }
  }
  if (type === 'evidence') {
    const evidence = project.evidenceAssertions.get(entityId)
    return evidence === undefined
      ? undefined
      : {
          id: evidence.id,
          type,
          assertion: evidence.assertion,
          direction: evidence.direction,
          reviewStatus: evidence.review_status,
          publicationRef: evidence.publication_ref,
          locator: evidence.locator,
          ...(evidence.limitations !== undefined
            ? { limitations: evidence.limitations }
            : {}),
          ...(evidence.citation !== undefined ? { citation: evidence.citation } : {}),
          ...(evidence.machine_review_rationale !== undefined
            ? { machineReviewRationale: evidence.machine_review_rationale }
            : {}),
          body: evidence.body,
        }
  }
  if (type === 'result') {
    const result = project.results.get(entityId)
    return result === undefined
      ? undefined
      : {
          id: result.id,
          type,
          status: result.status,
          observedAt: result.observed_at,
          body: result.body,
        }
  }
  if (type === 'edge') {
    const edge = project.edges.get(entityId)
    return edge === undefined
      ? undefined
      : (() => {
          const inputs: LiteratureInputs = {
            evidenceRefs: edge.evidence_refs ?? [],
            publicationRefs: edge.basis === 'ai_inference' ? edge.publication_refs : [],
          }
          return {
          id: edge.id,
          type,
          from: edge.from,
          to: edge.to,
          relation: edge.relation,
          basis: edge.basis,
          evidenceRefs: edge.evidence_refs ?? [],
          ...(edge.basis === 'ai_inference'
            ? { publicationRefs: edge.publication_refs }
            : {}),
          ...(edge.basis === 'ai_inference'
            ? { provenance: edge.provenance, evidenceGap: edge.evidence_gap }
            : {}),
          literature: literatureProjection(project, inputs),
        }
        })()
  }
  return undefined
}

function projectPayload(context: ProjectContext): SnapshotProject {
  const { manifest, project, branch, head, gitFailure } = context
  return {
    ...(manifest?.project_id !== undefined ? { id: manifest.project_id } : {}),
    ...(manifest?.name !== undefined ? { name: manifest.name } : {}),
    ...(manifest?.schema_version !== undefined
      ? { schemaVersion: manifest.schema_version }
      : {}),
    revision: project.projectRevision,
    readOnly: project.diagnostics.length > 0 || gitFailure !== undefined,
    diagnosticCount: project.diagnostics.length,
    diagnostics: project.diagnostics.map(({ code, path }) => ({ code, path })),
    ...(branch !== undefined ? { branch } : {}),
    ...(head !== undefined ? { head } : {}),
    ...(gitFailure !== undefined
      ? { gitError: { code: gitFailure.code, message: gitFailure.reason } }
      : {}),
  }
}

export class CompanionService implements CompanionApiPort {
  constructor(private readonly deps: CompanionServiceDeps) {}

  async launch(sessionId: string, signal?: AbortSignal): Promise<LaunchResponse> {
    const session = this.deps.sessions.get(sessionId)
    const sessionCwd = session?.header.cwd
    if (session === undefined || typeof sessionCwd !== 'string' || sessionCwd.length === 0) {
      return failure('SESSION_UNAVAILABLE', 'The DSH Session is unavailable.', false)
    }
    const context = await loadProjectState(this.deps, sessionCwd, signal)
    if (!('root' in context)) return { ...context }
    const key = this.deps.pageKeys.create({
      sessionId,
      sessionCwd,
      projectRoot: context.root,
      ...(context.manifest?.project_id !== undefined
        ? { projectId: context.manifest.project_id }
        : {}),
    })
    return { ok: true, url: `${COMPANION_URL}#key=${key}` }
  }

  async snapshot(
    pageKey: string,
    sinceProjectRevision?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotResponse> {
    const resolved = await this.resolveBoundProject(pageKey, signal)
    if (!('context' in resolved)) return resolved
    const { context, binding } = resolved
    const { project, manifest } = context
    let focus: FocusState | undefined
    if (manifest?.project_id !== undefined) {
      const stored = await readFocus(
        this.deps.storage,
        binding.sessionId,
        manifest.project_id,
      )
      if (stored !== undefined && entityExists(project, stored.focusEntityId)) {
        focus = stored
      }
    }
    const unchanged = sinceProjectRevision === project.projectRevision
    return {
      ok: true,
      unchanged,
      project: projectPayload(context),
      ...(focus !== undefined ? { focus } : {}),
      ...(!unchanged ? { graph: graphSnapshot(project) } : {}),
    }
  }

  async entity(
    pageKey: string,
    entityId: string,
    signal?: AbortSignal,
  ): Promise<EntityResponse> {
    const resolved = await this.resolveBoundProject(pageKey, signal)
    if (!('context' in resolved)) return resolved
    const entity = entityDocument(resolved.context.project, entityId)
    return entity === undefined
      ? failure('INVALID_ENTITY', 'The requested entity does not exist.', true, entityId)
      : { ok: true, entity }
  }

  async setFocus(
    pageKey: string,
    entityId: string,
    signal?: AbortSignal,
  ): Promise<FocusResponse> {
    const resolved = await this.resolveBoundProject(pageKey, signal)
    if (!('context' in resolved)) return resolved
    const { context, binding } = resolved
    const projectId = context.manifest?.project_id
    if (projectId === undefined || !entityExists(context.project, entityId)) {
      return failure('INVALID_ENTITY', 'The requested entity does not exist.', true, entityId)
    }

    const previous = await readFocus(this.deps.storage, binding.sessionId, projectId)
    const previousTrail = previous === undefined
      ? []
      : [...previous.pathIds, previous.focusEntityId].filter((id) =>
          entityExists(context.project, id),
        )
    const existingIndex = previousTrail.indexOf(entityId)
    const nextPath = existingIndex >= 0
      ? previousTrail.slice(0, existingIndex)
      : previousTrail
    const focus: FocusState = {
      focusEntityId: entityId,
      pathIds: nextPath.slice(-32),
    }
    await writeFocus(this.deps.storage, binding.sessionId, projectId, focus)
    return { ok: true, focus }
  }

  private async resolveBoundProject(
    pageKey: string,
    signal?: AbortSignal,
  ): Promise<BoundProject | CompanionFailure> {
    const binding = this.deps.pageKeys.resolve(pageKey)
    if (binding === undefined) return pageKeyInvalid()
    const session = this.deps.sessions.get(binding.sessionId)
    if (session === undefined || session.header.cwd !== binding.sessionCwd) {
      this.deps.pageKeys.revoke(pageKey)
      return pageKeyInvalid()
    }
    const context = await loadProjectState(this.deps, binding.sessionCwd, signal)
    if (
      !('root' in context) ||
      context.root !== binding.projectRoot ||
      (binding.projectId !== undefined &&
        context.manifest?.project_id !== undefined &&
        context.manifest.project_id !== binding.projectId)
    ) {
      this.deps.pageKeys.revoke(pageKey)
      return pageKeyInvalid()
    }
    return { binding, context }
  }
}
