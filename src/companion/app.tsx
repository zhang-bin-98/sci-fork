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
  ResearchExpansionChannel,
  buildResearchExpansionPrompt,
  type ResearchExpansionState,
} from './research-expansion.js'

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
  ' border-sf-header-foreground bg-sf-header-foreground text-sf-header hover:border-sf-accent-soft hover:bg-sf-accent-soft hover:text-sf-accent disabled:border-sf-header-disabled-border disabled:bg-sf-header-disabled disabled:text-sf-header-disabled-foreground focus-visible:ring-sf-header-focus focus-visible:ring-offset-sf-header'
const BUTTON_ICON =
  'inline-flex shrink-0 items-center justify-center rounded-md border border-sf-border-strong bg-sf-surface text-sf-muted transition-colors hover:border-sf-muted hover:bg-sf-surface-muted hover:text-sf-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-sf-focus/45 disabled:pointer-events-none'
const WORKSPACE_BASE = 'workspace grid min-h-0 flex-1 bg-sf-surface'
const WORKSPACE_OPEN =
  'grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,55fr)_minmax(200px,45fr)] sm:grid-rows-[minmax(0,3fr)_minmax(220px,2fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,38vw)] xl:grid-rows-[minmax(0,1fr)]'
const WORKSPACE_CLOSED =
  'grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_44px] xl:grid-cols-[minmax(0,1fr)_44px] xl:grid-rows-[minmax(0,1fr)]'

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
    <div className="header-identity flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap sm:gap-3">
      <h1 className="m-0 shrink-0 text-xl leading-none font-semibold tracking-tight">SciFork</h1>
      <span className="hidden min-w-0 max-w-[24vw] truncate text-sm text-sf-header-muted md:block xl:max-w-[min(34vw,360px)]">
        {props.projectName}
      </span>
      {props.branch === undefined ? null : (
        <span
          className="hidden min-w-0 max-w-[30vw] items-center gap-1.5 truncate rounded-full border border-sf-header-control-border bg-white/[0.08] px-2 py-1 text-xs font-semibold text-sf-header-chip sm:inline-flex md:max-w-[28vw] md:px-2.5 xl:max-w-[min(32vw,280px)]"
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

export function ResearchExpansionRecoveryControls(props: {
  placement: 'header' | 'narrow'
  onRetry: () => void
  onCopy: () => void
}): React.ReactElement {
  if (props.placement === 'header') {
    return (
      <div
        className="hidden sm:contents"
        data-research-expansion-recovery="header"
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
      className="flex min-h-11 shrink-0 items-center gap-2 border-b border-sf-danger-border bg-sf-danger-soft px-2.5 py-1.5 text-xs text-sf-danger-foreground sm:hidden"
      data-research-expansion-recovery="narrow"
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

const TAILWIND_MD_QUERY = '(min-width: 48rem)'

function useWideGraphLayout(): boolean {
  const [wide, setWide] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia(TAILWIND_MD_QUERY).matches,
  )
  React.useEffect(() => {
    const media = window.matchMedia(TAILWIND_MD_QUERY)
    const update = (): void => setWide(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return wide
}

function GraphPane(props: GraphPaneProps): React.ReactElement {
  const wide = useWideGraphLayout()
  const direction = wide ? 'LR' : 'TB'
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
      className="graph-pane relative min-h-0 min-w-0 border-b border-sf-border bg-sf-surface-muted xl:border-r xl:border-b-0"
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
        <Background color="var(--color-sf-graph-grid)" gap={24} size={1} />
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
    <dl className="m-0 grid grid-cols-1 gap-x-3.5 gap-y-2.5 p-5 text-sm leading-6 text-sf-ink sm:grid-cols-[minmax(90px,0.32fr)_minmax(0,1fr)] [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-[11px] [&_dt]:font-bold [&_dt]:tracking-wide [&_dt]:text-sf-muted [&_dt]:uppercase">
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
      className="size-[18px] shrink-0 rotate-90 xl:rotate-0"
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

interface ClipboardWriter {
  writeText(value: string): Promise<void>
}

export type CopyFeedback = 'idle' | 'success' | 'failure'

export interface EntityIdCopyFeedback {
  entityId: string | undefined
  requestId: number
  status: CopyFeedback
}

interface SettledEntityIdCopy {
  entityId: string
  requestId: number
  status: Exclude<CopyFeedback, 'idle'>
}

export async function copyEntityId(
  entityId: string,
  clipboard: ClipboardWriter | undefined,
): Promise<Exclude<CopyFeedback, 'idle'>> {
  if (clipboard === undefined) return 'failure'
  try {
    await clipboard.writeText(entityId)
    return 'success'
  } catch {
    return 'failure'
  }
}

export function settleEntityIdCopyFeedback(
  current: EntityIdCopyFeedback,
  activeEntityId: string | undefined,
  settled: SettledEntityIdCopy,
): EntityIdCopyFeedback {
  if (
    activeEntityId !== settled.entityId ||
    current.entityId !== settled.entityId ||
    current.requestId !== settled.requestId
  ) {
    return current
  }
  return settled
}

export function DetailsPane(props: DetailsPaneProps): React.ReactElement {
  const { entity } = props
  const copyRequestRef = React.useRef(0)
  const activeEntityIdRef = React.useRef(entity?.id)
  activeEntityIdRef.current = entity?.id
  const [copyFeedback, setCopyFeedback] = React.useState<EntityIdCopyFeedback>({
    entityId: entity?.id,
    requestId: 0,
    status: 'idle',
  })
  React.useEffect(() => {
    const requestId = ++copyRequestRef.current
    setCopyFeedback({ entityId: entity?.id, requestId, status: 'idle' })
  }, [entity?.id])
  React.useEffect(() => {
    if (
      copyFeedback.status === 'idle' ||
      copyFeedback.entityId !== entity?.id ||
      typeof window === 'undefined'
    ) {
      return undefined
    }
    const requestId = copyFeedback.requestId
    const timeout = window.setTimeout(
      () =>
        setCopyFeedback((current) =>
          current.requestId === requestId ? { ...current, status: 'idle' } : current,
        ),
      1800,
    )
    return () => window.clearTimeout(timeout)
  }, [copyFeedback, entity?.id])

  const copyId = (): void => {
    if (entity === undefined) return
    const entityId = entity.id
    const requestId = ++copyRequestRef.current
    setCopyFeedback({ entityId, requestId, status: 'idle' })
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    void copyEntityId(entityId, clipboard).then((status) =>
      setCopyFeedback((current) =>
        settleEntityIdCopyFeedback(current, activeEntityIdRef.current, {
          entityId,
          requestId,
          status,
        }),
      ),
    )
  }

  const visibleCopyStatus =
    copyFeedback.entityId === entity?.id ? copyFeedback.status : 'idle'
  const copyMessage =
    visibleCopyStatus === 'success'
      ? 'Copied'
      : visibleCopyStatus === 'failure'
        ? 'Copy failed'
        : ''

  if (!props.open) {
    return (
      <aside
        className="details-pane details-pane-closed flex min-h-0 min-w-0 items-stretch justify-stretch border-t border-sf-border bg-sf-surface-muted xl:border-t-0 xl:border-l"
        aria-label="Details"
      >
        <button
          type="button"
          className="flex size-full min-h-0 items-center justify-center gap-2 border-0 bg-transparent px-3 py-0 text-sm font-semibold text-sf-accent hover:bg-sf-accent-soft focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-sf-focus/45 xl:px-0 xl:py-2 xl:[writing-mode:vertical-rl]"
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
      <header className="pane-heading z-[2] grid grid-rows-[auto_auto] gap-1.5 border-b border-sf-border bg-sf-surface px-4 py-2.5">
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
        {entity === undefined ? (
          <div className="h-4" data-details-row="identity" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="details-id-row group flex w-full min-w-0 items-center gap-2 overflow-hidden border-0 bg-transparent p-0 text-left text-sf-muted hover:text-sf-accent focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-focus/45"
            data-details-row="identity"
            aria-label={`Copy entity ID ${entity.id}`}
            onClick={copyId}
          >
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[10px] whitespace-nowrap [scrollbar-width:thin]">
              {entity.id}
            </code>
            <span
              className="w-14 shrink-0 text-right text-[10px] font-semibold text-sf-accent"
              aria-hidden="true"
            >
              {copyMessage}
            </span>
          </button>
        )}
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {copyMessage}
        </span>
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

function researchExpansionLabel(state: ResearchExpansionState): string | undefined {
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
  const [researchExpansionState, setResearchExpansionState] =
    React.useState<ResearchExpansionState>({
    phase: 'idle',
  })
  const snapshotRef = React.useRef<SnapshotSuccess | undefined>(undefined)
  const graphRef = React.useRef<SnapshotGraph | undefined>(undefined)
  const selectedIdRef = React.useRef<string | undefined>(undefined)
  const mountedRef = React.useRef(true)
  const detailsRequestRef = React.useRef(0)
  const focusQueueRef = React.useRef<FocusSelectionQueue<FocusSuccess> | undefined>(undefined)
  const snapshotInFlightRef = React.useRef(false)
  const researchExpansionRef =
    React.useRef<ResearchExpansionChannel | undefined>(undefined)

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
    const researchExpansion = new ResearchExpansionChannel({
      ...(channel === undefined ? {} : { channel }),
      onStateChange: (state) => {
        if (mountedRef.current) setResearchExpansionState(state)
      },
    })
    researchExpansionRef.current = researchExpansion
    setResearchExpansionState(researchExpansion.getState())
    return () => {
      researchExpansionRef.current = undefined
      researchExpansion.dispose()
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

  const submitResearchExpansion = (): void => {
    const focusEntityId = snapshotRef.current?.focus?.focusEntityId
    const latestGraph = graphRef.current
    if (focusEntityId === undefined || latestGraph === undefined) return
    researchExpansionRef.current?.submit(
      buildResearchExpansionPrompt({ focusEntityId, ...latestGraph }),
    )
  }

  const copyPrompt = (): void => {
    const state = researchExpansionRef.current?.getState()
    if (state === undefined || state.phase === 'idle') return
    void navigator.clipboard?.writeText(state.prompt).catch(() => undefined)
  }

  if (invalidKey) return <InvalidKeyView />

  const project = snapshot?.project
  const focus = snapshot?.focus
  const acknowledgement = researchExpansionLabel(researchExpansionState)

  return (
    <main className="companion-app flex h-dvh min-h-0 w-full flex-col bg-sf-canvas text-sf-ink">
      <header className="app-header flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b border-sf-header-border bg-sf-header px-2.5 text-sf-header-foreground sm:gap-3 sm:px-4">
        <HeaderIdentity
          projectName={project?.name ?? 'Research Graph'}
          {...(project?.branch === undefined ? {} : { branch: project.branch })}
          {...(project?.head === undefined ? {} : { head: project.head })}
        />
        <div className="ml-auto flex min-w-max items-center gap-1 sm:gap-2">
          {acknowledgement === undefined ? null : (
            <output className="min-w-14 text-right text-xs font-bold text-sf-header-success">
              {acknowledgement}
            </output>
          )}
          {researchExpansionState.phase === 'failed' ? (
            <ResearchExpansionRecoveryControls
              placement="header"
              onRetry={() => researchExpansionRef.current?.retry()}
              onCopy={copyPrompt}
            />
          ) : null}
          <button
            type="button"
            className={BUTTON_PRIMARY}
            disabled={focus === undefined || researchExpansionState.phase === 'pending'}
            onClick={submitResearchExpansion}
          >
            {researchExpansionState.phase === 'pending'
              ? 'Submitting'
              : RESEARCH_EXPANSION_ACTION_LABEL}
          </button>
        </div>
      </header>

      {researchExpansionState.phase === 'failed' ? (
        <ResearchExpansionRecoveryControls
          placement="narrow"
          onRetry={() => researchExpansionRef.current?.retry()}
          onCopy={copyPrompt}
        />
      ) : null}

      {project?.readOnly ? (
        <section
          className="flex min-h-10 shrink-0 items-center gap-2.5 border-b border-sf-warning-border bg-sf-warning-soft px-4 py-2 text-xs text-sf-warning-foreground"
          aria-label="Read-only project"
        >
          <strong className="font-bold">Read-only</strong>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-normal xl:whitespace-nowrap">
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
