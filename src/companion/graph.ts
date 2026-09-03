import { Graph, layout } from '@dagrejs/dagre'
import type {
  ProjectionEdgeSummary,
  ProjectionEntitySummary,
  SnapshotGraph,
} from '../shared/companion-contract.js'

export const GRAPH_NODE_WIDTH = 224
export const GRAPH_NODE_HEIGHT = 88

export interface LayoutNode {
  id: string
  position: { x: number; y: number }
  data: { entity: ProjectionEntitySummary }
  type: 'entity'
}

export interface LayoutEdge {
  id: string
  source: string
  target: string
  label: string
  data: { edge: ProjectionEdgeSummary }
}

export interface GraphLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
}

export type EvidenceVisibility = 'hidden' | 'focused-node' | 'all'

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function graphEdgeId(edge: ProjectionEdgeSummary): string {
  return edge.id ?? [edge.source, edge.from, edge.relation, edge.to].join(':')
}

function sortEntities(
  entities: readonly ProjectionEntitySummary[],
): ProjectionEntitySummary[] {
  return [...entities].sort((left, right) => compareText(left.id, right.id))
}

function sortEdges(edges: readonly ProjectionEdgeSummary[]): ProjectionEdgeSummary[] {
  return [...edges].sort((left, right) =>
    compareText(graphEdgeId(left), graphEdgeId(right)),
  )
}

export function selectGraphView(input: SnapshotGraph): SnapshotGraph {
  return {
    entities: sortEntities(input.entities),
    edges: sortEdges(input.edges),
  }
}

export function evidenceVisibilityGraph(
  input: SnapshotGraph,
  visibility: EvidenceVisibility,
  focusEntityId?: string,
): SnapshotGraph {
  if (visibility === 'all') return input
  const visibleEvidenceIds = new Set<string>()
  if (visibility === 'focused-node' && focusEntityId !== undefined) {
    for (const edge of input.edges) {
      if (edge.source === 'evidence_ref' && edge.to === focusEntityId) {
        visibleEvidenceIds.add(edge.from)
      }
    }
  }
  const retainedEntityIds = new Set(
    input.entities
      .filter((entity) => entity.type !== 'evidence' || visibleEvidenceIds.has(entity.id))
      .map((entity) => entity.id),
  )
  return {
    entities: input.entities.filter((entity) => retainedEntityIds.has(entity.id)),
    edges: input.edges.filter(
      (edge) => retainedEntityIds.has(edge.from) && retainedEntityIds.has(edge.to),
    ),
  }
}

export function graphDirectionForViewport(wide: boolean): 'LR' | 'TB' {
  return wide ? 'LR' : 'TB'
}

function stableCoordinate(value: number): number {
  const rounded = Math.round(value * 1_000) / 1_000
  return Object.is(rounded, -0) ? 0 : rounded
}

interface LayoutConstraint {
  from: string
  to: string
  id: string
  minlen?: number
}

function layoutDagre(
  entities: readonly ProjectionEntitySummary[],
  edges: readonly ProjectionEdgeSummary[],
  constraints: readonly LayoutConstraint[],
  barrierIds: readonly string[],
  direction: 'LR' | 'TB',
): Graph {
  const dagre = new Graph({ directed: true, multigraph: true })
  dagre.setGraph({
    rankdir: direction,
    ranker: 'network-simplex',
    nodesep: direction === 'TB' ? 24 : 48,
    edgesep: 24,
    ranksep: direction === 'TB' ? 56 : 88,
    marginx: 24,
    marginy: 24,
  })
  dagre.setDefaultEdgeLabel(() => ({}))

  const evidenceTargets = new Set(
    edges.filter(({ source }) => source === 'evidence_ref').map(({ to }) => to),
  )
  for (const entity of entities) {
    dagre.setNode(entity.id, {
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
    })
  }
  for (const id of barrierIds) dagre.setNode(id, { width: 0, height: 0 })
  for (const edge of edges) {
    const spansEvidenceLayer =
      edge.source !== 'evidence_ref' && evidenceTargets.has(edge.to)
    dagre.setEdge(
      edge.from,
      edge.to,
      spansEvidenceLayer ? { minlen: 2 } : {},
      graphEdgeId(edge),
    )
  }
  for (const constraint of constraints) {
    dagre.setEdge(
      constraint.from,
      constraint.to,
      constraint.minlen === undefined ? {} : { minlen: constraint.minlen },
      constraint.id,
    )
  }
  layout(dagre)
  return dagre
}

export function layoutGraph(
  graph: SnapshotGraph,
  direction: 'LR' | 'TB' = 'LR',
): GraphLayout {
  const entities = sortEntities(graph.entities)
  const edges = sortEdges(graph.edges)
  const evidenceIds = new Set(
    entities.filter(({ type }) => type === 'evidence').map(({ id }) => id),
  )
  let dagre = layoutDagre(entities, edges, [], [], direction)
  const rankGroups = new Map<number, { evidence: string[]; other: string[] }>()
  for (const entity of entities) {
    const rank = dagre.node(entity.id)?.rank
    if (rank === undefined) continue
    const group = rankGroups.get(rank) ?? { evidence: [], other: [] }
    if (evidenceIds.has(entity.id)) group.evidence.push(entity.id)
    else group.other.push(entity.id)
    rankGroups.set(rank, group)
  }

  const barriers: string[] = []
  const constraints: LayoutConstraint[] = []
  const entityIds = new Set(entities.map(({ id }) => id))
  for (const [rank, group] of rankGroups) {
    if (group.evidence.length === 0 || group.other.length === 0) continue
    let barrier = `__scifork_evidence_layer__:${rank}`
    let suffix = 1
    while (entityIds.has(barrier) || barriers.includes(barrier)) {
      barrier = `__scifork_evidence_layer__:${rank}:${suffix}`
      suffix += 1
    }
    barriers.push(barrier)
    for (const other of group.other) {
      constraints.push({
        from: other,
        to: barrier,
        id: `${barrier}:from:${other}`,
        minlen: 1,
      })
    }
    for (const evidence of group.evidence) {
      constraints.push({
        from: barrier,
        to: evidence,
        id: `${barrier}:to:${evidence}`,
        minlen: 1,
      })
    }
  }
  if (constraints.length > 0) dagre = layoutDagre(entities, edges, constraints, barriers, direction)

  return {
    nodes: entities.map((entity) => {
      const positioned = dagre.node(entity.id)
      return {
        id: entity.id,
        type: 'entity',
        position: {
          x: stableCoordinate((positioned.x ?? 0) - GRAPH_NODE_WIDTH / 2),
          y: stableCoordinate((positioned.y ?? 0) - GRAPH_NODE_HEIGHT / 2),
        },
        data: { entity },
      }
    }),
    edges: edges.map((edge) => ({
      id: graphEdgeId(edge),
      source: edge.from,
      target: edge.to,
      label: edge.relation.replace('_', ' '),
      data: { edge },
    })),
  }
}

export function focusViewportCenter(
  graph: GraphLayout,
  focusEntityId: string,
): { x: number; y: number } | undefined {
  const centers = new Map(
    graph.nodes.map((node) => [
      node.id,
      {
        x: node.position.x + GRAPH_NODE_WIDTH / 2,
        y: node.position.y + GRAPH_NODE_HEIGHT / 2,
      },
    ] as const),
  )
  const entityCenter = centers.get(focusEntityId)
  if (entityCenter !== undefined) return entityCenter

  const edge = graph.edges.find(({ data }) => data.edge.id === focusEntityId)
  if (edge === undefined) return undefined
  const source = centers.get(edge.source)
  const target = centers.get(edge.target)
  if (source === undefined || target === undefined) return undefined
  return {
    x: stableCoordinate((source.x + target.x) / 2),
    y: stableCoordinate((source.y + target.y) / 2),
  }
}
