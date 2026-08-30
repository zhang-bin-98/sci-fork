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

const BUTTON_BASE =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-sf-focus/45 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-default'
const BUTTON_NEUTRAL =
  BUTTON_BASE +
  ' border-sf-border-strong bg-sf-surface text-sf-ink hover:border-sf-muted hover:bg-sf-surface-muted disabled:border-sf-border disabled:bg-sf-disabled disabled:text-sf-disabled-foreground'
const BUTTON_HEADER =
  BUTTON_BASE +
  ' border-sf-header-control-border bg-sf-header-control text-sf-header-foreground hover:border-sf-header-control-hover-border hover:bg-sf-header-control-hover disabled:border-sf-header-disabled-border disabled:bg-sf-header-disabled disabled:text-sf-header-disabled-foreground focus-visible:ring-sf-header-focus focus-visible:ring-offset-sf-header'
const BUTTON_PRIMARY =
  BUTTON_BASE +
  ' border-sf-accent-border bg-sf-accent text-white shadow-sm hover:border-sf-accent-hover-border hover:bg-sf-accent-hover disabled:border-sf-header-disabled-border disabled:bg-sf-header-disabled disabled:text-sf-header-disabled-foreground focus-visible:ring-sf-header-focus focus-visible:ring-offset-sf-header'
const BUTTON_ICON =
  'inline-flex shrink-0 items-center justify-center rounded-md border border-sf-border-strong bg-sf-surface text-sf-muted transition-colors hover:border-sf-muted hover:bg-sf-surface-muted hover:text-sf-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-sf-focus/45 disabled:pointer-events-none'
const WORKSPACE_BASE = 'workspace grid min-h-0 flex-1 bg-sf-surface'
const WORKSPACE_OPEN =
  'grid-cols-[minmax(0,1fr)_minmax(320px,38vw)] [@media(max-width:1120px)]:grid-cols-[minmax(0,1fr)] [@media(max-width:1120px)]:grid-rows-[minmax(0,3fr)_minmax(220px,2fr)] [@media(max-width:480px)]:grid-rows-[minmax(0,55fr)_minmax(200px,45fr)]'
const WORKSPACE_CLOSED =
  'grid-cols-[minmax(0,1fr)_44px] [@media(max-width:1120px)]:grid-cols-[minmax(0,1fr)] [@media(max-width:1120px)]:grid-rows-[minmax(0,1fr)_44px]'

type EntityVisualType = 'finding' | 'hypothesis' | 'prediction' | 'evidence' | 'result' | 'edge'

const ENTITY_DOT_CLASS: Record<EntityVisualType, string> = {
  finding: 'bg-sf-finding ring-sf-finding/15',
  hypothesis: 'bg-sf-hypothesis ring-sf-hypothesis/15',
  prediction: 'bg-sf-prediction ring-sf-prediction/15',
  evidence: 'bg-sf-evidence ring-sf-evidence/15',
  result: 'bg-sf-result ring-sf-result/15',
  edge: 'bg-sf-edge ring-sf-edge/15',
}

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

function entityTypeClass(entity: EntityTypeCarrier): EntityVisualType {
  return entity.type === 'node' ? entity.kind : entity.type
}

export function formatReferenceCounts(referenceCount: number, reviewedCount: number): string {
  return `${referenceCount} ${referenceCount === 1 ? 'ref' : 'refs'} (${reviewedCount} reviewed)`
}

function entityMeta(entity: ProjectionEntitySummary): string {
  if (entity.type === 'node') {
    return (
      entity.confidence +
      ' confidence · ' +
      formatReferenceCounts(entity.referenceCount, entity.reviewedEvidenceCount)
    )
  }
  if (entity.type === 'evidence') return entity.reviewStatus
  return entity.status
}

function EntityTypeMark(props: { entity: EntityTypeCarrier }): React.ReactElement {
  const typeClass = entityTypeClass(props.entity)
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-bold tracking-wide text-sf-muted">
      <span
        className={'size-2 shrink-0 rounded-full ring-2 ' + ENTITY_DOT_CLASS[typeClass]}
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
    <div className="entity-node-card relative size-full">
      <div
        className="entity-node-content absolute inset-x-0 top-0 z-[1] grid min-h-full w-full grid-rows-[auto_auto_auto] gap-1 rounded-lg border border-sf-node-border bg-sf-surface px-3 py-2.5 text-left shadow-sm transition-shadow duration-150 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-sf-focus/45 focus-visible:ring-offset-2"
        tabIndex={0}
        aria-label={entityTypeLabel(entity) + ': ' + entity.label}
      >
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] leading-tight uppercase">
          <EntityTypeMark entity={entity} />
        </span>
        <strong className="entity-node-label self-center overflow-hidden [overflow-wrap:anywhere] text-[13px] leading-tight font-semibold [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
          {entity.label}
        </strong>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] leading-tight text-sf-muted">
          {entityMeta(entity)}
        </span>
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
    <div className="header-identity flex min-w-0 flex-1 items-center gap-3 whitespace-nowrap">
      <h1 className="m-0 shrink-0 text-xl leading-none font-semibold tracking-tight">SciFork</h1>
      <span className="min-w-0 max-w-[min(34vw,360px)] truncate text-sm text-sf-header-muted [@media(max-width:1120px)]:max-w-[24vw] [@media(max-width:480px)]:hidden">
        {props.projectName}
      </span>
      {props.branch === undefined ? null : (
        <span
          className="inline-flex min-w-0 max-w-[min(32vw,280px)] items-center gap-1.5 truncate rounded-full border border-sf-header-control-border bg-white/[0.08] px-2.5 py-1 text-xs font-semibold text-sf-header-chip [@media(max-width:1120px)]:max-w-[28vw] [@media(max-width:480px)]:max-w-[30vw] [@media(max-width:480px)]:px-2 [@media(max-width:360px)]:hidden"
          aria-label="Current branch"
          title={props.head === undefined ? props.branch : props.branch + ' @ ' + props.head}
        >
          <svg className="size-3.5 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 16 16" aria-hidden="true">
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

export function SimulationRecoveryControls(props: {
  placement: 'header' | 'narrow'
  onRetry: () => void
  onCopy: () => void
}): React.ReactElement {
  if (props.placement === 'header') {
    return (
      <div
        className="contents [@media(max-width:480px)]:hidden"
        data-simulation-recovery="header"
      >
        <button type="button" className={BUTTON_HEADER} onClick={props.onRetry}>
          Retry
        </button>
        <button type="button" className={BUTTON_HEADER} onClick={props.onCopy}>
          Copy
        </button>
      </div>
    )
  }

  return (
    <section
      className="hidden min-h-11 shrink-0 items-center gap-2 border-b border-sf-danger-border bg-sf-danger-soft px-2.5 py-1.5 text-xs text-sf-danger-foreground [@media(max-width:480px)]:flex"
      data-simulation-recovery="narrow"
      role="alert"
      aria-label="Research expansion failed"
    >
      <strong className="min-w-0 flex-1 truncate font-semibold">Research step failed</strong>
      <button type="button" className={BUTTON_NEUTRAL} onClick={props.onRetry}>
        Retry
      </button>
      <button type="button" className={BUTTON_NEUTRAL} onClick={props.onCopy}>
        Copy
      </button>
    </section>
  )
}

function EntityNode(props: NodeProps<EntityFlowNode>): React.ReactElement {
  const { entity, direction } = props.data
  const vertical = direction === 'TB'
  return (
    <div className="relative size-full">
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        className="!size-2 !border !border-white !bg-sf-handle"
      />
      <EntityNodeCard entity={entity} />
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        className="!size-2 !border !border-white !bg-sf-handle"
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
    <section
      className="graph-pane relative min-h-0 min-w-0 border-r border-sf-border bg-sf-surface-muted [@media(max-width:1120px)]:border-r-0 [@media(max-width:1120px)]:border-b"
      aria-label="Research Graph"
    >
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
    <dl className="m-0 grid grid-cols-[minmax(90px,0.32fr)_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 p-5 text-sm leading-6 text-sf-ink [@media(max-width:480px)]:grid-cols-1 [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-[11px] [&_dt]:font-bold [&_dt]:tracking-wide [&_dt]:text-sf-muted [&_dt]:uppercase">
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
      className="size-[18px] shrink-0 [@media(max-width:1120px)]:rotate-90"
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

function CopyIcon(props: { copied: boolean }): React.ReactElement {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {props.copied ? (
        <path d="m5 12 4 4L19 6" />
      ) : (
        <>
          <rect x="8" y="8" width="11" height="11" rx="2" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </>
      )}
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
      <aside
        className="details-pane details-pane-closed flex min-h-0 min-w-0 items-stretch justify-stretch border-l border-sf-border bg-sf-surface-muted [@media(max-width:1120px)]:border-t [@media(max-width:1120px)]:border-l-0"
        aria-label="Details"
      >
        <button
          type="button"
          className="flex size-full min-h-0 items-center justify-center gap-2 border-0 bg-transparent px-0 py-2 text-sm font-semibold text-sf-accent [writing-mode:vertical-rl] hover:bg-sf-accent-soft focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-sf-focus/45 [@media(max-width:1120px)]:px-3 [@media(max-width:1120px)]:py-0 [@media(max-width:1120px)]:[writing-mode:horizontal-tb]"
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
    <aside
      className="details-pane grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-sf-surface"
      aria-label="Details"
    >
      <header className="pane-heading z-[2] grid grid-rows-[auto_auto] gap-2 border-b border-sf-border bg-sf-surface px-4 py-3">
        <h2 className="sr-only">Details</h2>
        <div
          className="details-primary-row flex min-w-0 items-center gap-2"
          data-details-row="primary"
        >
          {entity === undefined ? null : <EntityTypeMark entity={entity} />}
          {entity?.type === 'node' ? (
            <span className="min-w-0 whitespace-nowrap text-[11px] text-sf-muted">
              {formatReferenceCounts(entity.referenceCount, entity.reviewedEvidenceCount)}
            </span>
          ) : null}
          {entity !== undefined && props.focusEntityId === entity.id ? (
            <span className="shrink-0 rounded-full bg-sf-accent-soft px-2 py-1 text-[10px] font-bold text-sf-accent">
              Focused
            </span>
          ) : null}
          <button
            type="button"
            className={BUTTON_ICON + ' ml-auto size-8'}
            aria-label="Close Details"
            aria-expanded={true}
            data-drawer-action="close"
            onClick={props.onToggle}
          >
            <DrawerChevron action="close" />
          </button>
        </div>
        <div
          className="details-id-row flex min-w-0 items-center gap-2 rounded-lg border border-sf-border bg-sf-surface-muted px-2.5 py-1.5"
          data-details-row="identity"
        >
          {entity === undefined ? (
            <span className="h-5" aria-hidden="true" />
          ) : (
            <>
              <code
                className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap text-sf-ink [scrollbar-width:thin]"
                title={entity.id}
              >
                {entity.id}
              </code>
              <button
                type="button"
                className={BUTTON_ICON + ' size-7'}
                aria-label={copied ? 'Copied' : 'Copy ID'}
                title={copied ? 'Copied' : 'Copy ID'}
                onClick={copyId}
              >
                <CopyIcon copied={copied} />
                <span className="sr-only">{copied ? 'Copied' : 'Copy ID'}</span>
              </button>
            </>
          )}
        </div>
      </header>
      <div
        className="details-body min-h-0 overflow-auto overscroll-contain"
        tabIndex={0}
        aria-label="Details content"
      >
        {entity === undefined ? (
          <div className="min-h-56" aria-label="No Details" />
        ) : entity.type === 'edge' ? (
          <EdgeDetails entity={entity} />
        ) : (
          <article className="markdown-details m-0 p-5 text-sm leading-[1.65] text-sf-ink [overflow-wrap:anywhere] [&_a]:text-sf-accent [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-2 [&_a]:focus-visible:rounded-sm [&_a]:focus-visible:outline-none [&_a]:focus-visible:ring-3 [&_a]:focus-visible:ring-sf-focus/45 [&_code]:font-mono [&_h1]:mt-0 [&_h1]:mb-3 [&_h1]:text-[21px] [&_h1]:leading-tight [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-sf-heading [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:text-sf-heading [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-sf-heading [&_pre]:overflow-x-auto [&_pre]:border-l-[3px] [&_pre]:border-sf-markdown-accent [&_pre]:bg-sf-surface-muted [&_pre]:px-3 [&_pre]:py-2.5 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_td]:border [&_td]:border-sf-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-left [&_th]:border [&_th]:border-sf-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left">
            <DetailsMarkdown markdown={entity.body} />
          </article>
        )}
      </div>
    </aside>
  )
}

export function InvalidKeyView(): React.ReactElement {
  return (
    <main className="flex size-full min-h-0 items-center justify-center gap-3 bg-sf-surface-muted text-sf-muted">
      <button type="button" className={BUTTON_NEUTRAL} onClick={() => window.close()}>
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
    <main className="companion-app flex h-dvh min-h-0 w-full flex-col bg-sf-canvas text-sf-ink">
      <header className="app-header flex h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-sf-header-border bg-sf-header px-4 text-sf-header-foreground [@media(max-width:480px)]:gap-2 [@media(max-width:480px)]:px-2.5">
        <HeaderIdentity
          projectName={project?.name ?? 'Research Graph'}
          {...(project?.branch === undefined ? {} : { branch: project.branch })}
          {...(project?.head === undefined ? {} : { head: project.head })}
        />
        <div className="ml-auto flex min-w-max items-center gap-2 [@media(max-width:480px)]:gap-1">
          {acknowledgement === undefined ? null : (
            <output className="min-w-14 text-right text-xs font-bold text-sf-header-success">
              {acknowledgement}
            </output>
          )}
          {simulationState.phase === 'failed' ? (
            <SimulationRecoveryControls
              placement="header"
              onRetry={() => simulationRef.current?.retry()}
              onCopy={copyPrompt}
            />
          ) : null}
          <button
            type="button"
            className={BUTTON_PRIMARY + ' [@media(max-width:480px)]:px-2.5'}
            disabled={focus === undefined || simulationState.phase === 'pending'}
            onClick={simulate}
          >
            {simulationState.phase === 'pending' ? 'Submitting' : RESEARCH_EXPANSION_ACTION_LABEL}
          </button>
        </div>
      </header>

      {simulationState.phase === 'failed' ? (
        <SimulationRecoveryControls
          placement="narrow"
          onRetry={() => simulationRef.current?.retry()}
          onCopy={copyPrompt}
        />
      ) : null}

      {project?.readOnly ? (
        <section
          className="flex min-h-10 shrink-0 items-center gap-2.5 border-b border-sf-warning-border bg-sf-warning-soft px-4 py-2 text-xs text-sf-warning-foreground"
          aria-label="Read-only project"
        >
          <strong className="font-bold">Read-only</strong>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [@media(max-width:1120px)]:whitespace-normal">
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
        <div
          className="flex min-h-10 shrink-0 items-center gap-2.5 border-b border-sf-danger-border bg-sf-danger-soft px-4 py-2 text-xs text-sf-danger-foreground"
          role="status"
        >
          {error}
        </div>
      )}

      {graph === undefined ? (
        <section
          className="flex min-h-0 flex-1 items-center justify-center gap-3 bg-sf-surface-muted text-sf-muted"
          aria-live="polite"
        >
          {error === undefined ? (
            <span>Loading graph</span>
          ) : (
            <>
              <span>{error}</span>
              <button type="button" className={BUTTON_NEUTRAL} onClick={() => void refresh()}>
                Retry
              </button>
            </>
          )}
        </section>
      ) : graph.entities.length === 0 ? (
        <section className="flex min-h-0 flex-1 items-center justify-center gap-3 bg-sf-surface-muted text-sf-muted">
          <span>No research entities</span>
        </section>
      ) : (
        <div className={WORKSPACE_BASE + ' ' + (detailsOpen ? WORKSPACE_OPEN : WORKSPACE_CLOSED)}>
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
