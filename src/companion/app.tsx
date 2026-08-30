import * as React from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import type {
  EntityDocument,
  FocusSuccess,
  ProjectionEdgeSummary,
  ProjectionEntitySummary,
  SnapshotGraph,
  SnapshotSuccess,
} from '../shared/companion-contract.js'
import { channelNameForPageKey } from '../shared/page-key.js'
import { CompanionApiClient, CompanionApiError } from './api.js'
import { DetailsMarkdown } from './details.js'
import { FocusSelectionQueue } from './focus-selection.js'
import {
  focusViewportCenter,
  layoutGraph,
  selectGraphView,
} from './graph.js'
import { clearStoredPageKey } from './page-key.js'
import { startVisiblePolling } from './polling.js'
import {
  RESEARCH_EXPANSION_ACTION_LABEL,
  SimulationChannel,
  buildResearchExpansionPrompt,
  type SimulationState,
} from './simulation.js'

type EntityFlowNode = Node<
  { entity: ProjectionEntitySummary; direction: 'LR' | 'TB' },
  'entity'
>
type RelationFlowEdge = Edge<{ edge: ProjectionEdgeSummary }>

const EMPTY_GRAPH: SnapshotGraph = { entities: [], edges: [] }

function humanize(value: string): string {
  return value.replaceAll('_', ' ')
}

type EntityTypeCarrier =
  | Pick<Extract<ProjectionEntitySummary, { type: 'node' }>, 'type' | 'kind'>
  | Pick<Extract<EntityDocument, { type: 'node' }>, 'type' | 'kind'>
  | { type: 'evidence' | 'result' | 'edge' }

function entityTypeLabel(entity: EntityTypeCarrier): string {
  if (entity.type === 'node') return entity.kind.toUpperCase()
  if (entity.type === 'evidence') return 'EVIDENCE'
  return entity.type.toUpperCase()
}

function entityTypeClass(entity: EntityTypeCarrier): string {
  return entity.type === 'node' ? entity.kind : entity.type
}

function entityMeta(entity: ProjectionEntitySummary): string {
  if (entity.type === 'node') {
    return (
      entity.confidence +
      ' confidence · ' +
      entity.referenceCount +
      ' refs (' +
      entity.reviewedEvidenceCount +
      ' reviewed)'
    )
  }
  if (entity.type === 'evidence') return entity.reviewStatus
  return entity.status
}

function EntityTypeMark(props: { entity: EntityTypeCarrier }): React.ReactElement {
  const typeClass = entityTypeClass(props.entity)
  return (
    <span className="entity-type-mark">
      <span
        className={'entity-type-dot entity-type-' + typeClass}
        aria-hidden="true"
      />
      <span>{entityTypeLabel(props.entity)}</span>
    </span>
  )
}

export function EntityNodeCard(props: {
  entity: ProjectionEntitySummary
}): React.ReactElement {
  const { entity } = props
  return (
    <div className="entity-node-card">
      <div
        className="entity-node-content"
        tabIndex={0}
        aria-label={entityTypeLabel(entity) + ': ' + entity.label}
      >
        <span className="entity-node-kind">
          <EntityTypeMark entity={entity} />
        </span>
        <strong>{entity.label}</strong>
        <span className="entity-node-meta">{entityMeta(entity)}</span>
      </div>
    </div>
  )
}

export function HeaderIdentity(props: {
  projectName: string
  branch?: string
  head?: string
}): React.ReactElement {
  return (
    <div className="header-identity flex min-w-0 items-center gap-3 whitespace-nowrap">
      <h1 className="shrink-0 text-xl font-semibold">SciFork</h1>
      <span className="project-name min-w-0 truncate text-sm">{props.projectName}</span>
      {props.branch === undefined ? null : (
        <span
          className="branch-chip inline-flex min-w-0 items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-xs font-semibold"
          aria-label="Current branch"
          title={props.head === undefined ? props.branch : props.branch + ' @ ' + props.head}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="4" cy="3" r="1.75" />
            <circle cx="4" cy="13" r="1.75" />
            <circle cx="12" cy="5" r="1.75" />
            <path d="M4 4.75v6.5M5.75 11c3.5 0 6.25-1.5 6.25-4.25" />
          </svg>
          <span className="truncate">{props.branch}</span>
        </span>
      )}
    </div>
  )
}

function EntityNode(props: NodeProps<EntityFlowNode>): React.ReactElement {
  const { entity, direction } = props.data
  const vertical = direction === 'TB'
  return (
    <div className="entity-node-shell">
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        className="entity-handle"
      />
      <EntityNodeCard entity={entity} />
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        className="entity-handle"
      />
    </div>
  )
}

const NODE_TYPES = { entity: EntityNode } as NodeTypes

interface GraphPaneProps {
  graph: SnapshotGraph
  focusEntityId: string | undefined
  pendingEntityId: string | undefined
  pathIds: readonly string[]
  onSelect(entityId: string): void
}

function useNarrowGraphLayout(): boolean {
  const query = '(max-width: 760px)'
  const [narrow, setNarrow] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  React.useEffect(() => {
    const media = window.matchMedia(query)
    const update = (): void => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

function GraphPane(props: GraphPaneProps): React.ReactElement {
  const narrow = useNarrowGraphLayout()
  const direction = narrow ? 'TB' : 'LR'
  const [flow, setFlow] = React.useState<
    ReactFlowInstance<EntityFlowNode, RelationFlowEdge> | undefined
  >()
  const laidOut = React.useMemo(
    () => layoutGraph(props.graph, direction),
    [props.graph, direction],
  )
  const focusCenter = React.useMemo(
    () =>
      props.focusEntityId === undefined
        ? undefined
        : focusViewportCenter(laidOut, props.focusEntityId),
    [laidOut, props.focusEntityId],
  )
  React.useEffect(() => {
    if (flow === undefined || focusCenter === undefined) return
    const { zoom } = flow.getViewport()
    void flow.setCenter(focusCenter.x, focusCenter.y, { zoom, duration: 250 })
  }, [flow, focusCenter])
  const pathIds = React.useMemo(() => new Set(props.pathIds), [props.pathIds])
  const nodes: EntityFlowNode[] = React.useMemo(
    () =>
      laidOut.nodes.map((node) => {
        const className =
          node.id === props.pendingEntityId
            ? 'graph-node-pending'
            : node.id === props.focusEntityId
            ? 'graph-node-focus'
            : pathIds.has(node.id)
              ? 'graph-node-path'
              : undefined
        return {
          ...node,
          data: { ...node.data, direction },
          ...(className === undefined ? {} : { className }),
        }
      }),
    [laidOut.nodes, pathIds, props.focusEntityId, props.pendingEntityId, direction],
  )
  const edges: RelationFlowEdge[] = React.useMemo(
    () =>
      laidOut.edges.map((edge) => ({
        ...edge,
        className: [
          'graph-edge-' + edge.data.edge.relation,
          edge.data.edge.id === props.focusEntityId ? 'graph-edge-focus' : '',
          edge.data.edge.id === props.pendingEntityId ? 'graph-edge-pending' : '',
        ]
          .filter(Boolean)
          .join(' '),
      })),
    [laidOut.edges, props.focusEntityId, props.pendingEntityId],
  )
  const layoutKey =
    direction +
    ':' +
    nodes.map(({ id }) => id).join('|') +
    ':' +
    edges.map(({ id }) => id).join('|')

  return (
    <section className="graph-pane" aria-label="Research Graph">
      <ReactFlow<EntityFlowNode, RelationFlowEdge>
        key={layoutKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.35, maxZoom: 1.2 }}
        minZoom={0.25}
        maxZoom={1.6}
        onInit={setFlow}
        onNodeClick={(_event, node) => props.onSelect(node.id)}
        onEdgeClick={(_event, edge) => {
          const edgeId = edge.data?.edge.id
          if (edgeId !== undefined) props.onSelect(edgeId)
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#d4d8d5" gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </section>
  )
}

function EdgeDetails(props: {
  entity: Extract<EntityDocument, { type: 'edge' }>
}): React.ReactElement {
  const { entity } = props
  return (
    <dl className="structured-details">
      <dt>Relation</dt>
      <dd>{humanize(entity.relation)}</dd>
      <dt>From</dt>
      <dd>{entity.from}</dd>
      <dt>To</dt>
      <dd>{entity.to}</dd>
      <dt>Basis</dt>
      <dd>{humanize(entity.basis)}</dd>
      {entity.publicationRefs === undefined ? null : (
        <>
          <dt>Research references</dt>
          <dd>{entity.publicationRefs.length}</dd>
        </>
      )}
      {entity.provenance === undefined ? null : (
        <>
          <dt>Provenance</dt>
          <dd>{entity.provenance}</dd>
        </>
      )}
      {entity.evidenceGap === undefined ? null : (
        <>
          <dt>Evidence Gap</dt>
          <dd>{entity.evidenceGap}</dd>
        </>
      )}
    </dl>
  )
}

export interface DetailsPaneProps {
  entity: EntityDocument | undefined
  focusEntityId: string | undefined
  open: boolean
  onToggle(): void
}

function DrawerChevron(props: { action: 'open' | 'close' }): React.ReactElement {
  return (
    <svg
      className="drawer-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d={props.action === 'close' ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
    </svg>
  )
}

export function DetailsPane(props: DetailsPaneProps): React.ReactElement {
  const { entity } = props
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => setCopied(false), [entity?.id])

  const copyId = (): void => {
    if (entity === undefined || typeof navigator === 'undefined') return
    void navigator.clipboard
      ?.writeText(entity.id)
      .then(() => setCopied(true))
      .catch(() => undefined)
  }

  if (!props.open) {
    return (
      <aside className="details-pane details-pane-closed" aria-label="Details">
        <button
          type="button"
          className="details-handle"
          aria-label="Open Details"
          aria-expanded={false}
          data-drawer-action="open"
          onClick={props.onToggle}
        >
          <DrawerChevron action="open" />
          <strong>Details</strong>
        </button>
      </aside>
    )
  }

  return (
    <aside className="details-pane" aria-label="Details">
      <header className="pane-heading">
        <div className="pane-title">
          <h2>Details</h2>
          {entity === undefined ? null : <EntityTypeMark entity={entity} />}
        </div>
        <button
          type="button"
          className="details-toggle"
          aria-label="Close Details"
          aria-expanded={true}
          data-drawer-action="close"
          onClick={props.onToggle}
        >
          <DrawerChevron action="close" />
        </button>
        {entity === undefined ? null : (
          <div className="details-identity">
            <code title={entity.id}>{entity.id}</code>
            {props.focusEntityId === entity.id ? <span className="focus-badge">Focused</span> : null}
            <button type="button" onClick={copyId}>
              {copied ? 'Copied' : 'Copy ID'}
            </button>
          </div>
        )}
        {entity?.type === 'node' ? (
          <div className="details-reference-counts">
            <span><strong>{entity.referenceCount}</strong> refs</span>
            <span><strong>{entity.reviewedEvidenceCount}</strong> reviewed</span>
          </div>
        ) : null}
      </header>
      <div className="details-body" tabIndex={0} aria-label="Details content">
        {entity === undefined ? (
          <div className="details-empty" aria-label="No Details" />
        ) : entity.type === 'edge' ? (
          <EdgeDetails entity={entity} />
        ) : (
          <article className="markdown-details">
            <DetailsMarkdown markdown={entity.body} />
          </article>
        )}
      </div>
    </aside>
  )
}

export function InvalidKeyView(): React.ReactElement {
  return (
    <main className="invalid-key-view">
      <button type="button" onClick={() => window.close()}>
        Reopen from DSH
      </button>
    </main>
  )
}

function failureMessage(error: unknown): string {
  return error instanceof CompanionApiError
    ? error.message
    : 'The Companion is temporarily unavailable.'
}

function simulationLabel(state: SimulationState): string | undefined {
  if (state.phase !== 'acknowledged') return undefined
  return state.acknowledgement === 'started' ? 'Started' : 'Queued'
}

export function CompanionApp(props: { pageKey: string }): React.ReactElement {
  const [invalidKey, setInvalidKey] = React.useState(false)
  const [snapshot, setSnapshot] = React.useState<SnapshotSuccess>()
  const [graph, setGraph] = React.useState<SnapshotGraph>()
  const [selectedId, setSelectedId] = React.useState<string>()
  const [details, setDetails] = React.useState<EntityDocument>()
  const [detailsOpen, setDetailsOpen] = React.useState(true)
  const [error, setError] = React.useState<string>()
  const [pendingFocusId, setPendingFocusId] = React.useState<string>()
  const [simulationState, setSimulationState] = React.useState<SimulationState>({
    phase: 'idle',
  })
  const snapshotRef = React.useRef<SnapshotSuccess | undefined>(undefined)
  const graphRef = React.useRef<SnapshotGraph | undefined>(undefined)
  const selectedIdRef = React.useRef<string | undefined>(undefined)
  const mountedRef = React.useRef(true)
  const detailsRequestRef = React.useRef(0)
  const focusQueueRef = React.useRef<FocusSelectionQueue<FocusSuccess> | undefined>(undefined)
  const snapshotInFlightRef = React.useRef(false)
  const simulationRef = React.useRef<SimulationChannel | undefined>(undefined)

  React.useEffect(
    () => () => {
      mountedRef.current = false
      detailsRequestRef.current += 1
    },
    [],
  )

  const api = React.useMemo(
    () =>
      new CompanionApiClient({
        pageKey: props.pageKey,
        onPageKeyInvalid: () => {
          clearStoredPageKey(window.sessionStorage)
          if (mountedRef.current) setInvalidKey(true)
        },
      }),
    [props.pageKey],
  )

  const loadDetails = React.useCallback(
    async (entityId: string): Promise<void> => {
      const request = ++detailsRequestRef.current
      try {
        const response = await api.entity(entityId)
        if (!mountedRef.current || request !== detailsRequestRef.current) return
        setDetails(response.entity)
      } catch (caught) {
        if (!mountedRef.current || request !== detailsRequestRef.current) return
        if (caught instanceof CompanionApiError && caught.code === 'PAGE_KEY_INVALID') return
        setDetails(undefined)
        setError(failureMessage(caught))
      }
    },
    [api],
  )

  React.useEffect(() => {
    const queue = new FocusSelectionQueue<FocusSuccess>({
      setFocus: (entityId) => api.setFocus(entityId),
      onConfirmed: (entityId, response) => {
        if (!mountedRef.current) return
        setError(undefined)
        const current = snapshotRef.current
        if (current !== undefined) {
          const next = { ...current, focus: response.focus }
          snapshotRef.current = next
          setSnapshot(next)
        }
        selectedIdRef.current = entityId
        setSelectedId(entityId)
        void loadDetails(entityId)
      },
      onPendingChange: (entityId) => {
        if (mountedRef.current) setPendingFocusId(entityId)
      },
      onError: (caught) => {
        if (
          mountedRef.current &&
          !(caught instanceof CompanionApiError && caught.code === 'PAGE_KEY_INVALID')
        ) {
          setError(failureMessage(caught))
        }
      },
    })
    focusQueueRef.current = queue
    return () => {
      if (focusQueueRef.current === queue) focusQueueRef.current = undefined
      queue.dispose()
    }
  }, [api, loadDetails])

  const applySnapshot = React.useCallback(
    (response: SnapshotSuccess): void => {
      const previousRevision = snapshotRef.current?.project.revision
      snapshotRef.current = response
      setSnapshot(response)
      if (response.graph !== undefined) {
        graphRef.current = response.graph
        setGraph(response.graph)
      }
      setError(undefined)

      const focusId = response.focus?.focusEntityId
      if (
        focusId === selectedIdRef.current &&
        response.project.revision === previousRevision
      ) {
        return
      }
      selectedIdRef.current = focusId
      setSelectedId(focusId)
      if (focusId === undefined) {
        detailsRequestRef.current += 1
        setDetails(undefined)
      } else {
        void loadDetails(focusId)
      }
    },
    [loadDetails],
  )

  const refresh = React.useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (snapshotInFlightRef.current) return
      snapshotInFlightRef.current = true
      try {
        const response = await api.snapshot(snapshotRef.current?.project.revision, signal)
        if (mountedRef.current) applySnapshot(response)
      } catch (caught) {
        if (!mountedRef.current || signal?.aborted) return
        if (caught instanceof CompanionApiError && caught.code === 'PAGE_KEY_INVALID') return
        setError(failureMessage(caught))
      } finally {
        snapshotInFlightRef.current = false
      }
    },
    [api, applySnapshot],
  )

  React.useEffect(() => {
    if (invalidKey) return undefined
    const controller = new AbortController()
    const stop = startVisiblePolling({
      document,
      readSnapshot: () => refresh(controller.signal),
    })
    return () => {
      stop()
      controller.abort()
    }
  }, [invalidKey, refresh])

  React.useEffect(() => {
    if (invalidKey) return undefined
    let browserChannel: BroadcastChannel | undefined
    try {
      browserChannel =
        typeof BroadcastChannel === 'function'
          ? new BroadcastChannel(channelNameForPageKey(props.pageKey))
          : undefined
    } catch {
      browserChannel = undefined
    }
    const channel =
      browserChannel === undefined
        ? undefined
        : {
            postMessage: (message: Parameters<BroadcastChannel['postMessage']>[0]) =>
              browserChannel.postMessage(message),
            addEventListener: (
              _type: 'message',
              listener: (event: { data: unknown }) => void,
            ) => browserChannel.addEventListener('message', listener),
            removeEventListener: (
              _type: 'message',
              listener: (event: { data: unknown }) => void,
            ) => browserChannel.removeEventListener('message', listener),
            close: () => browserChannel.close(),
          }
    const simulation = new SimulationChannel({
      ...(channel === undefined ? {} : { channel }),
      onStateChange: (state) => {
        if (mountedRef.current) setSimulationState(state)
      },
    })
    simulationRef.current = simulation
    setSimulationState(simulation.getState())
    return () => {
      simulationRef.current = undefined
      simulation.dispose()
    }
  }, [invalidKey, props.pageKey])

  const selectEntity = React.useCallback((entityId: string): void => {
    setError(undefined)
    focusQueueRef.current?.select(entityId)
  }, [])

  const graphView = React.useMemo(
    () => selectGraphView(graph ?? EMPTY_GRAPH),
    [graph],
  )

  const simulate = (): void => {
    const focusEntityId = snapshotRef.current?.focus?.focusEntityId
    const latestGraph = graphRef.current
    if (focusEntityId === undefined || latestGraph === undefined) return
    simulationRef.current?.simulate(
      buildResearchExpansionPrompt({ focusEntityId, ...latestGraph }),
    )
  }

  const copyPrompt = (): void => {
    const state = simulationRef.current?.getState()
    if (state === undefined || state.phase === 'idle') return
    void navigator.clipboard?.writeText(state.prompt).catch(() => undefined)
  }

  if (invalidKey) return <InvalidKeyView />

  const project = snapshot?.project
  const focus = snapshot?.focus
  const acknowledgement = simulationLabel(simulationState)

  return (
    <main className="companion-app">
      <header className="app-header flex h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-sf-header-border bg-sf-header px-4 text-sf-header-foreground">
        <HeaderIdentity
          projectName={project?.name ?? 'Research Graph'}
          {...(project?.branch === undefined ? {} : { branch: project.branch })}
          {...(project?.head === undefined ? {} : { head: project.head })}
        />
        <div className="header-actions">
          {acknowledgement === undefined ? null : (
            <output className="simulation-ack">{acknowledgement}</output>
          )}
          {simulationState.phase === 'failed' ? (
            <>
              <button type="button" onClick={() => simulationRef.current?.retry()}>
                Retry
              </button>
              <button type="button" onClick={copyPrompt}>
                Copy
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="primary-action"
            disabled={focus === undefined || simulationState.phase === 'pending'}
            onClick={simulate}
          >
            {simulationState.phase === 'pending' ? 'Submitting' : RESEARCH_EXPANSION_ACTION_LABEL}
          </button>
        </div>
      </header>

      {project?.readOnly ? (
        <section className="read-only-banner" aria-label="Read-only project">
          <strong>Read-only</strong>
          <span>
            {project.diagnosticCount === 0
              ? project.gitError?.message ?? 'Project writes are unavailable.'
              : project.diagnostics
                  .slice(0, 3)
                  .map((diagnostic) => diagnostic.path + ': ' + diagnostic.code)
                  .join(' | ')}
          </span>
        </section>
      ) : null}
      {error === undefined || graph === undefined ? null : (
        <div className="inline-error" role="status">
          {error}
        </div>
      )}

      {graph === undefined ? (
        <section className="full-state" aria-live="polite">
          {error === undefined ? (
            <span>Loading graph</span>
          ) : (
            <>
              <span>{error}</span>
              <button type="button" onClick={() => void refresh()}>
                Retry
              </button>
            </>
          )}
        </section>
      ) : graph.entities.length === 0 ? (
        <section className="full-state">
          <span>No research entities</span>
        </section>
      ) : (
        <div className={'workspace ' + (detailsOpen ? 'details-open' : 'details-closed')}>
          <GraphPane
            graph={graphView}
            focusEntityId={focus?.focusEntityId}
            pendingEntityId={pendingFocusId}
            pathIds={focus?.pathIds ?? []}
            onSelect={selectEntity}
          />
          <DetailsPane
            entity={selectedId === details?.id ? details : undefined}
            focusEntityId={focus?.focusEntityId}
            open={detailsOpen}
            onToggle={() => setDetailsOpen((open) => !open)}
          />
        </div>
      )}
    </main>
  )
}
