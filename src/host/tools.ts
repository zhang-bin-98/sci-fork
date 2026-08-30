import type { LoadedProject } from '../core/parser.js'
import { buildProjection, type ProjectionEdge, type ProjectionEntity } from '../core/projection.js'
import { parseCommand, type ResearchCommand } from '../core/commands.js'
import { fileVersion } from '../core/revision.js'
import { entityFilePath, entityTypeOfId } from '../core/schema.js'
import {
  applyCommand,
  loadProjectState,
  type ResearchHostDeps,
  type SciForkFailure,
} from './apply-command.js'
import type { ContentBlock, StorageDomain, ToolsPort, ToolDefinition, ToolRunContext } from './contracts.js'
import { readFocus, writeFocus, type FocusRecord } from './ui-state.js'

/**
 * The three model tools (architecture §7.2). Argument schemas use the
 * enforced dsh-tools JSON Schema subset (no minimum/maximum keywords);
 * authoritative validation lives in Core. Every execute path forwards
 * exec.signal and returns lossless JSON.
 */

export interface ResearchToolsDeps extends ResearchHostDeps {
  tools: ToolsPort
  storage: StorageDomain
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
  if (type === 'edge') {
    const edge = project.edges.get(entityId)
    return edge !== undefined
      ? {
          type: 'edge',
          from: edge.from,
          to: edge.to,
          relation: edge.relation,
          basis: edge.basis,
          evidenceRefs: edge.evidence_refs ?? [],
          ...(edge.basis === 'ai_inference' && edge.provenance !== undefined ? { provenance: edge.provenance } : {}),
          ...(edge.basis === 'ai_inference' && edge.evidence_gap !== undefined ? { evidenceGap: edge.evidence_gap } : {}),
        }
      : undefined
  }
  return undefined
}

async function executeRead(
  deps: ResearchToolsDeps,
  args: Record<string, unknown>,
  exec: ToolRunContext,
): Promise<Record<string, unknown>> {
  const info = execInfo(exec)
  const context = await loadProjectState(deps, info.sessionCwd, exec.signal)
  if (!('root' in context)) return errorValue(context)
  const { project, manifest, branch, head, gitFailure } = context
  const operation = typeof args['operation'] === 'string' ? args['operation'] : ''
  const readOnly = project.diagnostics.length > 0 || gitFailure !== undefined
  const gitError = gitFailure === undefined
    ? {}
    : { gitError: { code: gitFailure.code, message: gitFailure.reason } }
  const manifestFields = manifest === undefined
    ? {}
    : { projectId: manifest.project_id, name: manifest.name, schemaVersion: manifest.schema_version }
  const gitFields = {
    ...(branch !== undefined ? { branch } : {}),
    ...(head !== undefined ? { head } : {}),
    ...gitError,
  }

  if (operation === 'summary') {
    return {
      ok: true,
      ...manifestFields,
      revision: project.projectRevision,
      counts: {
        nodes: project.nodes.size,
        edges: project.edges.size,
        evidenceAssertions: project.evidenceAssertions.size,
        results: project.results.size,
      },
      diagnosticCount: project.diagnostics.length,
      readOnly,
      ...gitFields,
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
    if (operation === 'entity') {
      const path = entityFilePath(entityId)
      const content = path === undefined ? undefined : project.files.get(path)
      if (content === undefined) {
        return { ok: false, code: 'INVALID_ENTITY', message: `entity ${entityId} has no managed file`, recoverable: false, entityId }
      }
      return { ok: true, entityId, entity, fileVersion: fileVersion(content, deps.hash) }
    }
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
      readOnly,
      ...gitFields,
    }
  }

  return { ok: false, code: 'INVALID_ENTITY', message: `unknown read operation ${operation}`, recoverable: true }
}

// ---------------------------------------------------- apply

function commandBranch(
  kind: string,
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: 'object',
    properties: { kind: { const: kind }, ...properties },
    required: ['kind', ...required],
    additionalProperties: false,
  }
}

const ID = { type: 'string' }
const VERSION = { type: 'string' }
const EVIDENCE_REFS = { type: 'array', items: { type: 'object' } }
const APPLY_COMMAND_SCHEMA = {
  type: 'object',
  oneOf: [
    commandBranch(
      'create_evidence_assertion',
      {
        id: ID,
        publicationRef: { type: 'object' },
        locator: { type: 'object' },
        assertion: { type: 'string' },
        direction: { type: 'string', enum: ['supports', 'contradicts', 'context'] },
        limitations: { type: 'array', items: { type: 'string' } },
        body: { type: 'string' },
      },
      ['id', 'locator', 'assertion', 'direction'],
    ),
    commandBranch(
      'review_evidence_assertion',
      {
        id: ID,
        expectedFileVersion: VERSION,
        reviewStatus: { type: 'string', enum: ['reviewed', 'rejected'] },
        limitations: { type: 'array', items: { type: 'string' } },
      },
      ['id', 'expectedFileVersion', 'reviewStatus'],
    ),
    commandBranch(
      'create_node',
      {
        id: ID,
        nodeKind: { type: 'string', enum: ['finding', 'hypothesis', 'prediction'] },
        confidence: { type: 'string', enum: ['low', 'moderate', 'high'] },
        evidenceRefs: EVIDENCE_REFS,
        body: { type: 'string' },
      },
      ['id', 'nodeKind', 'confidence', 'body'],
    ),
    commandBranch(
      'update_node',
      {
        id: ID,
        expectedFileVersion: VERSION,
        nodeKind: { type: 'string', enum: ['finding', 'hypothesis', 'prediction'] },
        confidence: { type: 'string', enum: ['low', 'moderate', 'high'] },
        evidenceRefs: EVIDENCE_REFS,
        body: { type: 'string' },
      },
      ['id', 'expectedFileVersion'],
    ),
    commandBranch(
      'create_edge',
      {
        id: ID,
        from: ID,
        to: ID,
        relation: { type: 'string', enum: ['supports', 'contradicts', 'causes', 'associated_with', 'predicts'] },
        basis: { type: 'string', enum: ['literature', 'experiment', 'ai_inference'] },
        evidenceRefs: EVIDENCE_REFS,
        provenance: { type: 'string' },
        evidenceGap: { type: 'string' },
      },
      ['id', 'from', 'to', 'relation', 'basis'],
    ),
    commandBranch(
      'update_edge',
      {
        id: ID,
        expectedFileVersion: VERSION,
        relation: { type: 'string', enum: ['supports', 'contradicts', 'causes', 'associated_with', 'predicts'] },
        basis: { type: 'string', enum: ['literature', 'experiment', 'ai_inference'] },
        evidenceRefs: EVIDENCE_REFS,
        provenance: { type: 'string' },
        evidenceGap: { type: 'string' },
      },
      ['id', 'expectedFileVersion'],
    ),
    commandBranch(
      'create_result',
      { id: ID, observedAt: { type: 'string' }, body: { type: 'string' } },
      ['id', 'observedAt', 'body'],
    ),
    commandBranch(
      'update_result',
      {
        id: ID,
        expectedFileVersion: VERSION,
        status: { type: 'string', enum: ['draft', 'validated', 'superseded'] },
        observedAt: { type: 'string' },
        body: { type: 'string' },
      },
      ['id', 'expectedFileVersion'],
    ),
    commandBranch(
      'import_draft_item',
      { id: ID, index: { type: 'integer' }, draft: { type: 'object' } },
      ['id', 'index', 'draft'],
    ),
    commandBranch(
      'delete_edge',
      { id: ID, expectedFileVersion: VERSION },
      ['id', 'expectedFileVersion'],
    ),
    commandBranch(
      'delete_node',
      { id: ID, expectedFileVersion: VERSION },
      ['id', 'expectedFileVersion'],
    ),
  ],
}

const APPLY_PARAMETERS = {
  type: 'object',
  properties: {
    command: {
      ...APPLY_COMMAND_SCHEMA,
      description:
        'One typed single-entity command. kind: create_evidence_assertion | review_evidence_assertion | ' +
        'create_node | update_node | create_edge | update_edge | create_result | update_result | import_draft_item | ' +
        'delete_edge | delete_node. ' +
        'Creates take id plus entity fields; updates/reviews take id + expectedFileVersion + at least one change; ' +
        'deletes take id + expectedFileVersion; import_draft_item takes id, index, and the full validated Research Import Draft.',
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
      oneOf: [{ type: 'string' }, { type: 'null' }],
      description: 'entity id to focus; empty string clears the focus',
    },
    pathIds: { type: 'array', items: { type: 'string' }, description: 'ids along the path to the focus (<= 32)' },
  },
  additionalProperties: false,
}

async function executeFocus(
  deps: ResearchToolsDeps,
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
  if ('focusEntityId' in args && args['focusEntityId'] !== undefined && args['focusEntityId'] !== null && typeof args['focusEntityId'] !== 'string') {
    return { ok: false, code: 'INVALID_ENTITY', message: 'focusEntityId must be a string or null', recoverable: true }
  }
  if ('pathIds' in args && args['pathIds'] !== undefined && (!Array.isArray(args['pathIds']) || args['pathIds'].some((entry) => typeof entry !== 'string'))) {
    return { ok: false, code: 'INVALID_ENTITY', message: 'pathIds must be an array of strings', recoverable: true }
  }
  const focusEntityId = args['focusEntityId'] === null || args['focusEntityId'] === undefined ? '' : args['focusEntityId'] as string
  if (focusEntityId.length > 0) {
    if (entityPayload(project, focusEntityId) === undefined) {
      return { ok: false, code: 'INVALID_ENTITY', message: `entity ${focusEntityId} does not exist`, recoverable: true, entityId: focusEntityId }
    }
  }
  const pathIds = args['pathIds'] === undefined ? [] : args['pathIds'] as string[]
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

function readTool(deps: ResearchToolsDeps): ToolDefinition {
  return {
    name: 'research_graph_read',
    description:
      'Read the SciFork Research Graph for the current session project: summary, focus, entity, neighborhood, ' +
      'find, or checkpoint state. Entity reads include fileVersion for guarded updates/deletes. Read-only; never writes files or Git.',
    parameters: READ_PARAMETERS,
    output: { schema: {}, render: renderJson },
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
      'supports Findings. Edge and detached Hypothesis/Prediction deletion is guarded by fileVersion and Core invariants.',
    parameters: APPLY_PARAMETERS,
    output: { schema: {}, render: renderJson },
    execute: (args, exec) => executeApply(deps, (args ?? {}) as Record<string, unknown>, exec),
    timeoutMs: 30000,
    isConcurrencySafe: () => false,
  }
}

function focusTool(deps: ResearchToolsDeps): ToolDefinition {
  return {
    name: 'research_graph_focus',
    description:
      'Set or clear the Focus sidecar for the current session and project. Affects only UI/chat context; never ' +
      'writes research files or Git.',
    parameters: FOCUS_PARAMETERS,
    output: { schema: {}, render: renderJson },
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
