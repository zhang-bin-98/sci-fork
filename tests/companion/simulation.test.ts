import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSimulationNonce,
  SimulationChannel,
  buildSimulationPrompt,
} from '../../src/companion/simulation.js'
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

describe('bounded simulation prompt', () => {
  it('includes the Focus, visible support and contradiction, Evidence Gaps, and scientific guardrails', () => {
    const prompt = buildSimulationPrompt(promptInput)
    const normalized = prompt.toLowerCase()

    expect(prompt).toContain('node_focus')
    expect(prompt).toContain('Blocking IL-6 may reduce the inflammatory phenotype.')
    expect(prompt).toContain('A reviewed cohort reported reduced inflammatory markers.')
    expect(prompt).toContain('The local assay showed no reduction after treatment.')
    expect(prompt).toContain('No randomized intervention study is available.')
    expect(normalized).toContain('simulation')
    expect(normalized).toContain('critique')
    expect(normalized).toContain('result')
    expect(normalized).toContain('interpretation')
    expect(normalized).toContain('hypotheses')
    expect(normalized).toContain('predictions')
    expect(normalized).toContain('ai_inference')
    expect(normalized).toContain('findings')
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

    const prompt = buildSimulationPrompt(huge)
    const normalized = prompt.toLowerCase()

    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(12 * 1024)
    expect(normalized).toContain('simulation')
    expect(normalized).toContain('critique')
    expect(normalized).toContain('result')
    expect(normalized).toContain('interpretation')
    expect(normalized).toContain('ai_inference')
    expect(normalized).toContain('findings')
  })
})

describe('simulation acknowledgement channel', () => {
  it('creates a 128-bit unpadded base64url nonce', () => {
    expect(createSimulationNonce()).toMatch(/^[A-Za-z0-9_-]{22}$/)
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
    const simulation = new SimulationChannel({ channel, createNonce })
    const prompt = 'Bounded prompt retained exactly.'

    simulation.simulate(prompt)
    expect(channel.posted).toEqual([
      { type: 'simulate', nonce: firstNonce, prompt },
    ])
    expect(simulation.getState()).toMatchObject({
      phase: 'pending',
      nonce: firstNonce,
      prompt,
    })

    vi.advanceTimersByTime(1_999)
    expect(simulation.getState()).toMatchObject({ phase: 'pending' })
    vi.advanceTimersByTime(1)
    expect(simulation.getState()).toMatchObject({
      phase: 'failed',
      reason: 'timeout',
      prompt,
    })
    expect(channel.posted).toHaveLength(1)

    simulation.retry()
    expect(channel.posted).toEqual([
      { type: 'simulate', nonce: firstNonce, prompt },
      { type: 'simulate', nonce: secondNonce, prompt },
    ])
    expect(simulation.getState()).toMatchObject({
      phase: 'pending',
      nonce: secondNonce,
      prompt,
    })

    channel.emit({ type: 'ack', nonce: firstNonce, status: 'started' })
    expect(simulation.getState()).toMatchObject({
      phase: 'pending',
      nonce: secondNonce,
    })

    channel.emit({ type: 'ack', nonce: secondNonce, status: 'queued' })
    expect(simulation.getState()).toMatchObject({
      phase: 'acknowledged',
      acknowledgement: 'queued',
      nonce: secondNonce,
      prompt,
    })
    vi.advanceTimersByTime(2_000)
    expect(simulation.getState()).toMatchObject({ phase: 'acknowledged' })

    simulation.dispose()
    expect(channel.listeners.size).toBe(0)
  })
})
