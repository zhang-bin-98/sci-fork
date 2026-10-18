import { describe, expect, it, vi } from 'vitest'
import {
  RESEARCH_EXPANSION_ACTION_LABEL,
  RESEARCH_EXPANSION_PROMPT_LIMIT,
  ResearchExpansionSubmitter,
  buildResearchExpansionPrompt,
} from '../../src/companion/research-expansion.js'
import type { SnapshotGraph } from '../../src/shared/companion-contract.js'

const graph: SnapshotGraph = {
  entities: [
    {
      id: 'node_x',
      type: 'node',
      kind: 'hypothesis',
      confidence: 'low',
      publicationCount: 1,
      machineReviewedEvidenceCount: 1,
      humanReviewedEvidenceCount: 0,
      label: 'Senescent osteocytes drive bone marrow adiposity',
    },
  ],
  edges: [],
}

describe('buildResearchExpansionPrompt', () => {
  it('carries the focus summary and the full authorization boundary', () => {
    const prompt = buildResearchExpansionPrompt({
      focusEntityId: 'node_x',
      entities: graph.entities,
      edges: graph.edges,
    })

    expect(prompt).toContain('Focus')
    expect(prompt).toContain('node_x')
    expect(prompt).toContain('Senescent osteocytes drive bone marrow adiposity')
    expect(prompt).toContain('zero to five direct branches at depth one')
    expect(prompt).toContain('Focus remains unchanged. Do not recurse.')
    expect(prompt).toContain('machine-reviewed Evidence')
    expect(prompt).toContain('Never create or promote a Finding')
    expect(prompt).toContain('dsh-pubmed')
    expect(prompt).toContain('harness web search')
    expect(prompt).toContain('scifork-research')
  })

  it('does not restate the skill workflow detail (single source of truth)', () => {
    const prompt = buildResearchExpansionPrompt({
      focusEntityId: 'node_x',
      entities: graph.entities,
      edges: graph.edges,
    })

    expect(prompt).not.toContain('bold summary sentence')
    expect(prompt).not.toContain('create_evidence_assertion')
    expect(prompt).not.toContain('create_node')
    expect(prompt).not.toContain('publicationRefs')
    expect(prompt).not.toContain('never reverse these endpoints')
  })

  it('stays within the byte limit and truncates only the focus context', () => {
    const entities = [
      {
        ...graph.entities[0]!,
        label: 'L'.repeat(8 * 1024),
      },
    ]
    const prompt = buildResearchExpansionPrompt({
      focusEntityId: 'node_x',
      entities,
      edges: graph.edges,
    })
    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(
      RESEARCH_EXPANSION_PROMPT_LIMIT,
    )
    expect(prompt).toContain('[Visible context truncated]')
    expect(prompt).toContain('zero to five direct branches')
  })
})

describe('ResearchExpansionSubmitter', () => {
  it('resolves to idle on completion and reports failures with codes', async () => {
    const states: string[] = []
    const submit = vi.fn(async () => undefined)
    const submitter = new ResearchExpansionSubmitter({
      submit,
      onStateChange: (state) => states.push(state.phase),
    })

    submitter.submit('bounded prompt')
    expect(submitter.getState()).toEqual({ phase: 'pending', prompt: 'bounded prompt' })
    expect(submit).toHaveBeenCalledWith('bounded prompt')
    await vi.waitFor(() => expect(submitter.getState()).toEqual({ phase: 'idle' }))
    expect(states).toEqual(['pending', 'idle'])
  })

  it('maps rejection messages to bounded failure codes', async () => {
    const submit = vi.fn(async () => {
      throw new Error('SESSION_UNAVAILABLE')
    })
    const submitter = new ResearchExpansionSubmitter({ submit })

    submitter.submit('bounded prompt')
    await vi.waitFor(() =>
      expect(submitter.getState()).toEqual({
        phase: 'failed',
        prompt: 'bounded prompt',
        reason: 'SESSION_UNAVAILABLE',
      }),
    )
  })

  it('rejects oversized prompts before submitting', () => {
    const submit = vi.fn(async () => undefined)
    const submitter = new ResearchExpansionSubmitter({ submit })

    submitter.submit('x'.repeat(RESEARCH_EXPANSION_PROMPT_LIMIT + 1))
    expect(submitter.getState()).toMatchObject({ phase: 'failed', reason: 'prompt_too_large' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('retries the stored failed prompt', async () => {
    let calls = 0
    const submit = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('RESEARCH_EXPANSION_REJECTED')
    })
    const submitter = new ResearchExpansionSubmitter({ submit })

    submitter.submit('bounded prompt')
    await vi.waitFor(() =>
      expect(submitter.getState()).toMatchObject({ phase: 'failed' }),
    )
    submitter.retry()
    expect(submit).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(submitter.getState()).toEqual({ phase: 'idle' }))
  })

  it('keeps the action label exported for UI labels', () => {
    expect(RESEARCH_EXPANSION_ACTION_LABEL).toBe('Research & Expand')
  })
})
