import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import type {
  SimulateAckMessage,
  SimulateErrorMessage,
  SimulateRequestMessage,
} from '../shared/companion-contract.js'
import { channelNameForPageKey, isPageKey } from '../shared/page-key.js'
import { COMPANION_URL, ROUTE_LAUNCH } from '../shared/routes.js'

export const name = 'scifork'
export const inject = ['slots', 'sessions', 'conversation'] as const

const MAX_PROMPT_BYTES = 16 * 1024
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/
const OPEN_FAILURE_MESSAGE = 'SciFork could not open the Research Graph. Try again from DSH.'

/** Public shell.overlay list-slot face pinned against DSH 0.1.1-rc.2. */
interface SlotsPort {
  register(
    entry: { name: string; id: string; order?: number; label?: string },
    factory: () => ReactElement,
  ): () => void
}

/** Public client Session list and scope faces pinned against DSH 0.1.1-rc.2. */
interface ClientSessionsPort {
  list: {
    getSnapshot(): {
      current?: string
      byId: Readonly<Record<string, { readonly running: boolean }>>
    }
  }
  scope(id: string): Context | undefined
}

/** Public scoped SessionInput face pinned against DSH 0.1.1-rc.2. */
interface SessionInputPort {
  setDraft(text: string): void
  submit(): void
  notify(level: 'info' | 'error', text: string): void
}

interface ConversationPort {
  input: {
    for(actx: Context): SessionInputPort
  }
}

interface ChannelBinding {
  readonly channel: BroadcastChannel
  readonly acceptedNonces: Set<string>
  readonly listener: (event: MessageEvent<unknown>) => void
}

interface BridgeState {
  readonly sessions: ClientSessionsPort
  readonly conversation: ConversationPort
  readonly channels: Set<ChannelBinding>
  disposed: boolean
}

interface LaunchBody {
  readonly ok: true
  readonly url: string
}

function isLaunchBody(value: unknown): value is LaunchBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.ok === true && typeof record.url === 'string'
}

function pageKeyFromLaunchUrl(url: string): string | undefined {
  const prefix = `${COMPANION_URL}#key=`
  if (!url.startsWith(prefix)) return undefined
  const pageKey = url.slice(prefix.length)
  return isPageKey(pageKey) ? pageKey : undefined
}

function isSimulateRequest(value: unknown): value is SimulateRequestMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== 3
    || !Object.hasOwn(record, 'type')
    || !Object.hasOwn(record, 'nonce')
    || !Object.hasOwn(record, 'prompt')
  ) {
    return false
  }
  if (record.type !== 'simulate') return false
  if (typeof record.nonce !== 'string' || !NONCE_PATTERN.test(record.nonce)) return false
  if (typeof record.prompt !== 'string' || record.prompt.length === 0) return false
  return new TextEncoder().encode(record.prompt).byteLength <= MAX_PROMPT_BYTES
}

function postError(
  channel: BroadcastChannel,
  nonce: string,
  code: SimulateErrorMessage['code'],
): void {
  const message: SimulateErrorMessage = { type: 'error', nonce, code }
  channel.postMessage(message)
}

function handleSimulation(
  state: BridgeState,
  binding: ChannelBinding,
  sessionId: string,
  sessionScope: Context,
  value: unknown,
): void {
  if (state.disposed || !isSimulateRequest(value)) return
  if (binding.acceptedNonces.has(value.nonce)) return

  const session = state.sessions.list.getSnapshot().byId[sessionId]
  if (session === undefined) {
    postError(binding.channel, value.nonce, 'SESSION_UNAVAILABLE')
    return
  }

  const status: SimulateAckMessage['status'] = session.running ? 'queued' : 'started'
  binding.acceptedNonces.add(value.nonce)
  try {
    const input = state.conversation.input.for(sessionScope)
    input.setDraft(value.prompt)
    input.submit()
    const acknowledgement: SimulateAckMessage = {
      type: 'ack',
      nonce: value.nonce,
      status,
    }
    binding.channel.postMessage(acknowledgement)
  } catch {
    postError(binding.channel, value.nonce, 'SIMULATE_REJECTED')
  }
}

function closeBinding(state: BridgeState, binding: ChannelBinding): void {
  binding.channel.removeEventListener('message', binding.listener)
  binding.channel.close()
  binding.acceptedNonces.clear()
  state.channels.delete(binding)
}

function notifyOpenFailure(conversation: ConversationPort, sessionScope: Context): void {
  try {
    conversation.input.for(sessionScope).notify('error', OPEN_FAILURE_MESSAGE)
  } catch {
    // Notification is best-effort; never leak the underlying launch error.
  }
}

function closePopup(popup: Window): void {
  try {
    popup.close()
  } catch {
    // The browser may revoke the WindowProxy after creation.
  }
}

async function finishLaunch(
  state: BridgeState,
  popup: Window,
  sessionId: string,
  sessionScope: Context,
): Promise<void> {
  let binding: ChannelBinding | undefined
  try {
    const response = await fetch(ROUTE_LAUNCH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    if (!response.ok) throw new Error('launch rejected')
    const body: unknown = await response.json()
    if (!isLaunchBody(body)) throw new Error('invalid launch response')
    const pageKey = pageKeyFromLaunchUrl(body.url)
    if (pageKey === undefined || state.disposed) throw new Error('invalid launch binding')

    const channel = new BroadcastChannel(channelNameForPageKey(pageKey))
    const acceptedNonces = new Set<string>()
    binding = {
      channel,
      acceptedNonces,
      listener: (event) => {
        if (binding !== undefined) {
          handleSimulation(state, binding, sessionId, sessionScope, event.data)
        }
      },
    }
    channel.addEventListener('message', binding.listener)
    state.channels.add(binding)
    popup.location.assign(body.url)
  } catch {
    if (binding !== undefined) closeBinding(state, binding)
    closePopup(popup)
    notifyOpenFailure(state.conversation, sessionScope)
  }
}

function handleOpen(state: BridgeState): void {
  if (state.disposed) return
  const sessionId = state.sessions.list.getSnapshot().current
  if (sessionId === undefined) return

  let popup: Window | null = null
  try {
    popup = window.open('about:blank', '_blank')
  } catch {
    // Continue so the originating composer can receive a bounded error.
  }
  const sessionScope = state.sessions.scope(sessionId)
  if (sessionScope === undefined) {
    if (popup !== null) closePopup(popup)
    return
  }
  if (popup === null) {
    notifyOpenFailure(state.conversation, sessionScope)
    return
  }
  void finishLaunch(state, popup, sessionId, sessionScope)
}

function OpenGraphButton(props: { readonly state: BridgeState }): ReactElement {
  return createElement(
    'button',
    { type: 'button', onClick: () => handleOpen(props.state) },
    'Open Research Graph',
  )
}

export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as SlotsPort | undefined
  const sessions = ctx.get('sessions') as ClientSessionsPort | undefined
  const conversation = ctx.get('conversation') as ConversationPort | undefined
  if (slots === undefined || sessions === undefined || conversation === undefined) return

  const state: BridgeState = {
    sessions,
    conversation,
    channels: new Set(),
    disposed: false,
  }
  ctx.effect(() => slots.register(
    { name: 'shell.overlay', id: 'scifork-open', order: 100, label: 'Open Research Graph' },
    () => createElement(OpenGraphButton, { state }),
  ))
  ctx.effect(() => () => {
    state.disposed = true
    for (const binding of [...state.channels]) closeBinding(state, binding)
  })
}
