import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CompanionApp,
  DetailsPane,
  EntityNodeCard,
  EvidenceVisibilityControl,
  HeaderIdentity,
  ResearchExpansionRecoveryControls,
  copyEntityId,
  settleEntityIdCopyFeedback,
} from '../../src/companion/app.js'
import type { EntityDocument, ProjectionEntitySummary } from '../../src/shared/companion-contract.js'

const ENTITY_ID = 'node_bbbbbbbb-2222-4222-8222-222222222222'
const LONG_LABEL =
  'BRCA1 deficiency promotes a long, fully inspectable transdifferentiation hypothesis'

const summary = {
  id: ENTITY_ID,
  type: 'node',
  kind: 'hypothesis',
  confidence: 'low',
  referenceCount: 2,
  reviewedEvidenceCount: 1,
  publicationCount: 2,
  machineReviewedEvidenceCount: 0,
  humanReviewedEvidenceCount: 1,
  label: LONG_LABEL,
} satisfies ProjectionEntitySummary

const entity = {
  ...summary,
  body: '# Full node\n\nBody',
  fileVersion: 'a'.repeat(64),
} satisfies EntityDocument

const singularSummary = {
  ...summary,
  referenceCount: 1,
  reviewedEvidenceCount: 0,
  publicationCount: 1,
  machineReviewedEvidenceCount: 1,
  humanReviewedEvidenceCount: 0,
} satisfies ProjectionEntitySummary

const singularEntity = {
  ...entity,
  referenceCount: 1,
  reviewedEvidenceCount: 0,
  publicationCount: 1,
  machineReviewedEvidenceCount: 1,
  humanReviewedEvidenceCount: 0,
} satisfies EntityDocument

const literatureEntity = {
  ...entity,
  literature: {
    humanReviewed: [],
    machineReviewed: [{
      id: 'ev_cccccccc-3333-4333-8333-333333333333',
      publicationRef: { pmid: '87654321' },
      citation: {
        title: 'STAT3 activity and treatment resistance',
        journal: 'Example Oncology',
        year: 2025,
      },
      assertion: 'A retrieved abstract links STAT3 activity to treatment resistance.',
      locator: { kind: 'pubmed_abstract' },
      direction: 'supports',
      limitations: ['observational design'],
      machineReviewRationale: 'Identity, locator, entailment, direction, and limitations checked.',
      reviewStatus: 'machine_reviewed',
    }],
    candidate: [],
    rejected: [],
    retrievalOnly: [{ doi: '10.1000/second' }],
  },
} satisfies EntityDocument

const questionEntity = {
  id: 'question_dddddddd-4444-4444-8444-444444444444',
  type: 'question',
  question: 'What drives treatment resistance?',
  scopeAssumptions: ['solid tumors'],
  body: 'Open framing note.',
  framedEntityIds: [ENTITY_ID],
  publicationCount: 2,
  machineReviewedEvidenceCount: 1,
  humanReviewedEvidenceCount: 1,
} satisfies EntityDocument

describe('Companion graph UI', () => {
  it('keeps project and branch identity in one header row', () => {
    const html = renderToStaticMarkup(
      createElement(HeaderIdentity, {
        projectName: 'STAT3 resistance study',
        branch: 'chore/v0.0.1-release',
        head: 'abcdef1234567890',
      }),
    )

    expect(html).toContain('STAT3 resistance study')
    expect(html).toContain('chore/v0.0.1-release')
    expect(html).toContain('aria-label="Current branch"')
  })

  it('moves failed research recovery controls out of the narrow header', () => {
    const header = renderToStaticMarkup(
      createElement(ResearchExpansionRecoveryControls, {
        placement: 'header',
        onRetry: () => undefined,
        onCopy: () => undefined,
      }),
    )
    const narrow = renderToStaticMarkup(
      createElement(ResearchExpansionRecoveryControls, {
        placement: 'narrow',
        onRetry: () => undefined,
        onCopy: () => undefined,
      }),
    )

    expect(header).toContain('data-research-expansion-recovery="header"')
    expect(header).toContain('hidden sm:contents')
    expect(narrow).toContain('data-research-expansion-recovery="narrow"')
    expect(narrow).toContain('<section class="flex ')
    expect(narrow).toContain(' sm:hidden"')
    expect(narrow).toContain('Research step failed')
    expect(narrow).toContain('Retry')
    expect(narrow).toContain('Copy')
  })

  it('expands the card itself with a complete label and no detached tooltip', () => {
    const html = renderToStaticMarkup(createElement(EntityNodeCard, { entity: summary }))

    expect(html).toContain('tabindex="0"')
    expect(html).toContain(
      'entity-node-content absolute inset-x-0 top-0 z-[1] grid min-h-full w-full',
    )
    expect(html).toContain('grid-rows-[auto_auto_auto]')
    expect(html).toContain('entity-node-label self-center overflow-hidden [overflow-wrap:anywhere]')
    expect(html).not.toContain('entity-node-content absolute inset-0')
    expect(html).not.toContain('role="tooltip"')
    expect(html).toContain(LONG_LABEL)
    expect(html).not.toContain('aria-describedby=')
    expect(html).toContain('HYPOTHESIS')
    expect(html).toContain('2 publications · 0 machine-reviewed · 1 human-reviewed')
  })

  it('makes the complete quiet identity row the copy control in open Details', () => {
    const html = renderToStaticMarkup(
      createElement(DetailsPane, {
        entity,
        focusEntityId: ENTITY_ID,
        open: true,
        onToggle: () => undefined,
      }),
    )

    expect(html).toContain(ENTITY_ID)
    expect(html).toContain('Focused')
    expect(html).toContain('HYPOTHESIS')
    expect(html).toContain('2 publications · 0 machine-reviewed · 1 human-reviewed')
    expect(html).toContain('<h2 class="sr-only">Details</h2>')
    expect(html).not.toContain('<h2>Details</h2>')
    expect(html.match(/data-details-row=/g)).toHaveLength(2)
    expect(html).toContain('data-details-row="primary"')
    expect(html).toContain('data-details-row="identity"')
    expect(html).toContain(`aria-label="Copy entity ID ${ENTITY_ID}"`)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-atomic="true"')
    const identityControl = html.match(
      /<button[^>]*data-details-row="identity"[\s\S]*?<\/button>/,
    )?.[0]
    expect(identityControl).toBeDefined()
    expect(identityControl).toContain(`<code`)
    expect(identityControl).toContain(ENTITY_ID)
    expect(identityControl).not.toContain('<svg')
    expect(identityControl).not.toContain('border-sf-border bg-sf-surface-muted')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-label="Details content"')
    expect(html).toContain('inline-flex shrink-0 items-center gap-1.5')
    expect(html).toContain('overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-sf-muted')
  })

  it('reports exact entity ID copy success and handles unavailable or failed clipboards', async () => {
    let written = ''
    const success = await copyEntityId(ENTITY_ID, {
      writeText: async (value) => {
        written = value
      },
    })

    expect(success).toBe('success')
    expect(written).toBe(ENTITY_ID)
    await expect(
      copyEntityId(ENTITY_ID, {
        writeText: async () => Promise.reject(new Error('denied')),
      }),
    ).resolves.toBe('failure')
    await expect(copyEntityId(ENTITY_ID, undefined)).resolves.toBe('failure')
  })

  it('ignores stale copy results and gives repeated copies a fresh feedback request', () => {
    const firstRequest = {
      entityId: ENTITY_ID,
      requestId: 1,
      status: 'idle' as const,
    }
    const firstSuccess = settleEntityIdCopyFeedback(firstRequest, ENTITY_ID, {
      entityId: ENTITY_ID,
      requestId: 1,
      status: 'success',
    })
    const otherEntityId = 'node_cccccccc-3333-4333-8333-333333333333'

    expect(
      settleEntityIdCopyFeedback(firstRequest, otherEntityId, {
        entityId: ENTITY_ID,
        requestId: 1,
        status: 'success',
      }),
    ).toBe(firstRequest)

    const secondRequest = {
      entityId: ENTITY_ID,
      requestId: 2,
      status: 'idle' as const,
    }
    expect(
      settleEntityIdCopyFeedback(secondRequest, ENTITY_ID, {
        entityId: ENTITY_ID,
        requestId: 1,
        status: 'failure',
      }),
    ).toBe(secondRequest)
    expect(
      settleEntityIdCopyFeedback(secondRequest, ENTITY_ID, {
        entityId: ENTITY_ID,
        requestId: 2,
        status: 'success',
      }),
    ).toEqual({ entityId: ENTITY_ID, requestId: 2, status: 'success' })
    expect(firstSuccess).toEqual({ entityId: ENTITY_ID, requestId: 1, status: 'success' })
  })

  it('uses a calm inverted treatment for the research action', () => {
    const html = renderToStaticMarkup(
      createElement(CompanionApp, { pageKey: 'K'.repeat(43) }),
    )
    const action = html.match(/<button[^>]*aria-label="Research &amp; Expand"[\s\S]*?<\/button>/)?.[0]
    const actionClasses = action?.match(/class="([^"]+)"/)?.[1]?.split(' ')

    expect(action).toBeDefined()
    expect(action).toContain('title="Research &amp; Expand"')
    expect(action).toContain('size-9 px-0 sm:size-auto sm:px-3')
    expect(action).toContain('class="size-4 sm:hidden"')
    expect(action).toContain('class="hidden sm:inline"')
    expect(actionClasses).toContain('bg-sf-header-foreground')
    expect(actionClasses).toContain('text-sf-header')
    expect(actionClasses).not.toContain('bg-sf-accent')
    expect(actionClasses).not.toContain('text-white')
    expect(actionClasses).not.toContain('shadow-sm')
    expect(html).toContain('All evidence')
  })

  it('exposes hidden, focused-node, and all Evidence display modes', () => {
    const html = renderToStaticMarkup(
      createElement(EvidenceVisibilityControl, {
        visibility: 'hidden',
        focusedNodeId: ENTITY_ID,
        onChange: () => undefined,
      }),
    )

    expect(html).toContain('data-evidence-visibility-control="true"')
    expect(html).toContain('data-evidence-visibility="hidden"')
    expect(html).toContain('data-evidence-visibility="focused-node"')
    expect(html).toContain('data-evidence-visibility="all"')
    expect(html).toContain('aria-label="Focus evidence"')
    expect(html).not.toContain('title="Focus a Node to show its evidence"')

    const disabledHtml = renderToStaticMarkup(
      createElement(EvidenceVisibilityControl, {
        visibility: 'hidden',
        focusedNodeId: undefined,
        onChange: () => undefined,
      }),
    )
    expect(disabledHtml).toContain('aria-label="Focus evidence"')
    expect(disabledHtml).toContain('disabled=""')
    expect(disabledHtml).toContain('title="Focus a Node to show its evidence"')
  })

  it('shows grouped machine-reviewed and retrieval-only literature in Node Details', () => {
    const html = renderToStaticMarkup(
      createElement(DetailsPane, {
        entity: literatureEntity,
        focusEntityId: ENTITY_ID,
        open: true,
        onToggle: () => undefined,
      }),
    )

    expect(html).toContain('Machine-reviewed Evidence')
    expect(html).toContain('STAT3 activity and treatment resistance')
    expect(html).toContain('PMID 87654321')
    expect(html).toContain('A retrieved abstract links STAT3 activity')
    expect(html).toContain('observational design')
    expect(html).toContain('Machine review:')
    expect(html).toContain('Retrieval-only references')
    expect(html).toContain('DOI 10.1000/second')
  })

  it('shows a Research Question scope, coverage, and framed entity ids', () => {
    const html = renderToStaticMarkup(
      createElement(DetailsPane, {
        entity: questionEntity,
        focusEntityId: questionEntity.id,
        open: true,
        onToggle: () => undefined,
      }),
    )

    expect(html).toContain('RESEARCH QUESTION')
    expect(html).toContain('What drives treatment resistance?')
    expect(html).toContain('solid tumors')
    expect(html).toContain('Frames: 1')
    expect(html).toContain(ENTITY_ID)
    expect(html).toContain('2 publications · 1 machine-reviewed · 1 human-reviewed')
  })

  it('reports publication and review-state counts explicitly on cards and in Details', () => {
    const card = renderToStaticMarkup(createElement(EntityNodeCard, { entity: singularSummary }))
    const details = renderToStaticMarkup(
      createElement(DetailsPane, {
        entity: singularEntity,
        focusEntityId: ENTITY_ID,
        open: true,
        onToggle: () => undefined,
      }),
    )

    expect(card).toContain('1 publication · 1 machine-reviewed · 0 human-reviewed')
    expect(details).toContain('1 publication · 1 machine-reviewed · 0 human-reviewed')
  })

  it('renders only a reopen handle when Details is collapsed', () => {
    const html = renderToStaticMarkup(
      createElement(DetailsPane, {
        entity,
        focusEntityId: ENTITY_ID,
        open: false,
        onToggle: () => undefined,
      }),
    )

    expect(html).toContain('Open Details')
    expect(html).toContain('data-drawer-action="open"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('class="details-body"')
  })

  it('uses a direction-aware close control in open Details', () => {
    const html = renderToStaticMarkup(
      createElement(DetailsPane, {
        entity,
        focusEntityId: ENTITY_ID,
        open: true,
        onToggle: () => undefined,
      }),
    )

    expect(html).toContain('data-drawer-action="close"')
  })
})
