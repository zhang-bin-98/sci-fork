import type {
  ConfidenceBand,
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
      type: 'node'
      kind: NodeKind
      confidence: ConfidenceBand
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
  relation: Relation
  source: 'edge' | 'evidence_ref'
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

export type EntityDocument =
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
      provenance?: string
      evidenceGap?: string
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

export interface SimulateRequestMessage {
  type: 'simulate'
  nonce: string
  prompt: string
}

export interface SimulateAckMessage {
  type: 'ack'
  nonce: string
  status: 'started' | 'queued'
}

export interface SimulateErrorMessage {
  type: 'error'
  nonce: string
  code: 'SESSION_UNAVAILABLE' | 'SIMULATE_REJECTED'
}
