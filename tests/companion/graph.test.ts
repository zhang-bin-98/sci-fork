import { describe, expect, it } from 'vitest'
import {
  focusViewportCenter,
  layoutGraph,
  selectFocusNeighborhood,
  selectGraphView,
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

describe('Companion graph', () => {
  it('keeps the complete projection visible when Focus changes', () => {
    const selected = selectGraphView({
      entities,
      edges,
      focus: { focusEntityId: 'node_b', pathIds: ['node_path'] },
    })

    expect(selected.entities.map(({ id }) => id)).toEqual([
      'node_a',
      'node_b',
      'node_c',
      'node_d',
      'node_e',
      'node_path',
    ])
    expect(selected.edges.map(({ id }) => id)).toEqual([
      'edge_ab',
      'edge_bc',
      'edge_cd',
      'edge_eb',
    ])
  })

  it('selects the Focus, current path, and one-hop neighborhood only for bounded model context', () => {
    const selected = selectFocusNeighborhood({
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

  it('expands both endpoints and their one-hop relations for a stored edge model context', () => {
    const selected = selectFocusNeighborhood({
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

  it('resolves entity centers and stored edge midpoints without changing zoom', () => {
    const laidOut = layoutGraph({ entities, edges })
    const nodeB = laidOut.nodes.find(({ id }) => id === 'node_b')!
    const nodeC = laidOut.nodes.find(({ id }) => id === 'node_c')!
    const centerB = {
      x: nodeB.position.x + 112,
      y: nodeB.position.y + 44,
    }
    const centerC = {
      x: nodeC.position.x + 112,
      y: nodeC.position.y + 44,
    }

    expect(focusViewportCenter(laidOut, 'node_b')).toEqual(centerB)
    expect(focusViewportCenter(laidOut, 'edge_bc')).toEqual({
      x: (centerB.x + centerC.x) / 2,
      y: (centerB.y + centerC.y) / 2,
    })
    expect(focusViewportCenter(laidOut, 'node_missing')).toBeUndefined()
  })

  it('produces the same finite global layout regardless of projection input order', () => {
    const selected = selectGraphView({
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
      'node_d',
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
