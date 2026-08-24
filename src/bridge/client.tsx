import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { createElement } from 'react'
import { ROUTE_LAUNCH } from '../shared/routes.js'

export const name = 'scifork'
export const inject = ['slots', 'sessions', 'conversation']

/**
 * Structural faces of the client services used by the M0 spike, pinned
 * against DSH 0.1.1-rc.2 (dsh-client-runtime, dsh-client-ui-conversation).
 */

/** ctx.slots.register — SlotCore's typed face (list-slot entry form). */
interface SlotsPort {
  register(
    entry: { name: string; id: string; order?: number; label?: string },
    factory: () => ReactElement,
  ): () => void
}

/**
 * ctx.sessions — the current selection lives in the list snapshot;
 * scope(id) resolves the session-scoped context for conversation.input.
 */
interface ClientSessionsPort {
  list: { getSnapshot(): { current?: string } }
  scope(id: string): Context | undefined
}

/** ctx.conversation.input.for(actx) — SessionInputResolver face. */
interface ConversationPort {
  input: {
    for(actx: Context): {
      setDraft(text: string): void
      submit(): void
    }
  }
}

function currentSessionId(ctx: Context): string | undefined {
  const sessions = ctx.get('sessions') as ClientSessionsPort | undefined
  return sessions?.list.getSnapshot().current
}

/** M0 spike prompt; the real SimulationPrompt builder arrives with M2. */
const SPIKE_PROMPT = 'SciFork M0 spike: verify scoped setDraft + submit.'

function OpenGraphButton(props: { ctx: Context }): ReactElement {
  return createElement(
    'button',
    { type: 'button', onClick: () => void handleOpen(props.ctx) },
    'Open Research Graph',
  )
}

async function handleOpen(ctx: Context): Promise<void> {
  const sessionId = currentSessionId(ctx)
  if (sessionId === undefined) return
  try {
    const response = await fetch(ROUTE_LAUNCH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    if (!response.ok) return
    const body = (await response.json()) as { url?: unknown }
    if (typeof body.url !== 'string') return
    // M2 refines this into the about:blank → Page Key fragment handshake.
    window.open(body.url, '_blank')
  } catch {
    // M0 spike stays silent; M2 adds Retry/Copy with the prompt retained.
  }
}

function SimulateButton(props: { ctx: Context }): ReactElement {
  return createElement(
    'button',
    { type: 'button', onClick: () => handleSimulate(props.ctx) },
    'SciFork Spike: Simulate',
  )
}

/**
 * Simulate runs only inside a real click handler. Idle sessions start
 * immediately; running sessions queue through DSH's standard submit path.
 */
function handleSimulate(ctx: Context): void {
  const sessions = ctx.get('sessions') as ClientSessionsPort | undefined
  const conversation = ctx.get('conversation') as ConversationPort | undefined
  const sessionId = sessions?.list.getSnapshot().current
  const actx = sessionId !== undefined ? sessions?.scope(sessionId) : undefined
  if (actx === undefined || conversation === undefined) return
  const input = conversation.input.for(actx)
  input.setDraft(SPIKE_PROMPT)
  input.submit()
}

export function apply(ctx: Context): void {
  const slots = ctx.get('slots') as SlotsPort | undefined
  if (slots === undefined) return
  slots.register(
    { name: 'shell.overlay', id: 'scifork-open', order: 100, label: 'Open Research Graph' },
    () => createElement(OpenGraphButton, { ctx }),
  )
  slots.register(
    {
      name: 'shell.overlay',
      id: 'scifork-spike-simulate',
      order: 110,
      label: 'SciFork Spike: Simulate',
    },
    () => createElement(SimulateButton, { ctx }),
  )
}
