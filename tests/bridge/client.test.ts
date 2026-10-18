import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply, createBridge, type Bridge } from '../../src/bridge/client.js'

interface FooterRegistration {
  entry: { name: string; id: string; order?: number; label?: string }
  factory: (props: { wide: boolean }) => ReactElement
}

interface TabBodyRegistration {
  entry: { name: 'sidebar.right.pane.tab'; key: string }
  factory: () => ReactElement
}

interface TabDefinitionCapture {
  id: string
  kind: string
  keepMounted?: boolean
  title: () => string
  guide?: ReadonlyArray<{ id: string; order: number }>
}

interface SessionSnapshot {
  current?: string
  byId: Record<string, { running: boolean }>
}

const PAGE_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const PROMPT = 'Use this exact, bounded research expansion prompt.'

interface SessionInputCapture {
  setDraft: ReturnType<typeof vi.fn>
  submit: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
}

function makeHarness(): {
  ctx: Context
  injectedKeys: string[]
  footer: FooterRegistration[]
  tabBodies: TabBodyRegistration[]
  tabDefinition: () => TabDefinitionCapture | undefined
  openTab: ReturnType<typeof vi.fn>
  sessions: {
    snapshot: SessionSnapshot
    scopes: Map<string, Context>
  }
  inputs: Map<Context, SessionInputCapture>
  dispose(): void
} {
  const injectedKeys: string[] = []
  const footer: FooterRegistration[] = []
  const tabBodies: TabBodyRegistration[] = []
  const disposers: Array<() => void> = []
  let definition: TabDefinitionCapture | undefined
  const openTab = vi.fn()

  const snapshot: SessionSnapshot = { current: 'session-1', byId: { 'session-1': { running: false } } }
  const scopes = new Map<string, Context>()
  const inputs = new Map<Context, SessionInputCapture>()

  interface SlotsMock {
    inject(key: string, callback: () => () => void): () => void
    register(entry: FooterRegistration['entry'], factory: FooterRegistration['factory']): () => void
    register(entry: TabBodyRegistration['entry'], factory: TabBodyRegistration['factory']): () => void
  }
  const slots: SlotsMock = {
    inject(key: string, callback: () => () => void): () => void {
      injectedKeys.push(key)
      const disposer = callback()
      disposers.push(disposer)
      return disposer
    },
    register(
      entry: FooterRegistration['entry'] | TabBodyRegistration['entry'],
      factory: unknown,
    ): () => void {
      if ((entry as TabBodyRegistration['entry']).key !== undefined) {
        tabBodies.push({
          entry: entry as TabBodyRegistration['entry'],
          factory: factory as TabBodyRegistration['factory'],
        })
      } else {
        footer.push({
          entry: entry as FooterRegistration['entry'],
          factory: factory as FooterRegistration['factory'],
        })
      }
      return () => undefined
    },
  }
  const services: Record<string, unknown> = {
    slots,
    sessions: {
      list: { getSnapshot: () => snapshot },
      scope(id: string) {
        return scopes.get(id)
      },
    },
    conversation: {
      input: {
        for(actx: Context): SessionInputCapture {
          const existing = inputs.get(actx)
          if (existing !== undefined) return existing
          const capture: SessionInputCapture = {
            setDraft: vi.fn(),
            submit: vi.fn(),
            notify: vi.fn(),
          }
          inputs.set(actx, capture)
          return capture
        },
      },
    },
    sidebarRightTabs: {
      register(def: TabDefinitionCapture): () => void {
        definition = def
        return () => undefined
      },
    },
    sidebarRight: { openTab },
  }
  const ctx = {
    get(name: string): unknown {
      return services[name]
    },
    effect(callback: () => void | (() => void)): void | (() => void) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    inject(_keys: readonly string[], callback: () => void): void {
      callback()
    },
  } as unknown as Context
  return {
    ctx,
    injectedKeys,
    footer,
    tabBodies,
    tabDefinition: () => definition,
    openTab,
    sessions: { snapshot, scopes },
    inputs,
    dispose(): void {
      for (const disposer of disposers.reverse()) disposer()
    },
  }
}

function scopeContext(name: string): Context {
  return { name } as unknown as Context
}

function launchFetch(pageKey: string, failures = 0): ReturnType<typeof vi.fn> {
  let calls = 0
  return vi.fn(async () => {
    calls += 1
    if (calls <= failures) {
      return { ok: false, json: async () => ({ ok: false, code: 'SESSION_UNAVAILABLE' }) }
    }
    return { ok: true, json: async () => ({ ok: true, pageKey }) }
  })
}

describe('apply registration surface', () => {
  it('registers the tab type, keyed body seat, and footer action', () => {
    const harness = makeHarness()
    apply(harness.ctx)

    expect(harness.tabDefinition()).toMatchObject({
      id: 'dsh-scifork',
      kind: 'scifork.research-graph',
      keepMounted: false,
    })
    expect(harness.tabDefinition()?.guide?.map((entry) => ({ id: entry.id, order: entry.order }))).toEqual([
      { id: 'research-graph', order: 100 },
    ])
    expect(harness.tabDefinition()?.title()).toBe('Research Graph')

    expect(harness.tabBodies.map(({ entry }) => entry)).toEqual([
      { name: 'sidebar.right.pane.tab', key: 'dsh-scifork' },
    ])
    expect(harness.footer).toHaveLength(1)
    expect(harness.footer[0]!.entry).toMatchObject({
      name: 'sidebar.footer.action',
      id: 'scifork-open',
    })
  })

  it('opens the tab through sidebarRight.openTab on footer action click', () => {
    const harness = makeHarness()
    apply(harness.ctx)

    const button = harness.footer[0]!.factory({ wide: false }) as unknown as {
      props: { onClick(): void }
    }
    button.props.onClick()

    expect(harness.openTab).toHaveBeenCalledWith('scifork.research-graph')
  })
})

describe('bridge page keys', () => {
  let bridge: Bridge
  let snapshot: SessionSnapshot
  let scopes: Map<string, Context>
  let inputs: Map<Context, SessionInputCapture>

  beforeEach(() => {
    vi.useFakeTimers()
    const harness = makeHarness()
    snapshot = harness.sessions.snapshot
    scopes = harness.sessions.scopes
    inputs = harness.inputs
    scopes.set('session-1', scopeContext('session-1'))
    scopes.set('session-2', scopeContext('session-2'))
    bridge = createBridge({
      sessions: harness.ctx.get('sessions') as never,
      conversation: harness.ctx.get('conversation') as never,
      sidebarRight: { openTab: vi.fn() },
      fetchImpl: launchFetch(PAGE_KEY) as never,
    })
  })

  afterEach(() => {
    bridge.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('mints one key per session and reuses it without a second launch', async () => {
    const fetchMock = launchFetch(PAGE_KEY)
    const local = createBridge({
      sessions: { list: { getSnapshot: () => snapshot }, scope: (id) => scopes.get(id) },
      conversation: harnessConversation(inputs) as never,
      sidebarRight: { openTab: vi.fn() },
      fetchImpl: fetchMock as never,
    })

    await expect(local.requestPageKey()).resolves.toBe(PAGE_KEY)
    await expect(local.requestPageKey()).resolves.toBe(PAGE_KEY)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/scifork/api/launch',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('rejects the key when the launch response is invalid', async () => {
    const local = createBridge({
      sessions: { list: { getSnapshot: () => snapshot }, scope: (id) => scopes.get(id) },
      conversation: harnessConversation(inputs) as never,
      sidebarRight: { openTab: vi.fn() },
      fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as never,
    })
    await expect(local.requestPageKey()).rejects.toMatchObject({
      code: 'RESEARCH_EXPANSION_REJECTED',
    })
  })

  it('rejects when there is no current session', async () => {
    delete snapshot.current
    await expect(bridge.requestPageKey()).rejects.toMatchObject({
      code: 'SESSION_UNAVAILABLE',
    })
  })

  it('invalidates the key on release', async () => {
    const key = await bridge.requestPageKey()
    bridge.releasePageKey(key)
    await expect(bridge.submitResearchExpansion(key, PROMPT)).rejects.toMatchObject({
      code: 'RESEARCH_EXPANSION_REJECTED',
    })
  })
})

describe('bridge expansion submit', () => {
  let bridge: Bridge
  let snapshot: SessionSnapshot
  let scopes: Map<string, Context>
  let inputs: Map<Context, SessionInputCapture>

  beforeEach(() => {
    vi.useFakeTimers()
    scopes = new Map<string, Context>([['session-1', scopeContext('session-1')]])
    snapshot = { current: 'session-1', byId: { 'session-1': { running: false } } }
    inputs = new Map()
    bridge = createBridge({
      sessions: { list: { getSnapshot: () => snapshot }, scope: (id) => scopes.get(id) },
      conversation: harnessConversation(inputs) as never,
      sidebarRight: { openTab: vi.fn() },
      fetchImpl: launchFetch(PAGE_KEY) as never,
    })
  })

  afterEach(() => {
    bridge.dispose()
    vi.useRealTimers()
  })

  async function settledKey(): Promise<string> {
    return bridge.requestPageKey()
  }

  it('submits through the scoped SessionInput and resolves after running goes idle', async () => {
    const key = await settledKey()
    snapshot.byId['session-1']!.running = true

    const pending = bridge.submitResearchExpansion(key, PROMPT)
    const input = inputs.get(scopes.get('session-1')!)!
    expect(input.setDraft).toHaveBeenCalledWith(PROMPT)
    expect(input.submit).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(250)
    expect(input.submit).toHaveBeenCalledTimes(1)

    snapshot.byId['session-1']!.running = false
    await vi.advanceTimersByTimeAsync(250)
    await expect(pending).resolves.toBeUndefined()
  })

  it('treats an idle session as running once submitted and resolves on the next idle', async () => {
    const key = await settledKey()
    const pending = bridge.submitResearchExpansion(key, PROMPT)
    // The submit itself flips the session to running in this fake.
    snapshot.byId['session-1']!.running = true
    await vi.advanceTimersByTimeAsync(250)
    snapshot.byId['session-1']!.running = false
    await vi.advanceTimersByTimeAsync(250)
    await expect(pending).resolves.toBeUndefined()
  })

  it('rejects with SESSION_UNAVAILABLE when the session disappears mid-watch', async () => {
    const key = await settledKey()
    snapshot.byId['session-1']!.running = true
    const pending = bridge.submitResearchExpansion(key, PROMPT)
    const outcome = pending.then(
      () => 'resolved',
      (error: { code: string }) => error.code,
    )

    delete snapshot.byId['session-1']
    await vi.advanceTimersByTimeAsync(250)
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_UNAVAILABLE' })
    await expect(outcome).resolves.toBe('SESSION_UNAVAILABLE')
  })

  it('rejects a second concurrent submit for the same session', async () => {
    const key = await settledKey()
    snapshot.byId['session-1']!.running = true
    const first = bridge.submitResearchExpansion(key, PROMPT)
    await expect(bridge.submitResearchExpansion(key, PROMPT)).rejects.toMatchObject({
      code: 'RESEARCH_EXPANSION_REJECTED',
    })
    snapshot.byId['session-1']!.running = false
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(250)
    await expect(first).resolves.toBeUndefined()
  })

  it('rejects oversized or empty prompts before submitting', async () => {
    const key = await settledKey()
    await expect(bridge.submitResearchExpansion(key, '')).rejects.toMatchObject({
      code: 'RESEARCH_EXPANSION_REJECTED',
    })
    await expect(bridge.submitResearchExpansion(key, 'x'.repeat(17 * 1024))).rejects.toMatchObject({
      code: 'RESEARCH_EXPANSION_REJECTED',
    })
    expect(inputs.size).toBe(0)
  })

  it('rejects pending submits on dispose', async () => {
    const key = await settledKey()
    snapshot.byId['session-1']!.running = true
    const pending = bridge.submitResearchExpansion(key, PROMPT)
    const outcome = pending.then(
      () => 'resolved',
      (error: { code: string }) => error.code,
    )
    bridge.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'RESEARCH_EXPANSION_REJECTED' })
    await expect(outcome).resolves.toBe('RESEARCH_EXPANSION_REJECTED')
  })
})

function harnessConversation(inputs: Map<Context, SessionInputCapture>): unknown {
  return {
    input: {
      for(actx: Context): SessionInputCapture {
        const existing = inputs.get(actx)
        if (existing !== undefined) return existing
        const capture: SessionInputCapture = { setDraft: vi.fn(), submit: vi.fn(), notify: vi.fn() }
        inputs.set(actx, capture)
        return capture
      },
    },
  }
}
