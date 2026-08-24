import type { LoadedProject } from '../core/parser.js'
import { buildProjection, type ProjectionEdge, type ProjectionEntity } from '../core/projection.js'
import { parseCommand, type ResearchCommand } from '../core/commands.js'
import { entityTypeOfId } from '../core/schema.js'
import {
  applyCommand,
  loadProjectState,
  type ResearchHostDeps,
  type SciForkFailure,
} from './apply-command.js'
import type { ContentBlock, ToolsPort, ToolDefinition, ToolRunContext } from './contracts.js'
import { readFocus, writeFocus, type FocusRecord } from './ui-state.js'

/**
 * The three model tools (architecture §7.2). Argument schemas use the
 * enforced dsh-tools JSON Schema subset (no minimum/maximum keywords);
 * authoritative validation lives in Core. Every execute path forwards
 * exec.signal and returns lossless JSON.
 */

export interface ResearchToolsDeps extends ResearchHostDeps {
  tools: ToolsPort
}

interface ToolExecInfo {
  sessionId: string | undefined
  sessionCwd: string | undefined
}

function execInfo(exec: ToolRunContext): ToolExecInfo {
  return {
    sessionId: exec.agent?.id,
    sessionCwd: exec.agent?.session?.header?.cwd,
  }
}

function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function errorValue(failure: SciForkFailure): Record<string, unknown> {
  return {
    ok: false,
    code: failure.code,
    message: failure.message,
    recoverable: failure.recoverable,
    ...(failure.entityId !== undefined ? { entityId: failure.entityId } : {}),
  }
}

// ---------------------------------------------------- read

const READ_PARAMETERS = {
  type: 'object',
  properties: {
    operation: {
      type: 'string',
      enum: ['summary', 'focus', 'entity', 'neighborhood', 'find', 'checkpoint'],
      description: 'summary | focus | entity | neighborhood | find | checkpoint',
    },
    entityId: { type: 'string', description: 'entity id for entity/neighborhood reads' },
    query: { type: 'string', description: 'case-insensitive substring for find' },
    limit: { type: 'integer', description: 'result cap for find, 1-50' },
  },
  required: ['operation'],
  additionalProperties: false,
}

function findMatches(project: LoadedProject, query: string, limit: number): { id: string; type: string }[] {
  const needle = query.toLowerCase()
  const matches: { id: string; type: string }[] = []
  const consider = (id: string, type: string, haystacks: string[]): void => {
    if (matches.length >= limit) return
    if (haystacks.some((haystack) => haystack.toLowerCase().includes(needle))) {
      matches.push({ id, type })
    }
  }
  for (const node of project.nodes.values()) {
    consider(node.id, 'node', [node.id, node.body, node.kind])
  }
  for (const evidence of project.evidenceAssertions.values()) {
    consider(evidence.id, 'evidence', [evidence.id, evidence.body, evidence.assertion])
  }
  for (const result of project.results.values()) {
    consider(result.id, 'result', [result.id, result.body])
  }
  for (const edge of project.edges.values()) {
    consider(edge.id, 'edge', [edge.id, edge.relation])
  }
  return matches
}

function entityPayload(project: LoadedProject, entityId: string): Record<string, unknown> | undefined {
  const type = entityTypeOfId(entityId)
  if (type === 'node') {
    const node = project.nodes.get(entityId)
    return node !== undefined ? { type: 'node', kind: node.kind, confidence: node.confidence, evidenceRefs: node.evidence_refs ?? [], body: node.body } : undefined
  }
  if (type === 'evidence') {
    const evidence = project.evidenceAssertions.get(entityId)
    return evidence !== undefined
      ? {
          type: 'evidence',
          assertion: evidence.assertion,
          direction: evidence.direction,
          reviewStatus: evidence.review_status,
          publicationRef: evidence.publication_ref,
          locator: evidence.locator,
          ...(evidence.limitations !== undefined ? { limitations: evidence.limitations } : {}),
          body: evidence.body,
        }
      : undefined
  }
  if (type === 'result') {
    const result = project.results.get(entityId)
    return result !== undefined
      ? { type: 'result', status: result.status, observedAt: result.observed_at, body: result.body }
      : undefined
  }
  return undefined
}

async function executeRead(
  deps: ResearchHostDeps,
  args: Record<string, unknown>,
  exec: ToolRunContext,
): Promise<Record<string, unknown>> {
  const info = execInfo(exec)
  const context = await loadProjectState(deps, info.sessionCwd, exec.signal)
  if (!('root' in context)) return errorValue(context)
  const { project, manifest, branch, head, undo } = context
  const operation = typeof args['operation'] === 'string' ? args['operation'] : ''
  const readOnly = project.diagnostics.length > 0

  if (operation === 'summary') {
    return {
      ok: true,
      projectId: manifest?.project_id,
      name: manifest?.name,
      schemaVersion: manifest?.schema_version,
      revision: project.projectRevision,
      counts: {
        nodes: project.nodes.size,
        edges: project.edges.size,
        evidenceAssertions: project.evidenceAssertions.size,
        results: project.results.size,
      },
      diagnosticCount: project.diagnostics.length,
      readOnly,
      branch,
      head,
    }
  }

  if (operation === 'focus') {
    if (info.sessionId === undefined || manifest?.project_id === undefined) {
      return { ok: false, code: 'SESSION_UNAVAILABLE', message: 'no session or project context', recoverable: false }
    }
    const focus = await readFocus(deps.storage, info.sessionId, manifest.project_id)
    return {
      ok: true,
      focus,
      ...(focus !== undefined ? { entityExists: entityPayload(project, focus.focusEntityId) !== undefined } : {}),
    }
  }

  if (operation === 'entity' || operation === 'neighborhood') {
    const entityId = typeof args['entityId'] === 'string' ? args['entityId'] : ''
    const entity = entityPayload(project, entityId)
    if (entity === undefined) {
      return { ok: false, code: 'INVALID_ENTITY', message: `entity ${entityId} does not exist`, recoverable: true, entityId }
    }
    if (operation === 'entity') return { ok: true, entityId, entity }
    const edges = buildProjection(project).edges.filter((edge) => edge.from === entityId || edge.to === entityId)
    return { ok: true, entityId, entity, edges }
  }

  if (operation === 'find') {
    const query = typeof args['query'] === 'string' ? args['query'] : ''
    if (query.length === 0) {
      return { ok: false, code: 'INVALID_ENTITY', message: 'find requires a query', recoverable: true }
    }
    const rawLimit = typeof args['limit'] === 'number' && Number.isInteger(args['limit']) ? args['limit'] : 20
    const limit = Math.min(Math.max(rawLimit, 1), 50)
    return { ok: true, query, matches: findMatches(project, query, limit) }
  }

  if (operation === 'checkpoint') {
    return {
      ok: true,
      branch,
      head,
      lastCheckpointId: undo?.lastCheckpointId,
      previousCheckpointId: undo?.previousCheckpointId,
      forwardCheckpointId: undo?.forwardCheckpointId,
      backAvailable: undo !== undefined && undo.previousCheckpointId !== undefined && !readOnly,
      forwardAvailable: undo !== undefined && undo.forwardCheckpointId !== undefined && !readOnly,
    }
  }

  return { ok: false, code: 'INVALID_ENTITY', message: `unknown read operation ${operation}`, recoverable: true }
}

// ---------------------------------------------------- apply

const APPLY_PARAMETERS = {
  type: 'object',
  properties: {
    command: {
      type: 'object',
      description:
        'One typed single-entity command. kind: create_evidence_assertion | review_evidence_assertion | ' +
        'create_node | update_node | create_edge | update_edge | create_result | update_result | import_draft_item. ' +
        'Creates take id plus entity fields; updates/reviews take id + expectedFileVersion + at least one change; ' +
        'import_draft_item takes id, index, and the full validated Research Import Draft.',
    },
    expectedProjectRevision: { type: 'string', description: 'projectRevision from the last research_graph_read' },
  },
  required: ['command', 'expectedProjectRevision'],
  additionalProperties: false,
}

async function executeApply(
  deps: ResearchHostDeps,
  args: Record<string, unknown>,
  exec: ToolRunContext,
): Promise<Record<string, unknown>> {
  const info = execInfo(exec)
  const parsed = parseCommand(args['command'])
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'INVALID_ENTITY',
      message: `invalid command: ${parsed.issues.join('; ')}`,
      recoverable: true,
    }
  }
  const expectedProjectRevision = typeof args['expectedProjectRevision'] === 'string' ? args['expectedProjectRevision'] : ''
  const result = await applyCommand(deps, {
    sessionId: info.sessionId ?? '',
    sessionCwd: info.sessionCwd,
    command: parsed.value,
    expectedProjectRevision,
    signal: exec.signal,
  })
  if (!result.ok) return errorValue(result)
  return {
    ok: true,
    kind: result.kind,
    entityId: result.entityId,
    revision: result.revision,
    checkpointId: result.checkpointId,
  }
}

// ---------------------------------------------------- focus

const FOCUS_PARAMETERS = {
  type: 'object',
  properties: {
    focusEntityId: {
      type: 'string',
      description: 'entity id to focus; empty string clears the focus',
    },
    pathIds: { type: 'array', items: { type: 'string' }, description: 'ids along the path to the focus (<= 32)' },
  },
  additionalProperties: false,
}

async function executeFocus(
  deps: ResearchHostDeps,
  args: Record<string, unknown>,
  exec: ToolRunContext,
): Promise<Record<string, unknown>> {
  const info = execInfo(exec)
  const context = await loadProjectState(deps, info.sessionCwd, exec.signal)
  if (!('root' in context)) return errorValue(context)
  const { project, manifest } = context
  if (info.sessionId === undefined || manifest?.project_id === undefined) {
    return { ok: false, code: 'SESSION_UNAVAILABLE', message: 'no session or project context', recoverable: false }
  }
  const focusEntityId = typeof args['focusEntityId'] === 'string' ? args['focusEntityId'] : ''
  if (focusEntityId.length > 0) {
    if (entityPayload(project, focusEntityId) === undefined) {
      return { ok: false, code: 'INVALID_ENTITY', message: `entity ${focusEntityId} does not exist`, recoverable: true, entityId: focusEntityId }
    }
  }
  const rawPath = Array.isArray(args['pathIds']) ? args['pathIds'] : []
  const pathIds = rawPath.filter((entry): entry is string => typeof entry === 'string')
  for (const pathId of pathIds) {
    if (entityPayload(project, pathId) === undefined) {
      return { ok: false, code: 'INVALID_ENTITY', message: `path entity ${pathId} does not exist`, recoverable: true, entityId: pathId }
    }
  }
  if (pathIds.length > 32) {
    return { ok: false, code: 'INVALID_ENTITY', message: 'pathIds must not exceed 32 entries', recoverable: true }
  }
  if (focusEntityId.length === 0) {
    const table = deps.storage.table('focus')
    await table.delete(`${info.sessionId}:${manifest.project_id}`)
    return { ok: true, focus: undefined }
  }
  const record: FocusRecord = { focusEntityId, pathIds }
  await writeFocus(deps.storage, info.sessionId, manifest.project_id, record)
  return { ok: true, focus: record }
}

// ---------------------------------------------------- registration

function readTool(deps: ResearchHostDeps): ToolDefinition {
  return {
    name: 'research_graph_read',
    description:
      'Read the SciFork Research Graph for the current session project: summary, focus, entity, neighborhood, ' +
      'find, or checkpoint state. Read-only; never writes files or Git.',
    parameters: READ_PARAMETERS,
    output: { schema: { type: 'json' }, render: renderJson },
    execute: (args, exec) => executeRead(deps, (args ?? {}) as Record<string, unknown>, exec),
    timeoutMs: 15000,
    isConcurrencySafe: () => false,
  }
}

function applyTool(deps: ResearchHostDeps): ToolDefinition {
  return {
    name: 'research_graph_apply',
    description:
      'Apply one typed single-entity command to the SciFork Research Graph and create a local git checkpoint. ' +
      'Requires the current projectRevision. Model-proposed evidence stays candidate; only user-reviewed evidence ' +
      'supports Findings.',
    parameters: APPLY_PARAMETERS,
    output: { schema: { type: 'json' }, render: renderJson },
    execute: (args, exec) => executeApply(deps, (args ?? {}) as Record<string, unknown>, exec),
    timeoutMs: 30000,
    isConcurrencySafe: () => false,
  }
}

function focusTool(deps: ResearchHostDeps): ToolDefinition {
  return {
    name: 'research_graph_focus',
    description:
      'Set or clear the Focus sidecar for the current session and project. Affects only UI/chat context; never ' +
      'writes research files or Git.',
    parameters: FOCUS_PARAMETERS,
    output: { schema: { type: 'json' }, render: renderJson },
    execute: (args, exec) => executeFocus(deps, (args ?? {}) as Record<string, unknown>, exec),
    timeoutMs: 15000,
    isConcurrencySafe: () => false,
  }
}

export function registerResearchTools(deps: ResearchToolsDeps): () => void {
  const disposers = [
    deps.tools.register(readTool(deps)),
    deps.tools.register(applyTool(deps)),
    deps.tools.register(focusTool(deps)),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
