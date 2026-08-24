import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/bridge/client.js'

interface SlotEntry {
  name: string
  id: string
  order?: number
  label?: string
}

interface Registration {
  entry: SlotEntry
  factory: () => ReactElement
}

interface ClickableProps {
  onClick(): void
}

function fakeContext(services: Record<string, unknown>): Context {
  return {
    get(name: string): unknown {
      return services[name]
    },
  } as unknown as Context
}

function captureRegistrations(services: Record<string, unknown>): {
  ctx: Context
  registrations: Registration[]
} {
  const registrations: Registration[] = []
  const slots = {
    register(entry: SlotEntry, factory: () => ReactElement): () => void {
      registrations.push({ entry, factory })
      return () => undefined
    },
  }
  return { ctx: fakeContext({ ...services, slots }), registrations }
}

function click(registration: Registration): void {
  const component = registration.factory()
  expect(typeof component.type).toBe('function')
  const button = (component.type as (props: unknown) => ReactElement)(component.props)
  expect(button.type).toBe('button')
  ;(button.props as ClickableProps).onClick()
}

describe('SciFork DSH bridge', () => {
  it('registers the Open and Simulate buttons in shell.overlay', () => {
    const { ctx, registrations } = captureRegistrations({})

    apply(ctx)

    expect(registrations.map(({ entry }) => entry)).toEqual([
      {
        name: 'shell.overlay',
        id: 'scifork-open',
        order: 100,
        label: 'Open Research Graph',
      },
      {
        name: 'shell.overlay',
        id: 'scifork-spike-simulate',
        order: 110,
        label: 'SciFork Spike: Simulate',
      },
    ])
  })

  it('uses the current Session at click time and submits through one scoped input', () => {
    let current = 'session-a'
    const scopeA = fakeContext({ id: 'session-a' })
    const scopeB = fakeContext({ id: 'session-b' })
    const scope = vi.fn((id: string) => (id === 'session-a' ? scopeA : scopeB))
    const setDraft = vi.fn()
    const submit = vi.fn()
    const input = { setDraft, submit }
    const inputFor = vi.fn(() => input)
    const sessions = {
      list: { getSnapshot: () => ({ current }) },
      scope,
    }
    const conversation = { input: { for: inputFor } }
    const { ctx, registrations } = captureRegistrations({ sessions, conversation })

    apply(ctx)
    current = 'session-b'
    expect(scope).not.toHaveBeenCalled()
    expect(inputFor).not.toHaveBeenCalled()

    const simulate = registrations.find(
      ({ entry }) => entry.id === 'scifork-spike-simulate',
    )
    expect(simulate).toBeDefined()
    click(simulate!)

    expect(scope).toHaveBeenCalledOnce()
    expect(scope).toHaveBeenCalledWith('session-b')
    expect(inputFor).toHaveBeenCalledOnce()
    expect(inputFor).toHaveBeenCalledWith(scopeB)
    expect(setDraft).toHaveBeenCalledOnce()
    expect(setDraft).toHaveBeenCalledWith(
      'SciFork M0 spike: verify scoped setDraft + submit.',
    )
    expect(submit).toHaveBeenCalledOnce()
    expect(setDraft.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[0]!)
  })

  it('does nothing when no Session is current', () => {
    const scope = vi.fn()
    const inputFor = vi.fn()
    const sessions = {
      list: { getSnapshot: () => ({}) },
      scope,
    }
    const conversation = { input: { for: inputFor } }
    const { ctx, registrations } = captureRegistrations({ sessions, conversation })

    apply(ctx)
    const simulate = registrations.find(
      ({ entry }) => entry.id === 'scifork-spike-simulate',
    )
    expect(simulate).toBeDefined()
    click(simulate!)

    expect(scope).not.toHaveBeenCalled()
    expect(inputFor).not.toHaveBeenCalled()
  })
})
