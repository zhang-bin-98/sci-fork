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
