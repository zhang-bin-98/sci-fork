import type { Context } from '@deepseek-ai/cordis'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
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
const OPEN_ACTION_LABEL = 'Open Research Graph'
const OPEN_ACTION_TEXT = 'Research Graph'

interface SidebarFooterActionOwnerProps {
  readonly wide: boolean
}

/** Public sidebar.footer.action list-slot face pinned against DSH 0.1.1-rc.2. */
interface SlotsPort {
  inject(name: 'sidebar.footer.action', callback: () => () => void): () => void
  register(
    entry: { name: string; id: string; order?: number; label?: string },
    factory: (props: SidebarFooterActionOwnerProps) => ReactElement,
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

function GraphIcon(props: { readonly size: number }): ReactElement {
  return createElement(
    'svg',
    {
      'aria-hidden': true,
      'data-scifork-graph-icon': true,
      fill: 'none',
      focusable: 'false',
      height: props.size,
      viewBox: '0 0 16 16',
      width: props.size,
    },
    createElement('path', {
      d: 'M5.1 4.3l5.6.6M4.4 5.5l1.9 5.2m5-4.2L8.4 11',
      stroke: 'currentColor',
      strokeLinecap: 'round',
      strokeWidth: 1.4,
    }),
    createElement('circle', { cx: 3.5, cy: 4, fill: 'currentColor', r: 1.8 }),
    createElement('circle', { cx: 12.5, cy: 5.2, fill: 'currentColor', r: 1.8 }),
    createElement('circle', { cx: 7.2, cy: 12.3, fill: 'currentColor', r: 1.8 }),
  )
}

function openButtonStyle(wide: boolean): CSSProperties {
  return {
    alignItems: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: wide ? 12 : '50%',
    boxSizing: 'border-box',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    fontFamily: 'inherit',
    fontSize: 14,
    gap: wide ? 8 : 0,
    height: wide ? 42 : 36,
    justifyContent: wide ? 'flex-start' : 'center',
    lineHeight: '22px',
    margin: wide ? '8px -2px 0' : 0,
    overflow: 'hidden',
    padding: wide ? '0 10px 0 8px' : 0,
    width: wide ? 'calc(100% + 4px)' : 36,
  }
}

function setOpenButtonHover(
  event: ReactMouseEvent<HTMLButtonElement>,
  hovered: boolean,
): void {
  event.currentTarget.style.background = hovered
    ? 'var(--dsw-alias-interactive-bg-hover)'
    : 'transparent'
}

function OpenGraphButton(props: {
  readonly state: BridgeState
  readonly wide: boolean
}): ReactElement {
  return createElement(
    'button',
    {
      'aria-label': OPEN_ACTION_LABEL,
      'data-scifork-sidebar-action': props.wide ? 'wide' : 'rail',
      type: 'button',
      onClick: () => handleOpen(props.state),
      onMouseEnter: (event: ReactMouseEvent<HTMLButtonElement>) => {
        setOpenButtonHover(event, true)
      },
      onMouseLeave: (event: ReactMouseEvent<HTMLButtonElement>) => {
        setOpenButtonHover(event, false)
      },
      style: openButtonStyle(props.wide),
      title: props.wide ? undefined : OPEN_ACTION_LABEL,
    },
    createElement(GraphIcon, { size: props.wide ? 16 : 18 }),
    props.wide
      ? createElement(
          'span',
          {
            style: {
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
          },
          OPEN_ACTION_TEXT,
        )
      : null,
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
  slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: 'scifork-open', order: 100, label: OPEN_ACTION_TEXT },
    ({ wide }) => createElement(OpenGraphButton, { state, wide }),
  ))
  ctx.effect(() => () => {
    state.disposed = true
    for (const binding of [...state.channels]) closeBinding(state, binding)
  })
}
