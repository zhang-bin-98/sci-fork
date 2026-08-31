import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createResearchExpansionNonce,
  RESEARCH_EXPANSION_ACTION_LABEL,
  ResearchExpansionChannel,
  buildResearchExpansionPrompt,
} from '../../src/companion/research-expansion.js'
import type { SnapshotGraph } from '../../src/shared/companion-contract.js'

class FakeChannel {
  readonly posted: unknown[] = []
  readonly listeners = new Set<(event: { data: unknown }) => void>()

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listeners.add(listener)
  }

  removeEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listeners.delete(listener)
  }

  emit(data: unknown): void {
    for (const listener of this.listeners) listener({ data })
  }
}

const promptInput = {
  focusEntityId: 'node_focus',
  entities: [
    {
      id: 'node_focus',
      type: 'node' as const,
      kind: 'hypothesis' as const,
      confidence: 'low' as const,
      referenceCount: 0,
      reviewedEvidenceCount: 0,
      label: 'Blocking IL-6 may reduce the inflammatory phenotype.',
    },
    {
      id: 'ev_support',
      type: 'evidence' as const,
      direction: 'supports' as const,
      reviewStatus: 'reviewed' as const,
      label: 'A reviewed cohort reported reduced inflammatory markers.',
    },
    {
      id: 'res_against',
      type: 'result' as const,
      status: 'validated' as const,
      observedAt: '2026-08-30',
      label: 'The local assay showed no reduction after treatment.',
    },
  ] satisfies SnapshotGraph['entities'],
  edges: [
    {
      id: 'edge_support',
      from: 'ev_support',
      to: 'node_focus',
      relation: 'supports' as const,
      source: 'edge' as const,
      basis: 'literature' as const,
      evidenceGap: 'No randomized intervention study is available.',
    },
    {
      id: 'edge_against',
      from: 'res_against',
      to: 'node_focus',
      relation: 'contradicts' as const,
      source: 'edge' as const,
      basis: 'experiment' as const,
    },
  ] satisfies SnapshotGraph['edges'],
}

afterEach(() => {
  vi.useRealTimers()
})

describe('literature-grounded research expansion prompt', () => {
  it('authorizes one objective-led retrieval and connected expansion step without preloading the neighborhood', () => {
    const prompt = buildResearchExpansionPrompt(promptInput)
    const normalized = prompt.toLowerCase()

    expect(RESEARCH_EXPANSION_ACTION_LABEL).toBe('Research & Expand')
    expect(prompt).toContain('node_focus')
    expect(prompt).toContain('Blocking IL-6 may reduce the inflammatory phenotype.')
    expect(prompt).not.toContain('Focus-neighborhood')
    expect(prompt).not.toContain('A reviewed cohort reported reduced inflammatory markers.')
    expect(prompt).not.toContain('The local assay showed no reduction after treatment.')
    expect(prompt).not.toContain('No randomized intervention study is available.')
    expect(normalized).not.toContain('simulation')
    expect(normalized).toContain('research expansion step')
    expect(normalized).toContain('current chat objective')
    expect(normalized).toContain('pubmed-search')
    expect(normalized).toContain('search')
    expect(normalized).toContain('lookup')
    expect(normalized).toContain('scifork-research')
    expect(normalized).toContain('neighbors')
    expect(normalized).toContain('incoming')
    expect(normalized).toContain('outgoing')
    expect(normalized).toContain('result')
    expect(normalized).toContain('interpretation')
    expect(normalized).toContain('ai_inference')
    expect(normalized).toContain('finding')
    expect(normalized).toContain('authorizes')
    expect(normalized).toContain('zero to five')
    expect(normalized).toContain('five')
    expect(normalized).toContain('depth one')
    expect(normalized).toContain('confidence: low')
    expect(normalized).toContain('create_node')
    expect(normalized).toContain('create_edge')
    expect(normalized).toContain('create_evidence_assertion')
    expect(normalized).toContain('machine_reviewed')
    expect(normalized).toContain('create_framing_link')
    expect(normalized).toContain('research question')
    expect(normalized).toContain('actual retrieved abstract')
    expect(normalized).toContain('title-only')
    expect(normalized).toContain('machinereviewrationale')
    expect(normalized).toContain('never write authors')
    expect(normalized).toContain('pdf')
    expect(normalized).toContain('raw provider output')
    expect(normalized).toContain('publicationrefs')
    expect(normalized).toContain('focus remains unchanged')
    expect(normalized).toContain('do not recurse')
    expect(normalized).toContain('progressive research run')
    expect(normalized).toContain('not authorized')
  })

  it('preserves the task and scientific guardrails within the 12 KiB UTF-8 cap', () => {
    const huge = {
      ...promptInput,
      entities: promptInput.entities.map((entity) => ({
        ...entity,
        label: `${entity.label} ${'测'.repeat(20_000)}`,
      })),
      edges: promptInput.edges.map((edge) => ({
        ...edge,
        evidenceGap: `${edge.evidenceGap ?? ''} ${'缺'.repeat(20_000)}`,
      })),
    }

    const prompt = buildResearchExpansionPrompt(huge)
    const normalized = prompt.toLowerCase()

    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(12 * 1024)
    expect(normalized).toContain('research expansion step')
    expect(normalized).toContain('current chat objective')
    expect(normalized).toContain('pubmed-search')
    expect(normalized).toContain('lookup')
    expect(normalized).toContain('neighbors')
    expect(normalized).toContain('result')
    expect(normalized).toContain('interpretation')
    expect(normalized).toContain('ai_inference')
    expect(normalized).toContain('finding')
    expect(normalized).toContain('zero to five')
    expect(normalized).toContain('five')
    expect(normalized).toContain('create_node')
    expect(normalized).toContain('create_edge')
    expect(normalized).toContain('create_evidence_assertion')
    expect(normalized).toContain('machine_reviewed')
    expect(normalized).toContain('create_framing_link')
    expect(normalized).toContain('title-only')
    expect(normalized).toContain('never write authors')
    expect(normalized).toContain('publicationrefs')
    expect(normalized).toContain('focus remains unchanged')
    expect(normalized).toContain('do not recurse')
  })
})

describe('research expansion acknowledgement channel', () => {
  it('creates a 128-bit unpadded base64url nonce', () => {
    expect(createResearchExpansionNonce()).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('retains the prompt after timeout and retries only on demand with a new nonce', () => {
    vi.useFakeTimers()
    const channel = new FakeChannel()
    const firstNonce = 'a'.repeat(22)
    const secondNonce = 'b'.repeat(22)
    const createNonce = vi
      .fn<() => string>()
      .mockReturnValueOnce(firstNonce)
      .mockReturnValueOnce(secondNonce)
    const researchExpansion = new ResearchExpansionChannel({ channel, createNonce })
    const prompt = 'Bounded prompt retained exactly.'

    researchExpansion.submit(prompt)
    expect(channel.posted).toEqual([
      { type: 'simulate', nonce: firstNonce, prompt },
    ])
    expect(researchExpansion.getState()).toMatchObject({
      phase: 'pending',
      nonce: firstNonce,
      prompt,
    })

    vi.advanceTimersByTime(1_999)
    expect(researchExpansion.getState()).toMatchObject({ phase: 'pending' })
    vi.advanceTimersByTime(1)
    expect(researchExpansion.getState()).toMatchObject({
      phase: 'failed',
      reason: 'timeout',
      prompt,
    })
    expect(channel.posted).toHaveLength(1)

    researchExpansion.retry()
    expect(channel.posted).toEqual([
      { type: 'simulate', nonce: firstNonce, prompt },
      { type: 'simulate', nonce: secondNonce, prompt },
    ])
    expect(researchExpansion.getState()).toMatchObject({
      phase: 'pending',
      nonce: secondNonce,
      prompt,
    })

    channel.emit({ type: 'ack', nonce: firstNonce, status: 'started' })
    expect(researchExpansion.getState()).toMatchObject({
      phase: 'pending',
      nonce: secondNonce,
    })

    channel.emit({ type: 'ack', nonce: secondNonce, status: 'queued' })
    expect(researchExpansion.getState()).toMatchObject({
      phase: 'acknowledged',
      acknowledgement: 'queued',
      nonce: secondNonce,
      prompt,
    })
    vi.advanceTimersByTime(2_000)
    expect(researchExpansion.getState()).toMatchObject({ phase: 'acknowledged' })

    researchExpansion.dispose()
    expect(channel.listeners.size).toBe(0)
  })
})
