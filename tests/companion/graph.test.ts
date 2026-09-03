import { describe, expect, it } from 'vitest'
import {
  evidenceVisibilityGraph,
  focusViewportCenter,
  graphDirectionForViewport,
  layoutGraph,
  selectGraphView,
} from '../../src/companion/graph.js'
import type { SnapshotGraph } from '../../src/shared/companion-contract.js'

const entities = [
  { id: 'node_a', type: 'node', kind: 'finding', confidence: 'high', referenceCount: 1, reviewedEvidenceCount: 1, publicationCount: 1, machineReviewedEvidenceCount: 0, humanReviewedEvidenceCount: 1, label: 'A' },
  { id: 'node_b', type: 'node', kind: 'hypothesis', confidence: 'low', referenceCount: 2, reviewedEvidenceCount: 0, publicationCount: 2, machineReviewedEvidenceCount: 0, humanReviewedEvidenceCount: 0, label: 'B' },
  { id: 'node_c', type: 'node', kind: 'prediction', confidence: 'moderate', referenceCount: 1, reviewedEvidenceCount: 0, publicationCount: 1, machineReviewedEvidenceCount: 0, humanReviewedEvidenceCount: 0, label: 'C' },
  { id: 'node_d', type: 'node', kind: 'finding', confidence: 'moderate', referenceCount: 1, reviewedEvidenceCount: 1, publicationCount: 1, machineReviewedEvidenceCount: 0, humanReviewedEvidenceCount: 1, label: 'D' },
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
  it('hides Evidence entities and their projection edges unless explicitly shown', () => {
    const graph = {
      entities: [
        entities[1]!,
        {
          id: 'ev_hidden',
          type: 'evidence' as const,
          direction: 'supports' as const,
          reviewStatus: 'machine_reviewed' as const,
          label: 'Abstract-grounded assertion',
        },
      ],
      edges: [
        {
          id: 'ev_hidden->node_b',
          from: 'ev_hidden',
          to: 'node_b',
          relation: 'supports' as const,
          source: 'evidence_ref' as const,
        },
      ],
    } satisfies SnapshotGraph

    expect(evidenceVisibilityGraph(graph, 'hidden')).toEqual({
      entities: [entities[1]],
      edges: [],
    })
    expect(evidenceVisibilityGraph(graph, 'all')).toBe(graph)
  })

  it('shows only the focused Node evidence while retaining the non-Evidence graph', () => {
    const graph = {
      entities: [
        entities[0]!,
        entities[1]!,
        {
          id: 'ev_a',
          type: 'evidence' as const,
          direction: 'supports' as const,
          reviewStatus: 'reviewed' as const,
          label: 'Evidence A',
        },
        {
          id: 'ev_b',
          type: 'evidence' as const,
          direction: 'supports' as const,
          reviewStatus: 'machine_reviewed' as const,
          label: 'Evidence B',
        },
      ],
      edges: [
        edges[0]!,
        { from: 'ev_a', to: 'node_a', relation: 'supports' as const, source: 'evidence_ref' as const },
        { from: 'ev_b', to: 'node_b', relation: 'supports' as const, source: 'evidence_ref' as const },
      ],
    } satisfies SnapshotGraph

    expect(evidenceVisibilityGraph(graph, 'focused-node', 'node_a')).toEqual({
      entities: [entities[0], entities[1], graph.entities[2]],
      edges: [graph.edges[0], graph.edges[1]],
    })
    expect(evidenceVisibilityGraph(graph, 'focused-node', 'node_missing')).toEqual({
      entities: [entities[0], entities[1]],
      edges: [graph.edges[0]],
    })
    expect(evidenceVisibilityGraph(graph, 'focused-node', 'ev_a')).toEqual({
      entities: [entities[0], entities[1]],
      edges: [graph.edges[0]],
    })
  })

  it('maps viewport width mode to the documented graph direction', () => {
    expect(graphDirectionForViewport(false)).toBe('TB')
    expect(graphDirectionForViewport(true)).toBe('LR')
  })

  it('keeps the complete projection visible when Focus changes', () => {
    const selected = selectGraphView({
      entities,
      edges,
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

  it('places an edge target after its source in both responsive directions', () => {
    const graph = {
      entities: [entities[0]!, entities[1]!],
      edges: [edges[0]!],
    } satisfies SnapshotGraph
    const wide = layoutGraph(graph, 'LR')
    const narrow = layoutGraph(graph, 'TB')
    const wideSource = wide.nodes.find(({ id }) => id === 'node_a')!
    const wideTarget = wide.nodes.find(({ id }) => id === 'node_b')!
    const narrowSource = narrow.nodes.find(({ id }) => id === 'node_a')!
    const narrowTarget = narrow.nodes.find(({ id }) => id === 'node_b')!

    expect(wideSource.position.x).toBeLessThan(wideTarget.position.x)
    expect(narrowSource.position.y).toBeLessThan(narrowTarget.position.y)
  })

  it('inserts a visible Evidence rank immediately upstream of its claim', () => {
    const graph = {
      entities: [
        entities[0]!,
        entities[1]!,
        {
          id: 'ev_b',
          type: 'evidence' as const,
          direction: 'supports' as const,
          reviewStatus: 'machine_reviewed' as const,
          label: 'Evidence for B',
        },
      ],
      edges: [
        { from: 'node_a', to: 'node_b', relation: 'supports' as const, source: 'edge' as const },
        { from: 'ev_b', to: 'node_b', relation: 'supports' as const, source: 'evidence_ref' as const },
      ],
    } satisfies SnapshotGraph

    const wide = layoutGraph(graph, 'LR')
    const narrow = layoutGraph(graph, 'TB')
    const widePosition = new Map(wide.nodes.map(({ id, position }) => [id, position]))
    const narrowPosition = new Map(narrow.nodes.map(({ id, position }) => [id, position]))

    expect(widePosition.get('node_a')!.x).toBeLessThan(widePosition.get('ev_b')!.x)
    expect(widePosition.get('ev_b')!.x).toBeLessThan(widePosition.get('node_b')!.x)
    expect(narrowPosition.get('node_a')!.y).toBeLessThan(narrowPosition.get('ev_b')!.y)
    expect(narrowPosition.get('ev_b')!.y).toBeLessThan(narrowPosition.get('node_b')!.y)
  })

  it('keeps a visible Evidence layer separate from unrelated Hypotheses', () => {
    const graph = {
      entities: [
        entities[0]!,
        entities[1]!,
        entities[4]!,
        {
          id: 'node_hypothesis_unrelated',
          type: 'node' as const,
          kind: 'hypothesis' as const,
          confidence: 'low' as const,
          referenceCount: 0,
          reviewedEvidenceCount: 0,
          publicationCount: 0,
          machineReviewedEvidenceCount: 0,
          humanReviewedEvidenceCount: 0,
          label: 'Unrelated hypothesis',
        },
        {
          id: 'ev_b',
          type: 'evidence' as const,
          direction: 'supports' as const,
          reviewStatus: 'machine_reviewed' as const,
          label: 'Evidence for B',
        },
      ],
      edges: [
        { from: 'node_a', to: 'node_b', relation: 'supports' as const, source: 'edge' as const },
        { from: 'ev_b', to: 'node_b', relation: 'supports' as const, source: 'evidence_ref' as const },
        {
          from: 'node_e',
          to: 'node_hypothesis_unrelated',
          relation: 'causes' as const,
          source: 'edge' as const,
        },
      ],
    } satisfies SnapshotGraph

    const wide = layoutGraph(graph, 'LR')
    const narrow = layoutGraph(graph, 'TB')
    const wideEvidence = wide.nodes.find(({ id }) => id === 'ev_b')!
    const narrowEvidence = narrow.nodes.find(({ id }) => id === 'ev_b')!

    expect(wide.nodes.filter(({ id }) => id !== 'ev_b').every(({ position }) => position.x !== wideEvidence.position.x)).toBe(true)
    expect(narrow.nodes.filter(({ id }) => id !== 'ev_b').every(({ position }) => position.y !== narrowEvidence.position.y)).toBe(true)
  })

  it('produces the same finite global layout regardless of projection input order', () => {
    const selected = selectGraphView({
      entities,
      edges,
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
