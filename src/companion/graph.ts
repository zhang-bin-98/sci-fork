import { Graph, layout } from '@dagrejs/dagre'
import type {
  FocusState,
  ProjectionEdgeSummary,
  ProjectionEntitySummary,
  SnapshotGraph,
} from '../shared/companion-contract.js'

export const GRAPH_NODE_WIDTH = 224
export const GRAPH_NODE_HEIGHT = 88

export interface LocalGraph extends SnapshotGraph {}

export interface LocalGraphInput extends SnapshotGraph {
  focus?: FocusState
}

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

export function selectLocalGraph(input: LocalGraphInput): LocalGraph {
  const entities = sortEntities(input.entities)
  const edges = sortEdges(input.edges)
  if (input.focus === undefined) return { entities, edges }

  const entityIds = new Set(entities.map(({ id }) => id))
  const edgeById = new Map(
    edges.flatMap((edge) => (edge.id === undefined ? [] : [[edge.id, edge] as const])),
  )
  const selectedEntities = new Set<string>()
  const selectedEdges = new Set<string>()

  const includeEntity = (id: string): void => {
    if (entityIds.has(id)) selectedEntities.add(id)
  }
  const includeEdge = (edge: ProjectionEdgeSummary): void => {
    selectedEdges.add(graphEdgeId(edge))
    includeEntity(edge.from)
    includeEntity(edge.to)
  }
  const includePathId = (id: string): void => {
    if (entityIds.has(id)) {
      includeEntity(id)
      return
    }
    const edge = edgeById.get(id)
    if (edge !== undefined) includeEdge(edge)
  }

  for (const id of input.focus.pathIds) includePathId(id)

  const focusEdge = edgeById.get(input.focus.focusEntityId)
  if (focusEdge !== undefined) {
    includeEdge(focusEdge)
    const endpoints = new Set([focusEdge.from, focusEdge.to])
    for (const edge of edges) {
      if (endpoints.has(edge.from) || endpoints.has(edge.to)) includeEdge(edge)
    }
  } else {
    includeEntity(input.focus.focusEntityId)
    for (const edge of edges) {
      if (
        edge.from === input.focus.focusEntityId ||
        edge.to === input.focus.focusEntityId
      ) {
        includeEdge(edge)
      }
    }
  }

  const localEntities = entities.filter(({ id }) => selectedEntities.has(id))
  const localEdges = edges.filter(
    (edge) =>
      selectedEdges.has(graphEdgeId(edge)) ||
      (selectedEntities.has(edge.from) && selectedEntities.has(edge.to)),
  )
  return { entities: localEntities, edges: localEdges }
}

function stableCoordinate(value: number): number {
  const rounded = Math.round(value * 1_000) / 1_000
  return Object.is(rounded, -0) ? 0 : rounded
}

export function layoutGraph(
  graph: SnapshotGraph,
  direction: 'LR' | 'TB' = 'LR',
): GraphLayout {
  const entities = sortEntities(graph.entities)
  const edges = sortEdges(graph.edges)
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

  for (const entity of entities) {
    dagre.setNode(entity.id, {
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT,
    })
  }
  for (const edge of edges) {
    dagre.setEdge(edge.from, edge.to, {}, graphEdgeId(edge))
  }
  layout(dagre)

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
