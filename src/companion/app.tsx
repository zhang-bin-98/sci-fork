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
  LiteratureEvidenceItem,
  LiteratureProjection,
} from '../shared/companion-contract.js'
import { channelNameForPageKey } from '../shared/page-key.js'
import { CompanionApiClient, CompanionApiError } from './api.js'
import { DetailsMarkdown } from './details.js'
import { FocusSelectionQueue } from './focus-selection.js'
import {
  type GraphView,
  evidenceAnchorForFocus,
  focusViewportCenter,
  graphDirectionForViewport,
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

type EntityVisualType = 'question' | 'finding' | 'hypothesis' | 'prediction' | 'evidence' | 'result' | 'framing_link' | 'edge'

const ENTITY_DOT_CLASS: Record<EntityVisualType, string> = {
  question: 'bg-sf-muted ring-sf-muted/15',
  finding: 'bg-sf-finding ring-sf-finding/15',
  hypothesis: 'bg-sf-hypothesis ring-sf-hypothesis/15',
  prediction: 'bg-sf-prediction ring-sf-prediction/15',
  evidence: 'bg-sf-evidence ring-sf-evidence/15',
  result: 'bg-sf-result ring-sf-result/15',
  framing_link: 'bg-sf-edge ring-sf-edge/15',
  edge: 'bg-sf-edge ring-sf-edge/15',
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ')
}

type EntityTypeCarrier =
  | Pick<Extract<ProjectionEntitySummary, { type: 'node' }>, 'type' | 'kind'>
  | Pick<Extract<EntityDocument, { type: 'node' }>, 'type' | 'kind'>
  | { type: 'question' | 'evidence' | 'result' | 'framing_link' | 'edge' }

function entityTypeLabel(entity: EntityTypeCarrier): string {
  if (entity.type === 'node') return entity.kind.toUpperCase()
  if (entity.type === 'evidence') return 'EVIDENCE'
  if (entity.type === 'question') return 'RESEARCH QUESTION'
  if (entity.type === 'framing_link') return 'FRAMING LINK'
  return entity.type.toUpperCase()
}

function entityTypeClass(entity: EntityTypeCarrier): EntityVisualType {
  return entity.type === 'node' ? entity.kind : entity.type
}

export function formatEvidenceCounts(
  publicationCount: number,
  machineReviewedCount: number,
  humanReviewedCount: number,
): string {
  return `${publicationCount} ${publicationCount === 1 ? 'publication' : 'publications'} · ${machineReviewedCount} machine-reviewed · ${humanReviewedCount} human-reviewed`
}

function entityMeta(entity: ProjectionEntitySummary): string {
  if (entity.type === 'node') {
    return (
      entity.confidence +
      ' confidence · ' +
      formatEvidenceCounts(
        entity.publicationCount,
        entity.machineReviewedEvidenceCount,
        entity.humanReviewedEvidenceCount,
      )
    )
  }
  if (entity.type === 'evidence') return entity.reviewStatus
  if (entity.type === 'question') return 'open question'
  return entity.status
}

function EntityTypeMark(props: { entity: EntityTypeCarrier }): React.ReactElement {
  const typeClass = entityTypeClass(props.entity)
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-bold tracking-wide text-sf-muted">
      <span
        className={'size-2 shrink-0 rounded-full ring-2 ' + ENTITY_DOT_CLASS[typeClass]}
        aria-hidden="true"
      />
      <span className="whitespace-nowrap">{entityTypeLabel(props.entity)}</span>
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
  interactionDisabled: boolean
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

export type GraphViewMode = GraphView['mode']

export function GraphViewControl(props: {
  view: GraphViewMode
  canEnterEvidence: boolean
  transitioning: boolean
  onChange(view: GraphViewMode): void
}): React.ReactElement {
  const options: Array<{ value: GraphViewMode; label: string }> = [
    { value: 'main', label: 'Main view' },
    { value: 'evidence', label: 'Evidence view' },
  ]
  return (
    <div
      className="flex min-w-0 items-center gap-0.5"
      role="group"
      aria-label="Graph view"
      aria-busy={props.transitioning}
      data-graph-view-control="true"
    >
      {options.map((option) => {
        const disabled =
          props.transitioning ||
          (option.value === 'evidence' &&
            props.view === 'main' &&
            !props.canEnterEvidence)
        const title =
          props.transitioning
            ? 'Restoring Main view'
            : option.value === 'evidence' && disabled
              ? 'Focus an entity with direct Evidence to enter Evidence view'
              : option.label
        return (
          <button
            key={option.value}
            type="button"
            className={
              BUTTON_HEADER +
              ' h-9 px-2 text-xs aria-pressed:border-sf-header-foreground aria-pressed:bg-sf-header-foreground aria-pressed:text-sf-header sm:px-2.5'
            }
            aria-pressed={props.view === option.value}
            aria-label={option.label}
            title={title}
            disabled={disabled}
            data-graph-view={option.value}
            onClick={() => props.onChange(option.value)}
          >
            {option.value === 'main' ? 'Main' : 'Evidence'}
          </button>
        )
      })}
    </div>
  )
}

function GraphPane(props: GraphPaneProps): React.ReactElement {
  const wide = useWideGraphLayout()
  const direction = graphDirectionForViewport(wide)
  const paneRef = React.useRef<HTMLElement | null>(null)
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
    if (flow === undefined || paneRef.current === null) return
    const fit = (): void => {
      void flow.fitView({ padding: 0.18 })
    }
    fit()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(fit)
    observer.observe(paneRef.current)
    return () => observer.disconnect()
  }, [flow])
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
      ref={paneRef}
      className="graph-pane relative min-h-0 min-w-0 border-b border-sf-border bg-sf-surface-muted xl:border-r xl:border-b-0"
      aria-label="Research Graph"
      aria-busy={props.interactionDisabled}
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
        nodesFocusable={!props.interactionDisabled}
        edgesFocusable={!props.interactionDisabled}
        onNodeClick={(_event, node) => {
          if (!props.interactionDisabled) props.onSelect(node.id)
        }}
        onEdgeClick={(_event, edge) => {
          if (props.interactionDisabled) return
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
      {entity.literature === undefined ? null : (
        <>
          <dt>Literature</dt>
          <dd><LiteratureDetails literature={entity.literature} /></dd>
        </>
      )}
    </dl>
  )
}

function publicationLabel(item: LiteratureEvidenceItem): string {
  const identity = item.publicationRef.pmid !== undefined
    ? `PMID ${item.publicationRef.pmid}`
    : `DOI ${item.publicationRef.doi ?? ''}`
  const citation = item.citation
  if (citation === undefined) return identity
  return [citation.title, citation.journal, citation.year, identity]
    .filter((part) => part !== undefined && part !== '')
    .join(' · ')
}

function LiteratureEvidenceList(props: { items: LiteratureEvidenceItem[] }): React.ReactElement {
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {props.items.map((item) => (
        <li key={item.id} className="rounded-md border border-sf-border bg-sf-surface-muted p-2.5">
          <strong className="block text-xs text-sf-heading">{publicationLabel(item)}</strong>
          <span className="block text-xs text-sf-muted">{item.id} · {humanize(item.direction)} · {humanize(item.locator.kind)}</span>
          <p className="my-1.5 text-sm">{item.assertion}</p>
          {item.limitations === undefined ? null : <p className="my-1 text-xs">Limitations: {item.limitations.join('; ')}</p>}
          {item.machineReviewRationale === undefined ? null : <p className="my-1 text-xs">Machine review: {item.machineReviewRationale}</p>}
        </li>
      ))}
    </ul>
  )
}

function LiteratureDetails(props: { literature: LiteratureProjection }): React.ReactElement {
  const groups: Array<[string, LiteratureEvidenceItem[]]> = [
    ['Human-reviewed Evidence', props.literature.humanReviewed],
    ['Machine-reviewed Evidence', props.literature.machineReviewed],
  ]
  return (
    <section className="grid gap-3" aria-label="Literature">
      {groups.map(([label, items]) => items.length === 0 ? null : (
        <div key={label}>
          <h3 className="m-0 mb-1 text-xs font-bold text-sf-heading">{label}</h3>
          <LiteratureEvidenceList items={items} />
        </div>
      ))}
      {props.literature.rejected.length === 0 ? null : (
        <details>
          <summary className="cursor-pointer text-xs font-bold">Rejected Evidence ({props.literature.rejected.length})</summary>
          <LiteratureEvidenceList items={props.literature.rejected} />
        </details>
      )}
      {props.literature.retrievalOnly.length === 0 ? null : (
        <div>
          <h3 className="m-0 mb-1 text-xs font-bold text-sf-heading">Retrieval-only references</h3>
          <ul className="m-0 pl-4 text-xs">
            {props.literature.retrievalOnly.map((reference, index) => (
              <li key={(reference.pmid ?? reference.doi ?? '') + index}>
                {reference.pmid !== undefined ? `PMID ${reference.pmid}` : `DOI ${reference.doi ?? ''}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function FramingLinkDetails(props: { entity: Extract<EntityDocument, { type: 'framing_link' }> }): React.ReactElement {
  return (
    <dl className="m-0 grid grid-cols-[90px_minmax(0,1fr)] gap-3 p-5 text-sm">
      <dt>Relation</dt><dd>{props.entity.relation}</dd>
      <dt>From</dt><dd>{props.entity.from}</dd>
      <dt>To</dt><dd>{props.entity.to}</dd>
    </dl>
  )
}

function QuestionDetails(props: { entity: Extract<EntityDocument, { type: 'question' }> }): React.ReactElement {
  const { entity } = props
  return (
    <article className="m-0 grid gap-3 p-5 text-sm leading-6">
      <h1 className="m-0 text-xl font-semibold">{entity.question}</h1>
      {entity.scopeAssumptions.length === 0 ? null : <p className="m-0">Scope: {entity.scopeAssumptions.join('; ')}</p>}
      <p className="m-0">Frames: {entity.framedEntityIds.length}</p>
      {entity.framedEntityIds.length === 0 ? null : (
        <ul className="m-0 pl-5">
          {entity.framedEntityIds.map((id) => <li key={id}><code>{id}</code></li>)}
        </ul>
      )}
      <p className="m-0">{formatEvidenceCounts(entity.publicationCount, entity.machineReviewedEvidenceCount, entity.humanReviewedEvidenceCount)}</p>
      {entity.body.length === 0 ? null : <DetailsMarkdown markdown={entity.body} />}
    </article>
  )
}

function EvidenceDetails(props: { entity: Extract<EntityDocument, { type: 'evidence' }> }): React.ReactElement {
  const { entity } = props
  const item: LiteratureEvidenceItem = {
    id: entity.id,
    publicationRef: entity.publicationRef,
    ...(entity.citation !== undefined ? { citation: entity.citation } : {}),
    assertion: entity.assertion,
    locator: entity.locator,
    direction: entity.direction,
    ...(entity.limitations !== undefined ? { limitations: entity.limitations } : {}),
    ...(entity.machineReviewRationale !== undefined ? { machineReviewRationale: entity.machineReviewRationale } : {}),
    reviewStatus: entity.reviewStatus,
  }
  return <div className="p-5"><LiteratureEvidenceList items={[item]} />{entity.body.length === 0 ? null : <DetailsMarkdown markdown={entity.body} />}</div>
}

function entityEvidenceCountLabel(entity: EntityDocument): string | undefined {
  if (entity.type === 'question') {
    return formatEvidenceCounts(
      entity.publicationCount,
      entity.machineReviewedEvidenceCount,
      entity.humanReviewedEvidenceCount,
    )
  }
  if (entity.type !== 'node') return undefined
  return formatEvidenceCounts(
    entity.publicationCount,
    entity.machineReviewedEvidenceCount,
    entity.humanReviewedEvidenceCount,
  )
}

function MarkdownEntityDetails(props: {
  entity: Extract<EntityDocument, { type: 'node' | 'result' }>
}): React.ReactElement {
  return (
    <article className="markdown-details m-0 p-5 text-sm leading-[1.65] text-sf-ink [overflow-wrap:anywhere] [&_a]:text-sf-accent [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-2 [&_a]:focus-visible:rounded-sm [&_a]:focus-visible:outline-none [&_a]:focus-visible:ring-3 [&_a]:focus-visible:ring-sf-focus/45 [&_code]:font-mono [&_h1]:mt-0 [&_h1]:mb-3 [&_h1]:text-[21px] [&_h1]:leading-tight [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-sf-heading [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:text-sf-heading [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-sf-heading [&_pre]:overflow-x-auto [&_pre]:border-l-[3px] [&_pre]:border-sf-markdown-accent [&_pre]:bg-sf-surface-muted [&_pre]:px-3 [&_pre]:py-2.5 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_td]:border [&_td]:border-sf-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-left [&_th]:border [&_th]:border-sf-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left">
      <DetailsMarkdown markdown={props.entity.body} />
      {props.entity.type !== 'node' || props.entity.literature === undefined ? null : (
        <LiteratureDetails literature={props.entity.literature} />
      )}
    </article>
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
          {entity === undefined || entityEvidenceCountLabel(entity) === undefined ? null : (
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-sf-muted">
              {entityEvidenceCountLabel(entity)}
            </span>
          )}
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
        ) : entity.type === 'framing_link' ? (
          <FramingLinkDetails entity={entity} />
        ) : entity.type === 'question' ? (
          <QuestionDetails entity={entity} />
        ) : entity.type === 'evidence' ? (
          <EvidenceDetails entity={entity} />
        ) : (
          <MarkdownEntityDetails entity={entity} />
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

export function ResearchExpansionAction(props: {
  state: ResearchExpansionState
  disabled: boolean
  onClick(): void
}): React.ReactElement {
  const running = props.state.phase === 'pending' || props.state.phase === 'acknowledged'
  const label = running ? 'Research in progress' : RESEARCH_EXPANSION_ACTION_LABEL
  return (
    <button
      type="button"
      className={BUTTON_PRIMARY + ' size-9 px-0 sm:size-auto sm:px-3'}
      disabled={props.disabled || running}
      aria-label={label}
      title={label}
      aria-busy={running}
      onClick={props.onClick}
    >
      {running ? (
        <svg
          className="size-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          data-research-spinner="true"
        >
          <circle className="opacity-30" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-90" d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        <>
          <svg
            className="size-4 sm:hidden"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="6.75" cy="6.75" r="3.75" />
            <path d="m9.5 9.5 3.25 3.25M5.5 6.75h2.5M6.75 5.5v2.5" />
          </svg>
          <span className="hidden sm:inline">{RESEARCH_EXPANSION_ACTION_LABEL}</span>
        </>
      )}
    </button>
  )
}

export async function restoreMainView(inputs: {
  graph: SnapshotGraph
  anchorId: string
  focusEntityId: string | undefined
  pendingFocusId?: string | undefined
  selectFocus(entityId: string): Promise<boolean>
}): Promise<'restored' | 'anchor-missing' | 'failed'> {
  const anchorExists = inputs.graph.entities.some(
    (entity) => entity.id === inputs.anchorId && entity.type === 'node',
  )
  if (!anchorExists) return 'anchor-missing'
  if (inputs.focusEntityId === inputs.anchorId && inputs.pendingFocusId === undefined) {
    return 'restored'
  }
  return (await inputs.selectFocus(inputs.anchorId)) ? 'restored' : 'failed'
}

export function CompanionApp(props: { pageKey: string }): React.ReactElement {
  const [invalidKey, setInvalidKey] = React.useState(false)
  const [snapshot, setSnapshot] = React.useState<SnapshotSuccess>()
  const [graph, setGraph] = React.useState<SnapshotGraph>()
  const [selectedId, setSelectedId] = React.useState<string>()
  const [details, setDetails] = React.useState<EntityDocument>()
  const [detailsOpen, setDetailsOpen] = React.useState(true)
  const [graphView, setGraphView] = React.useState<GraphView>({ mode: 'main' })
  const [viewTransitioning, setViewTransitioning] = React.useState(false)
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
  const viewTransitioningRef = React.useRef(false)
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
      isConfirmed: (entityId, response) => response.focus.focusEntityId === entityId,
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
    if (viewTransitioningRef.current) return
    setError(undefined)
    void focusQueueRef.current?.select(entityId)
  }, [])

  const eligibleEvidenceAnchor = React.useMemo(
    () =>
      pendingFocusId === undefined
        ? evidenceAnchorForFocus(graph ?? EMPTY_GRAPH, snapshot?.focus?.focusEntityId)
        : undefined,
    [graph, pendingFocusId, snapshot?.focus?.focusEntityId],
  )
  const visibleGraph = React.useMemo(
    () => selectGraphView(graph ?? EMPTY_GRAPH, graphView),
    [graph, graphView],
  )

  React.useEffect(() => {
    if (graph === undefined || graphView.mode !== 'evidence') return
    const anchorExists = graph.entities.some(
      (entity) => entity.id === graphView.anchorId && entity.type === 'node',
    )
    if (anchorExists) return
    viewTransitioningRef.current = false
    setViewTransitioning(false)
    setGraphView({ mode: 'main' })
  }, [graph, graphView])

  const changeGraphView = (nextView: GraphViewMode): void => {
    if (viewTransitioningRef.current || nextView === graphView.mode) return
    if (nextView === 'evidence') {
      if (eligibleEvidenceAnchor === undefined) return
      setGraphView({ mode: 'evidence', anchorId: eligibleEvidenceAnchor })
      return
    }
    if (graphView.mode !== 'evidence') return

    const latestGraph = graphRef.current
    if (latestGraph === undefined) return
    viewTransitioningRef.current = true
    setViewTransitioning(true)
    const anchorId = graphView.anchorId
    void restoreMainView({
      graph: latestGraph,
      anchorId,
      focusEntityId: snapshotRef.current?.focus?.focusEntityId,
      pendingFocusId: focusQueueRef.current?.pendingEntityId,
      selectFocus: (entityId) =>
        focusQueueRef.current?.select(entityId) ?? Promise.resolve(false),
    }).then((result) => {
      if (!mountedRef.current) return
      if (result !== 'failed') setGraphView({ mode: 'main' })
      viewTransitioningRef.current = false
      setViewTransitioning(false)
    })
  }

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
  return (
    <main className="companion-app flex h-dvh min-h-0 w-full flex-col bg-sf-canvas text-sf-ink">
      <header className="app-header flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b border-sf-header-border bg-sf-header px-2.5 text-sf-header-foreground sm:gap-3 sm:px-4">
        <HeaderIdentity
          projectName={project?.name ?? 'Research Graph'}
          {...(project?.branch === undefined ? {} : { branch: project.branch })}
          {...(project?.head === undefined ? {} : { head: project.head })}
        />
        <div className="ml-auto flex min-w-max items-center gap-1 sm:gap-2">
          <GraphViewControl
            view={graphView.mode}
            canEnterEvidence={eligibleEvidenceAnchor !== undefined}
            transitioning={viewTransitioning}
            onChange={changeGraphView}
          />
          {researchExpansionState.phase === 'failed' ? (
            <ResearchExpansionRecoveryControls
              placement="header"
              onRetry={() => researchExpansionRef.current?.retry()}
              onCopy={copyPrompt}
            />
          ) : null}
          <ResearchExpansionAction
            state={researchExpansionState}
            disabled={focus === undefined}
            onClick={submitResearchExpansion}
          />
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
      ) : visibleGraph.entities.length === 0 ? (
        <section className="flex min-h-0 flex-1 items-center justify-center gap-3 bg-sf-surface-muted text-sf-muted">
          <span>No research entities</span>
        </section>
      ) : (
        <div className={WORKSPACE_BASE + ' ' + (detailsOpen ? WORKSPACE_OPEN : WORKSPACE_CLOSED)}>
          <GraphPane
            graph={visibleGraph}
            focusEntityId={focus?.focusEntityId}
            pendingEntityId={pendingFocusId}
            pathIds={focus?.pathIds ?? []}
            interactionDisabled={viewTransitioning}
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
