import type { Context } from '@deepseek-ai/cordis'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { createElement, useEffect, useState } from 'react'
import { isPageKey } from '../shared/page-key.js'
import { ROUTE_LAUNCH } from '../shared/routes.js'

export const name = 'scifork'
export const inject = [
  'slots',
  'sessions',
  'conversation',
  'sidebarRightTabs',
  'sidebarRight',
] as const

/**
 * M4 bridge: the Research Graph renders as a DSH right-sidebar tab. The old
 * standalone-window launch (window.open + URL fragment key exchange +
 * BroadcastChannel expansion channel) is deleted; the expansion submit is an
 * in-plugin direct call and the Page Key lives only in this module's memory.
 */

const TAB_TYPE_ID = 'dsh-scifork'
const TAB_KIND = 'scifork.research-graph'
const GUIDE_ENTRY_ID = 'research-graph'
const TAB_TITLE = 'Research Graph'
const GUIDE_DESCRIPTION = 'Open the SciFork Research Graph for the current session.'
const OPEN_FAILURE_MESSAGE = 'SciFork could not open the Research Graph. Try again from DSH.'
const OPEN_ACTION_LABEL = 'Open Research Graph'
const OPEN_ACTION_TEXT = 'Research Graph'
const MAX_PROMPT_BYTES = 16 * 1024
const RESEARCH_COMPLETION_POLL_MS = 250

export type ResearchExpansionRejection =
  | 'RESEARCH_EXPANSION_REJECTED'
  | 'SESSION_UNAVAILABLE'

export class ResearchExpansionError extends Error {
  constructor(readonly code: ResearchExpansionRejection) {
    super(code)
    this.name = 'ResearchExpansionError'
  }
}

interface SidebarFooterActionOwnerProps {
  readonly wide: boolean
}

/** One guide entry on the right-sidebar guide page. */
interface SidebarRightGuideEntry {
  readonly id: string
  readonly order: number
  readonly title: () => string
  readonly description?: () => string
}

/**
 * Public `ctx.sidebarRightTabs.register` face, structurally pinned against
 * DSH 0.2.1-rc.2 (page type: no patterns, default `extension` band).
 */
interface SidebarRightTabsPort {
  register(definition: {
    readonly id: string
    readonly kind: string
    readonly keepMounted?: boolean
    readonly title: (address?: string) => string
    readonly guide?: readonly SidebarRightGuideEntry[]
  }): () => void
}

/** Public `ctx.sidebarRight` navigation controller face. */
interface SidebarRightPort {
  openTab(kind: string): void
}

/** Public sidebar slots face: footer action list slot + keyed tab body seat. */
interface SlotsPort {
  inject(name: 'sidebar.footer.action', callback: () => () => void): () => void
  register(
    entry: { name: string; id: string; order?: number; label?: string },
    factory: (props: SidebarFooterActionOwnerProps) => ReactElement,
  ): () => void
  register(
    entry: { name: 'sidebar.right.pane.tab'; key: string },
    factory: () => ReactElement,
  ): () => void
}

/** Public client Session list and scope faces pinned against DSH 0.2.1-rc.2. */
interface ClientSessionsPort {
  list: {
    getSnapshot(): {
      current?: string
      byId: Readonly<Record<string, { readonly running: boolean }>>
    }
  }
  scope(id: string): Context | undefined
}

/** Public scoped SessionInput face pinned against DSH 0.2.1-rc.2. */
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

interface PageKeyBinding {
  readonly pageKey: string
  readonly sessionId: string
  readonly sessionScope: Context
}

interface CompletionWatch {
  readonly sessionId: string
  observedRunning: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  resolve(): void
  reject(error: ResearchExpansionError): void
}

export interface BridgeDeps {
  readonly sessions: ClientSessionsPort
  readonly conversation: ConversationPort
  readonly sidebarRight: SidebarRightPort
  readonly fetchImpl?: typeof fetch
}

export interface Bridge {
  /** Mint (or reuse) the Page Key for the current session, in memory only. */
  requestPageKey(): Promise<string>
  /** Drop a Page Key binding (tab body unmount invalidates the key). */
  releasePageKey(pageKey: string): void
  /** Submit one Research Expansion step; resolves when the session goes idle again. */
  submitResearchExpansion(pageKey: string, prompt: string): Promise<void>
  dispose(): void
}

interface LaunchBody {
  readonly ok: true
  readonly pageKey: string
}

function isLaunchBody(value: unknown): value is LaunchBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.ok === true && isPageKey(record.pageKey)
}

export function createBridge(deps: BridgeDeps): Bridge {
  const doFetch = deps.fetchImpl ?? fetch
  const byPageKey = new Map<string, PageKeyBinding>()
  const bySession = new Map<string, string>()
  const watches = new Map<string, CompletionWatch>()
  let disposed = false

  function currentSessionId(): string | undefined {
    return deps.sessions.list.getSnapshot().current
  }

  async function requestPageKey(): Promise<string> {
    const sessionId = currentSessionId()
    if (sessionId === undefined) throw new ResearchExpansionError('SESSION_UNAVAILABLE')
    const cached = bySession.get(sessionId)
    if (cached !== undefined) return cached

    const sessionScope = deps.sessions.scope(sessionId)
    if (sessionScope === undefined) throw new ResearchExpansionError('SESSION_UNAVAILABLE')

    const response = await doFetch(ROUTE_LAUNCH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    if (!response.ok) throw new ResearchExpansionError('RESEARCH_EXPANSION_REJECTED')
    const body: unknown = await response.json()
    if (!isLaunchBody(body) || disposed) {
      throw new ResearchExpansionError('RESEARCH_EXPANSION_REJECTED')
    }
    byPageKey.set(body.pageKey, { pageKey: body.pageKey, sessionId, sessionScope })
    bySession.set(sessionId, body.pageKey)
    return body.pageKey
  }

  function releasePageKey(pageKey: string): void {
    const binding = byPageKey.get(pageKey)
    byPageKey.delete(pageKey)
    if (binding !== undefined && bySession.get(binding.sessionId) === pageKey) {
      bySession.delete(binding.sessionId)
    }
  }

  function clearWatch(watch: CompletionWatch): void {
    if (watch.timer !== undefined) clearTimeout(watch.timer)
    watch.timer = undefined
  }

  function scheduleWatch(watch: CompletionWatch): void {
    if (disposed || watch.timer !== undefined) return
    watch.timer = setTimeout(() => {
      watch.timer = undefined
      const session = deps.sessions.list.getSnapshot().byId[watch.sessionId]
      if (session === undefined) {
        clearWatch(watch)
        watches.delete(watch.sessionId)
        watch.reject(new ResearchExpansionError('SESSION_UNAVAILABLE'))
        return
      }
      if (session.running) {
        watch.observedRunning = true
        scheduleWatch(watch)
        return
      }
      if (!watch.observedRunning) {
        scheduleWatch(watch)
        return
      }
      clearWatch(watch)
      watches.delete(watch.sessionId)
      watch.resolve()
    }, RESEARCH_COMPLETION_POLL_MS)
  }

  function submitResearchExpansion(pageKey: string, prompt: string): Promise<void> {
    if (disposed) {
      return Promise.reject(new ResearchExpansionError('RESEARCH_EXPANSION_REJECTED'))
    }
    const binding = byPageKey.get(pageKey)
    if (binding === undefined || watches.has(binding.sessionId)) {
      return Promise.reject(new ResearchExpansionError('RESEARCH_EXPANSION_REJECTED'))
    }
    if (
      typeof prompt !== 'string'
      || prompt.length === 0
      || new TextEncoder().encode(prompt).byteLength > MAX_PROMPT_BYTES
    ) {
      return Promise.reject(new ResearchExpansionError('RESEARCH_EXPANSION_REJECTED'))
    }
    const session = deps.sessions.list.getSnapshot().byId[binding.sessionId]
    if (session === undefined) {
      return Promise.reject(new ResearchExpansionError('SESSION_UNAVAILABLE'))
    }
    return new Promise<void>((resolve, reject) => {
      try {
        const input = deps.conversation.input.for(binding.sessionScope)
        input.setDraft(prompt)
        input.submit()
        const afterSubmit = deps.sessions.list.getSnapshot().byId[binding.sessionId]
        const watch: CompletionWatch = {
          sessionId: binding.sessionId,
          observedRunning: session.running || afterSubmit?.running === true,
          timer: undefined,
          resolve,
          reject,
        }
        watches.set(binding.sessionId, watch)
        scheduleWatch(watch)
      } catch {
        reject(new ResearchExpansionError('RESEARCH_EXPANSION_REJECTED'))
      }
    })
  }

  function dispose(): void {
    disposed = true
    for (const watch of watches.values()) {
      clearWatch(watch)
      watch.reject(new ResearchExpansionError('RESEARCH_EXPANSION_REJECTED'))
    }
    watches.clear()
    byPageKey.clear()
    bySession.clear()
  }

  return { requestPageKey, releasePageKey, submitResearchExpansion, dispose }
}

function notifyOpenFailure(conversation: ConversationPort, sessionScope: Context): void {
  try {
    conversation.input.for(sessionScope).notify('error', OPEN_FAILURE_MESSAGE)
  } catch {
    // Notification is best-effort; never leak the underlying open error.
  }
}

function handleOpen(bridge: Bridge, deps: BridgeDeps): void {
  const sessionId = deps.sessions.list.getSnapshot().current
  if (sessionId === undefined) return
  const sessionScope = deps.sessions.scope(sessionId)
  try {
    deps.sidebarRight.openTab(TAB_KIND)
  } catch {
    if (sessionScope !== undefined) notifyOpenFailure(deps.conversation, sessionScope)
  }
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

function openGraphButtonElement(props: {
  readonly bridge: Bridge
  readonly deps: BridgeDeps
  readonly wide: boolean
}): ReactElement {
  return createElement(
    'button',
    {
      'aria-label': OPEN_ACTION_LABEL,
      'data-scifork-sidebar-action': props.wide ? 'wide' : 'rail',
      type: 'button',
      onClick: () => handleOpen(props.bridge, props.deps),
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

/**
 * Placeholder tab body: it mints and releases the Page Key for the current
 * session across its mount lifecycle. M4-5 replaces the placeholder markup
 * with the full Companion component tree (which keeps the same key lifecycle
 * and receives the bridge submit face).
 */
function ResearchGraphTabBody(props: { readonly bridge: Bridge }): ReactElement {
  const [state, setState] = useState<'pending' | 'ready' | 'unavailable'>('pending')
  useEffect(() => {
    let active = true
    let heldKey: string | undefined
    props.bridge.requestPageKey().then(
      (pageKey) => {
        heldKey = pageKey
        if (active) setState('ready')
      },
      () => {
        if (active) setState('unavailable')
      },
    )
    return () => {
      active = false
      if (heldKey !== undefined) props.bridge.releasePageKey(heldKey)
    }
  }, [props.bridge])
  return createElement(
    'div',
    { 'data-scifork-research-graph-tab': state },
    TAB_TITLE,
  )
}

export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as SlotsPort | undefined
  const sessions = ctx.get('sessions') as ClientSessionsPort | undefined
  const conversation = ctx.get('conversation') as ConversationPort | undefined
  const sidebarRightTabs = ctx.get('sidebarRightTabs') as SidebarRightTabsPort | undefined
  const sidebarRight = ctx.get('sidebarRight') as SidebarRightPort | undefined
  if (
    slots === undefined
    || sessions === undefined
    || conversation === undefined
    || sidebarRightTabs === undefined
    || sidebarRight === undefined
  ) {
    return
  }

  const deps: BridgeDeps = { sessions, conversation, sidebarRight }
  const bridge = createBridge(deps)

  ctx.effect(() => sidebarRightTabs.register({
    id: TAB_TYPE_ID,
    kind: TAB_KIND,
    keepMounted: false,
    title: () => TAB_TITLE,
    guide: [
      {
        id: GUIDE_ENTRY_ID,
        order: 100,
        title: () => TAB_TITLE,
        description: () => GUIDE_DESCRIPTION,
      },
    ],
  }))

  slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: 'scifork-open', order: 100, label: OPEN_ACTION_TEXT },
    ({ wide }) => openGraphButtonElement({ bridge, deps, wide }),
  ))

  ctx.effect(() => slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_TYPE_ID },
    () => createElement(ResearchGraphTabBody, { bridge }),
  ))

  ctx.effect(() => () => bridge.dispose())
}
