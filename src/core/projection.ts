import type { ResearchProject } from './parser.js'
import type {
  ConfidenceBand,
  CitationSnapshot,
  EvidenceDirection,
  EvidenceRef,
  EvidenceReview,
  Locator,
  NodeKind,
  PublicationReference,
  Relation,
  ResultStatus,
} from './schema.js'

/**
 * Rebuildable graph projection (architecture §1/§5.2). Reverse relations are
 * never stored: consumers derive them from the edge list. Output order is
 * deterministic (entity ids sorted; edge files before evidence refs).
 */

export type ProjectionEntity =
  | {
      id: string
      type: 'question'
      question: string
      scopeAssumptions: string[]
      body: string
    }
  | {
      id: string
      type: 'node'
      kind: NodeKind
      confidence: ConfidenceBand
      evidenceRefs: EvidenceRef[]
      body: string
    }
  | {
      id: string
      type: 'evidence'
      assertion: string
      direction: EvidenceDirection
      reviewStatus: EvidenceReview
      publicationRef: PublicationReference
      locator: Locator
      limitations?: string[]
      citation?: CitationSnapshot
      machineReviewRationale?: string
      body: string
    }
  | {
      id: string
      type: 'result'
      status: ResultStatus
      observedAt: string
      body: string
    }

export interface ProjectionEdge {
  from: string
  to: string
  relation: Relation | 'frames'
  /** Stored scientific edge, non-scientific framing link, or evidence reference. */
  source: 'edge' | 'framing_link' | 'evidence_ref'
  basis?: 'literature' | 'experiment' | 'ai_inference'
  /** Stored edge id; absent for evidence refs. */
  id?: string
}

export interface ResearchProjection {
  entities: ProjectionEntity[]
  edges: ProjectionEdge[]
}

export function buildProjection(project: ResearchProject): ResearchProjection {
  const entities: ProjectionEntity[] = [
    ...[...project.questions.values()].map((question) => ({
      id: question.id,
      type: 'question' as const,
      question: question.question,
      scopeAssumptions: question.scope_assumptions ?? [],
      body: question.body,
    })),
    ...[...project.nodes.values()].map((node) => ({
      id: node.id,
      type: 'node' as const,
      kind: node.kind,
      confidence: node.confidence,
      evidenceRefs: node.evidence_refs ?? [],
      body: node.body,
    })),
    ...[...project.evidenceAssertions.values()].map((evidence) => ({
      id: evidence.id,
      type: 'evidence' as const,
      assertion: evidence.assertion,
      direction: evidence.direction,
      reviewStatus: evidence.review_status,
      publicationRef: evidence.publication_ref,
      locator: evidence.locator,
      ...(evidence.limitations !== undefined ? { limitations: evidence.limitations } : {}),
      ...(evidence.citation !== undefined ? { citation: evidence.citation } : {}),
      ...(evidence.machine_review_rationale !== undefined
        ? { machineReviewRationale: evidence.machine_review_rationale }
        : {}),
      body: evidence.body,
    })),
    ...[...project.results.values()].map((result) => ({
      id: result.id,
      type: 'result' as const,
      status: result.status,
      observedAt: result.observed_at,
      body: result.body,
    })),
  ]
  entities.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const edgeEdges: ProjectionEdge[] = [...project.edges.values()]
    .map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      basis: edge.basis,
      source: 'edge' as const,
    }))
    .sort((a, b) => (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0))

  const evidenceRefEdges: ProjectionEdge[] = [...project.nodes.values()]
    .flatMap((node) =>
      (node.evidence_refs ?? []).map((ref) => ({
        from: ref.id,
        to: node.id,
        relation: ref.role,
        source: 'evidence_ref' as const,
      })),
    )
    .sort(
      (a, b) =>
        (a.from + '\n' + a.to) < (b.from + '\n' + b.to)
          ? -1
          : (a.from + '\n' + a.to) > (b.from + '\n' + b.to)
            ? 1
            : 0,
    )

  const framingLinkEdges: ProjectionEdge[] = [...project.framingLinks.values()]
    .map((link) => ({
      id: link.id,
      from: link.from,
      to: link.to,
      relation: link.relation,
      source: 'framing_link' as const,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  return { entities, edges: [...edgeEdges, ...framingLinkEdges, ...evidenceRefEdges] }
}
