import { describe, expect, it } from 'vitest'
import {
  layoutGraph,
  selectLocalGraph,
} from '../../src/companion/graph.js'
import type { SnapshotGraph } from '../../src/shared/companion-contract.js'

const entities = [
  { id: 'node_a', type: 'node', kind: 'finding', confidence: 'high', label: 'A' },
  { id: 'node_b', type: 'node', kind: 'hypothesis', confidence: 'low', label: 'B' },
  { id: 'node_c', type: 'node', kind: 'prediction', confidence: 'moderate', label: 'C' },
  { id: 'node_d', type: 'node', kind: 'finding', confidence: 'moderate', label: 'D' },
  {
    id: 'node_e',
    type: 'result',
    status: 'validated',
    observedAt: '2026-08-30',
    label: 'E',
  },
  {
    id: 'node_path',
    type: 'result',
    status: 'draft',
    observedAt: '2026-08-29',
    label: 'Path',
  },
] satisfies SnapshotGraph['entities']

const edges = [
  { id: 'edge_ab', from: 'node_a', to: 'node_b', relation: 'supports', source: 'edge' },
  { id: 'edge_bc', from: 'node_b', to: 'node_c', relation: 'causes', source: 'edge' },
  {
    id: 'edge_cd',
    from: 'node_c',
    to: 'node_d',
    relation: 'associated_with',
    source: 'edge',
  },
  { id: 'edge_eb', from: 'node_e', to: 'node_b', relation: 'contradicts', source: 'edge' },
] satisfies SnapshotGraph['edges']

describe('local Companion graph', () => {
  it('selects the Focus, current path, and exactly the Focus one-hop neighborhood', () => {
    const selected = selectLocalGraph({
      entities,
      edges,
      focus: { focusEntityId: 'node_b', pathIds: ['node_path'] },
    })

    expect(selected.entities.map(({ id }) => id)).toEqual([
      'node_a',
      'node_b',
      'node_c',
      'node_e',
      'node_path',
    ])
    expect(selected.edges.map(({ id }) => id)).toEqual(['edge_ab', 'edge_bc', 'edge_eb'])
  })

  it('expands both endpoints and their one-hop relations for a stored edge Focus', () => {
    const selected = selectLocalGraph({
      entities,
      edges,
      focus: { focusEntityId: 'edge_bc', pathIds: [] },
    })

    expect(selected.entities.map(({ id }) => id)).toEqual([
      'node_a',
      'node_b',
      'node_c',
      'node_d',
      'node_e',
    ])
    expect(selected.edges.map(({ id }) => id)).toEqual([
      'edge_ab',
      'edge_bc',
      'edge_cd',
      'edge_eb',
    ])
  })

  it('produces the same finite local layout regardless of projection input order', () => {
    const selected = selectLocalGraph({
      entities,
      edges,
      focus: { focusEntityId: 'node_b', pathIds: ['node_path'] },
    })
    const reversed = {
      entities: [...selected.entities].reverse(),
      edges: [...selected.edges].reverse(),
    }

    const first = layoutGraph(selected)
    const second = layoutGraph(reversed)

    expect(second).toEqual(first)
    expect(first.nodes.map(({ id }) => id)).toEqual([
      'node_a',
      'node_b',
      'node_c',
      'node_e',
      'node_path',
    ])
    for (const node of first.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true)
      expect(Number.isFinite(node.position.y)).toBe(true)
    }
    expect(new Set(first.nodes.map(({ position }) => `${position.x}:${position.y}`)).size).toBe(
      first.nodes.length,
    )
  })
})
