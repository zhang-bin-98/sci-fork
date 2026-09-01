import type {
  ConfidenceBand,
  CitationSnapshot,
  EdgeBasis,
  EvidenceDirection,
  EvidenceRef,
  EvidenceReview,
  Locator,
  NodeKind,
  PublicationReference,
  Relation,
  ResultStatus,
} from '../core/schema.js'

export interface CompanionFailure {
  ok: false
  code: string
  message: string
  recoverable: boolean
  entityId?: string
}

export interface FocusState {
  focusEntityId: string
  pathIds: string[]
}

export interface DiagnosticSummary {
  code: string
  path: string
}

export interface SnapshotProject {
  id?: string
  name?: string
  schemaVersion?: number
  revision: string
  readOnly: boolean
  diagnosticCount: number
  diagnostics: DiagnosticSummary[]
  branch?: string
  head?: string
  gitError?: { code: string; message: string }
}

export type ProjectionEntitySummary =
  | {
      id: string
      type: 'question'
      label: string
    }
  | {
      id: string
      type: 'node'
      kind: NodeKind
      confidence: ConfidenceBand
      /** @deprecated Use publicationCount. Retained for first-party bundle reload compatibility. */
      referenceCount: number
      /** @deprecated Use humanReviewedEvidenceCount. Retained for first-party bundle reload compatibility. */
      reviewedEvidenceCount: number
      publicationCount: number
      machineReviewedEvidenceCount: number
      humanReviewedEvidenceCount: number
      label: string
    }
  | {
      id: string
      type: 'evidence'
      direction: EvidenceDirection
      reviewStatus: EvidenceReview
      label: string
    }
  | {
      id: string
      type: 'result'
      status: ResultStatus
      observedAt: string
      label: string
    }

export interface ProjectionEdgeSummary {
  from: string
  to: string
  relation: Relation | 'frames'
  source: 'edge' | 'framing_link' | 'evidence_ref'
  id?: string
  basis?: EdgeBasis
  evidenceGap?: string
}

export interface SnapshotGraph {
  entities: ProjectionEntitySummary[]
  edges: ProjectionEdgeSummary[]
}

export interface SnapshotSuccess {
  ok: true
  unchanged: boolean
  project: SnapshotProject
  focus?: FocusState
  graph?: SnapshotGraph
}

export interface LiteratureEvidenceItem {
  id: string
  publicationRef: PublicationReference
  citation?: CitationSnapshot
  assertion: string
  locator: Locator
  direction: EvidenceDirection
  limitations?: string[]
  machineReviewRationale?: string
  reviewStatus: EvidenceReview
}

export interface LiteratureProjection {
  humanReviewed: LiteratureEvidenceItem[]
  machineReviewed: LiteratureEvidenceItem[]
  candidate: LiteratureEvidenceItem[]
  rejected: LiteratureEvidenceItem[]
  retrievalOnly: PublicationReference[]
}

export type EntityDocument =
  | {
      id: string
      type: 'question'
      question: string
      scopeAssumptions: string[]
      body: string
      framedEntityIds: string[]
      publicationCount: number
      machineReviewedEvidenceCount: number
      humanReviewedEvidenceCount: number
    }
  | {
      id: string
      type: 'framing_link'
      from: string
      to: string
      relation: 'frames'
    }
  | {
      id: string
      type: 'node'
      kind: NodeKind
      confidence: ConfidenceBand
      evidenceRefs: EvidenceRef[]
      /** @deprecated Use publicationCount. Retained for first-party bundle reload compatibility. */
      referenceCount: number
      /** @deprecated Use humanReviewedEvidenceCount. Retained for first-party bundle reload compatibility. */
      reviewedEvidenceCount: number
      publicationCount?: number
      machineReviewedEvidenceCount?: number
      humanReviewedEvidenceCount?: number
      literature?: LiteratureProjection
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
  | {
      id: string
      type: 'edge'
      from: string
      to: string
      relation: Relation
      basis: EdgeBasis
      evidenceRefs: EvidenceRef[]
      publicationRefs?: PublicationReference[]
      provenance?: string
      evidenceGap?: string
      literature?: LiteratureProjection
    }

export interface EntitySuccess {
  ok: true
  entity: EntityDocument
}

export interface FocusSuccess {
  ok: true
  focus: FocusState
}

export interface LaunchSuccess {
  ok: true
  url: string
}

export type LaunchResponse = LaunchSuccess | CompanionFailure
export type SnapshotResponse = SnapshotSuccess | CompanionFailure
export type EntityResponse = EntitySuccess | CompanionFailure
export type FocusResponse = FocusSuccess | CompanionFailure

/** Legacy v1 wire literals retained across first-party bundle reloads. */
export const RESEARCH_EXPANSION_REQUEST_WIRE_TYPE = 'simulate' as const
export const RESEARCH_EXPANSION_REJECTED_WIRE_CODE = 'SIMULATE_REJECTED' as const

export interface ResearchExpansionRequestMessage {
  type: typeof RESEARCH_EXPANSION_REQUEST_WIRE_TYPE
  nonce: string
  prompt: string
}

export interface ResearchExpansionAckMessage {
  type: 'ack'
  nonce: string
  status: 'started' | 'queued'
}

export interface ResearchExpansionErrorMessage {
  type: 'error'
  nonce: string
  code: 'SESSION_UNAVAILABLE' | typeof RESEARCH_EXPANSION_REJECTED_WIRE_CODE
}
