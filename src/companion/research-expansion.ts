import type { ProjectionEdgeSummary, ProjectionEntitySummary } from '../shared/companion-contract.js'

/**
 * M4: the Research Expansion prompt is the click's authorization document
 * only. It carries the Focus, the objective gate, the retrieval-first
 * direction, and the full authorization boundary; the workflow and format
 * detail lives solely in the scifork-research skill body. Submission is an
 * in-plugin direct call (no BroadcastChannel, nonce, or ack timeout).
 */

export const RESEARCH_EXPANSION_PROMPT_LIMIT = 6 * 1024
export const RESEARCH_EXPANSION_ACTION_LABEL = 'Research & Expand'

export interface ResearchExpansionPromptInput {
  focusEntityId: string
  entities: readonly ProjectionEntitySummary[]
  edges: readonly ProjectionEdgeSummary[]
}

const encoder = new TextEncoder()

function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

function focusDescription(input: ResearchExpansionPromptInput): string {
  const entity = input.entities.find(({ id }) => id === input.focusEntityId)
  if (entity !== undefined) return entity.label
  const edge = input.edges.find(({ id }) => id === input.focusEntityId)
  return edge === undefined
    ? 'Unavailable in the latest visible snapshot.'
    : [edge.from, edge.relation, edge.to].join(' ')
}

export function buildResearchExpansionPrompt(input: ResearchExpansionPromptInput): string {
  const title = 'SciFork literature-grounded Research Expansion Step\n\n'
  const focusContext =
    'Focus\n' +
    '- ID: ' +
    input.focusEntityId +
    '\n' +
    '- Summary: ' +
    focusDescription(input) +
    '\n\n'
  const instructions =
    'Objective and authorization\n' +
    '- Use the current Chat objective to decide which relationship to investigate from this Focus.\n' +
    '- If no current Chat objective is present, do not retrieve or mutate; ask the user to state the objective and click again. This authorization then ends.\n' +
    '- This real Research & Expand click authorizes exactly one connected expansion step: zero to five direct branches at depth one.\n' +
    '- Only machine-reviewed Evidence may be created. Never create or promote a Finding, human-reviewed Evidence, or a validated Result.\n' +
    '- The Focus remains unchanged. Do not recurse. A Progressive Research Run is not authorized by this click.\n\n' +
    'Retrieval first\n' +
    '- Before any graph mutation, complete one real external retrieval phase and keep its results in the current Chat: an installed retrieval plugin (for example dsh-pubmed), the harness web search fallback, or explicitly user-provided source text.\n' +
    '- Do not load scifork-research until retrieval is complete. If no qualifying PMID or DOI with real abstract or bounded user-provided source text resolves, stop and report; a title-only or metadata-only record never qualifies.\n\n' +
    'Graph phase\n' +
    '- Then load scifork-research and follow its workflow exactly (Evidence before each branch, the bold-summary body format, endpoint direction, ai_inference provenance). Work through the SciFork typed tools and report the retained and rejected ids.\n'

  const fixedBytes = byteLength(title) + byteLength(instructions)
  const contextBudget = Math.max(0, RESEARCH_EXPANSION_PROMPT_LIMIT - fixedBytes)
  return title + truncateUtf8(focusContext, contextBudget) + instructions
}

function truncateUtf8(value: string, limit: number): string {
  if (byteLength(value) <= limit) return value
  const marker = '\n[Visible context truncated]\n'
  const contentLimit = Math.max(0, limit - byteLength(marker))
  let output = ''
  let used = 0
  for (const character of value) {
    const size = byteLength(character)
    if (used + size > contentLimit) break
    output += character
    used += size
  }
  return output + marker
}

export type ResearchExpansionFailureReason =
  | 'prompt_too_large'
  | 'RESEARCH_EXPANSION_REJECTED'
  | 'SESSION_UNAVAILABLE'

export type ResearchExpansionState =
  | { phase: 'idle' }
  | { phase: 'pending'; prompt: string }
  | { phase: 'failed'; prompt: string; reason: ResearchExpansionFailureReason }

export interface ResearchExpansionSubmitOptions {
  /** The bridge-bound direct submit; resolves on completion, rejects with a code. */
  submit(prompt: string): Promise<void>
  onStateChange?(state: ResearchExpansionState): void
}

/**
 * Direct-call client: submit is accepted synchronously and resolves when the
 * bound session goes idle again. There is no ack timeout; rejection codes
 * arrive immediately from the bridge.
 */
export class ResearchExpansionSubmitter {
  private state: ResearchExpansionState = { phase: 'idle' }
  private disposed = false

  constructor(private readonly options: ResearchExpansionSubmitOptions) {}

  getState(): ResearchExpansionState {
    return this.state
  }

  submit(prompt: string): void {
    if (this.disposed) return
    this.update({ phase: 'pending', prompt })
    if (byteLength(prompt) > RESEARCH_EXPANSION_PROMPT_LIMIT) {
      this.update({ phase: 'failed', prompt, reason: 'prompt_too_large' })
      return
    }
    void this.options.submit(prompt).then(
      () => {
        if (this.disposed || this.state.phase !== 'pending' || this.state.prompt !== prompt) return
        this.update({ phase: 'idle' })
      },
      (error: unknown) => {
        if (this.disposed || this.state.phase !== 'pending' || this.state.prompt !== prompt) return
        const code = error instanceof Error ? error.message : ''
        const reason: ResearchExpansionFailureReason =
          code === 'SESSION_UNAVAILABLE' ? 'SESSION_UNAVAILABLE' : 'RESEARCH_EXPANSION_REJECTED'
        this.update({ phase: 'failed', prompt, reason })
      },
    )
  }

  retry(): void {
    if (this.state.phase !== 'failed') return
    this.submit(this.state.prompt)
  }

  dispose(): void {
    this.disposed = true
  }

  private update(state: ResearchExpansionState): void {
    this.state = state
    this.options.onStateChange?.(state)
  }
}
