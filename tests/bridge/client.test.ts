import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

interface SessionSnapshot {
  current: string
  byId: Record<string, { running: boolean }>
}

type MessageListener =
  | ((event: MessageEvent<unknown>) => unknown)
  | { handleEvent(event: MessageEvent<unknown>): unknown }

const PAGE_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const LAUNCH_URL = `/scifork/#key=${PAGE_KEY}`
const NONCE = 'AQIDBAUGBwgJCgsMDQ4PEA'
const PROMPT = 'Use this exact, bounded simulation prompt.'

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  static events: string[] = []

  readonly name: string
  readonly postMessage = vi.fn()
  readonly close = vi.fn(() => {
    this.closed = true
  })
  onmessage: ((event: MessageEvent<unknown>) => unknown) | null = null

  private readonly listeners = new Set<MessageListener>()
  private closed = false

  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
    FakeBroadcastChannel.events.push(`channel:${name}`)
  }

  addEventListener(type: string, listener: MessageListener): void {
    if (type === 'message') this.listeners.add(listener)
  }

  removeEventListener(type: string, listener: MessageListener): void {
    if (type === 'message') this.listeners.delete(listener)
  }

  receive(data: unknown): void {
    if (this.closed) return
    const event = { data } as MessageEvent<unknown>
    this.onmessage?.(event)
    for (const listener of this.listeners) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }

  static reset(): void {
    FakeBroadcastChannel.instances = []
    FakeBroadcastChannel.events = []
  }
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
  dispose(): void
} {
  const registrations: Registration[] = []
  const disposers: Array<() => void> = []
  const slots = {
    register(entry: SlotEntry, factory: () => ReactElement): () => void {
      registrations.push({ entry, factory })
      return () => undefined
    },
  }
  const ctx = {
    get(name: string): unknown {
      return name === 'slots' ? slots : services[name]
    },
    effect(callback: () => void | (() => void)): void | (() => void) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
  } as unknown as Context
  return {
    ctx,
    registrations,
    dispose(): void {
      for (const disposer of disposers.reverse()) disposer()
    },
  }
}

function click(registration: Registration): void {
  const component = registration.factory()
  expect(typeof component.type).toBe('function')
  const button = (component.type as (props: unknown) => ReactElement)(component.props)
  expect(button.type).toBe('button')
  ;(button.props as ClickableProps).onClick()
}

function openAction(registrations: Registration[]): Registration {
  const registration = registrations.find(({ entry }) => entry.id === 'scifork-open')
  expect(registration).toBeDefined()
  return registration!
}

function createServices(running = false) {
  const state: SessionSnapshot = {
    current: 'session-a',
    byId: {
      'session-a': { running },
      'session-b': { running: false },
    },
  }
  const scopeA = fakeContext({ id: 'scope-a' })
  const scopeB = fakeContext({ id: 'scope-b' })
  let resolvedScopeA: Context | undefined = scopeA
  const scope = vi.fn((sessionId: string) =>
    sessionId === 'session-a' ? resolvedScopeA : sessionId === 'session-b' ? scopeB : undefined,
  )
  const setDraft = vi.fn()
  const submit = vi.fn()
  const notify = vi.fn()
  const input = { setDraft, submit, notify }
  const otherInput = { setDraft: vi.fn(), submit: vi.fn(), notify: vi.fn() }
  const inputFor = vi.fn((scopeContext: Context) =>
    scopeContext === scopeA ? input : otherInput,
  )
  const sessions = {
    list: { getSnapshot: vi.fn(() => state) },
    scope,
  }
  const conversation = { input: { for: inputFor } }
  return {
    state,
    scopeA,
    scope,
    setResolvedScopeA(value: Context | undefined): void {
      resolvedScopeA = value
    },
    setDraft,
    submit,
    notify,
    inputFor,
    sessions,
    conversation,
  }
}

function launchResponse(url: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn(async () => ({ ok, url })),
  } as unknown as Response
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function installBrowser(fetchImplementation: () => Promise<Response>, popupAllowed = true) {
  const events = FakeBroadcastChannel.events
  let currentUrl = 'about:blank'
  const navigate = vi.fn((url: string) => {
    currentUrl = url
    events.push(`navigate:${url}`)
  })
  const popupLocation = { assign: navigate, replace: navigate }
  Object.defineProperty(popupLocation, 'href', {
    get: () => currentUrl,
    set: navigate,
  })
  const popup = {
    location: popupLocation,
    close: vi.fn(),
  } as unknown as Window
  const open = vi.fn(() => {
    events.push('open')
    return popupAllowed ? popup : null
  })
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
    events.push('fetch')
    return fetchImplementation()
  })
  vi.stubGlobal('window', {
    open,
    location: { origin: 'http://127.0.0.1:3000' },
    BroadcastChannel: FakeBroadcastChannel,
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  return { events, popup, open, fetchMock, navigate }
}

async function openBridge(running = false) {
  const services = createServices(running)
  const browser = installBrowser(async () => launchResponse(LAUNCH_URL))
  const captured = captureRegistrations({
    sessions: services.sessions,
    conversation: services.conversation,
  })
  apply(captured.ctx)
  click(openAction(captured.registrations))
  await vi.waitFor(() => expect(FakeBroadcastChannel.instances).toHaveLength(1))
  return {
    ...services,
    ...browser,
    ...captured,
    channel: FakeBroadcastChannel.instances[0]!,
  }
}

function acknowledgementMessages(channel: FakeBroadcastChannel): unknown[] {
  return channel.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => (message as { type?: unknown } | null)?.type === 'ack')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  FakeBroadcastChannel.reset()
})

describe('SciFork DSH bridge', () => {
  it('registers one additive Open action only', () => {
    const services = createServices()
    const { ctx, registrations } = captureRegistrations({
      sessions: services.sessions,
      conversation: services.conversation,
    })

    apply(ctx)

    expect(registrations.map(({ entry }) => entry)).toEqual([
      {
        name: 'shell.overlay',
        id: 'scifork-open',
        order: 100,
        label: 'Open Research Graph',
      },
    ])
  })

  it('opens about:blank and captures the originating Session before launch, then opens the key channel before navigation', async () => {
    const pending = deferred<Response>()
    const services = createServices()
    const browser = installBrowser(() => pending.promise)
    const captured = captureRegistrations({
      sessions: services.sessions,
      conversation: services.conversation,
    })
    apply(captured.ctx)

    click(openAction(captured.registrations))

    expect(browser.open.mock.calls[0]?.slice(0, 2)).toEqual(['about:blank', '_blank'])
    expect(services.scope).toHaveBeenCalledOnce()
    expect(services.scope).toHaveBeenCalledWith('session-a')
    expect(browser.fetchMock).toHaveBeenCalledOnce()
    expect(browser.open.mock.invocationCallOrder[0]).toBeLessThan(
      services.scope.mock.invocationCallOrder[0]!,
    )
    expect(services.scope.mock.invocationCallOrder[0]).toBeLessThan(
      browser.fetchMock.mock.invocationCallOrder[0]!,
    )
    const [route, init] = browser.fetchMock.mock.calls[0]!
    expect(route).toBe('/scifork/api/launch')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-a' }),
    })
    expect(FakeBroadcastChannel.instances).toHaveLength(0)
    expect(browser.navigate).not.toHaveBeenCalled()

    services.state.current = 'session-b'
    services.setResolvedScopeA(fakeContext({ id: 'replacement-scope' }))
    pending.resolve(launchResponse(LAUNCH_URL))
    await vi.waitFor(() => expect(FakeBroadcastChannel.instances).toHaveLength(1))

    const channel = FakeBroadcastChannel.instances[0]!
    expect(channel.name).toBe(`scifork:simulate:v1:${PAGE_KEY}`)
    expect(browser.navigate).toHaveBeenCalledWith(LAUNCH_URL)
    expect(browser.events.indexOf(`channel:${channel.name}`)).toBeLessThan(
      browser.events.indexOf(`navigate:${LAUNCH_URL}`),
    )
    expect(services.scope).toHaveBeenCalledOnce()
    expect(browser.popup.close).not.toHaveBeenCalled()
  })

  it('does not launch when the synchronous popup is blocked and notifies the originating composer', async () => {
    const services = createServices()
    const browser = installBrowser(async () => launchResponse(LAUNCH_URL), false)
    const captured = captureRegistrations({
      sessions: services.sessions,
      conversation: services.conversation,
    })
    apply(captured.ctx)

    click(openAction(captured.registrations))

    await vi.waitFor(() => expect(services.notify).toHaveBeenCalledOnce())
    expect(browser.fetchMock).not.toHaveBeenCalled()
    expect(FakeBroadcastChannel.instances).toHaveLength(0)
    expect(services.notify).toHaveBeenCalledWith('error', expect.any(String))
  })

  it('closes the blank window and notifies the originating composer when launch fails', async () => {
    const services = createServices()
    const browser = installBrowser(async () => {
      throw new Error('must not leak C:\\private\\project')
    })
    const captured = captureRegistrations({
      sessions: services.sessions,
      conversation: services.conversation,
    })
    apply(captured.ctx)

    click(openAction(captured.registrations))

    await vi.waitFor(() => expect(browser.popup.close).toHaveBeenCalledOnce())
    expect(FakeBroadcastChannel.instances).toHaveLength(0)
    expect(services.notify).toHaveBeenCalledOnce()
    expect(services.notify).toHaveBeenCalledWith('error', expect.any(String))
    expect(services.notify.mock.calls[0]?.[1]).not.toContain('private')
  })

  it('rejects a launch response without one valid fragment Page Key', async () => {
    const services = createServices()
    const browser = installBrowser(async () => launchResponse('/scifork/#key=short'))
    const captured = captureRegistrations({
      sessions: services.sessions,
      conversation: services.conversation,
    })
    apply(captured.ctx)

    click(openAction(captured.registrations))

    await vi.waitFor(() => expect(browser.popup.close).toHaveBeenCalledOnce())
    expect(FakeBroadcastChannel.instances).toHaveLength(0)
    expect(browser.navigate).not.toHaveBeenCalled()
    expect(services.notify).toHaveBeenCalledOnce()
  })

  it('submits an exact valid message once to the captured Session and acknowledges started from the pre-submit state', async () => {
    const bridge = await openBridge(false)
    bridge.state.current = 'session-b'
    bridge.setResolvedScopeA(fakeContext({ id: 'replacement-scope' }))
    bridge.submit.mockImplementation(() => {
      bridge.state.byId['session-a']!.running = true
    })

    bridge.channel.receive({ type: 'simulate', nonce: NONCE, prompt: PROMPT })

    expect(bridge.scope).toHaveBeenCalledOnce()
    expect(bridge.inputFor).toHaveBeenCalledOnce()
    expect(bridge.inputFor).toHaveBeenCalledWith(bridge.scopeA)
    expect(bridge.setDraft).toHaveBeenCalledOnce()
    expect(bridge.setDraft).toHaveBeenCalledWith(PROMPT)
    expect(bridge.submit).toHaveBeenCalledOnce()
    expect(bridge.setDraft.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.submit.mock.invocationCallOrder[0]!,
    )
    expect(bridge.channel.postMessage).toHaveBeenCalledOnce()
    expect(bridge.channel.postMessage).toHaveBeenCalledWith({
      type: 'ack',
      nonce: NONCE,
      status: 'started',
    })
  })

  it('acknowledges queued from a busy pre-submit Session even if submit changes the live snapshot', async () => {
    const bridge = await openBridge(true)
    bridge.submit.mockImplementation(() => {
      bridge.state.byId['session-a']!.running = false
    })

    bridge.channel.receive({ type: 'simulate', nonce: NONCE, prompt: PROMPT })

    expect(bridge.setDraft).toHaveBeenCalledWith(PROMPT)
    expect(bridge.submit).toHaveBeenCalledOnce()
    expect(bridge.channel.postMessage).toHaveBeenCalledWith({
      type: 'ack',
      nonce: NONCE,
      status: 'queued',
    })
  })

  it('rejects simulation when the originating Session is no longer live', async () => {
    const bridge = await openBridge()
    delete bridge.state.byId['session-a']

    bridge.channel.receive({ type: 'simulate', nonce: NONCE, prompt: PROMPT })

    expect(bridge.inputFor).not.toHaveBeenCalled()
    expect(bridge.setDraft).not.toHaveBeenCalled()
    expect(bridge.submit).not.toHaveBeenCalled()
    expect(acknowledgementMessages(bridge.channel)).toEqual([])
  })

  it('rejects wrong shapes, malformed nonces, oversized UTF-8 prompts, and messages on another channel', async () => {
    const bridge = await openBridge()
    const oversizedPrompt = '\u754c'.repeat(5_462)
    const invalidMessages: unknown[] = [
      null,
      [],
      { type: 'ack', nonce: NONCE, prompt: PROMPT },
      { type: 'simulate', nonce: 'a'.repeat(32), prompt: PROMPT },
      { type: 'simulate', nonce: NONCE, prompt: PROMPT, extra: true },
      { type: 'simulate', nonce: NONCE, prompt: oversizedPrompt },
    ]

    for (const message of invalidMessages) bridge.channel.receive(message)
    const wrongChannel = new FakeBroadcastChannel(`scifork:simulate:v1:${'A'.repeat(43)}`)
    wrongChannel.receive({ type: 'simulate', nonce: NONCE, prompt: PROMPT })

    expect(new TextEncoder().encode(oversizedPrompt).byteLength).toBeGreaterThan(16 * 1024)
    expect(bridge.inputFor).not.toHaveBeenCalled()
    expect(bridge.setDraft).not.toHaveBeenCalled()
    expect(bridge.submit).not.toHaveBeenCalled()
    expect(acknowledgementMessages(bridge.channel)).toEqual([])
  })

  it('drops an already accepted nonce without another submit or acknowledgement', async () => {
    const bridge = await openBridge()
    const message = { type: 'simulate' as const, nonce: NONCE, prompt: PROMPT }

    bridge.channel.receive(message)
    bridge.channel.receive(message)

    expect(bridge.setDraft).toHaveBeenCalledOnce()
    expect(bridge.submit).toHaveBeenCalledOnce()
    expect(acknowledgementMessages(bridge.channel)).toEqual([
      { type: 'ack', nonce: NONCE, status: 'started' },
    ])
  })

  it('closes active channels on bundle unload', async () => {
    const bridge = await openBridge()

    bridge.dispose()

    expect(bridge.channel.close).toHaveBeenCalledOnce()
    bridge.channel.receive({ type: 'simulate', nonce: NONCE, prompt: PROMPT })
    expect(bridge.setDraft).not.toHaveBeenCalled()
    expect(bridge.submit).not.toHaveBeenCalled()
  })
})
