import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CompanionApp,
  DetailsPane,
  EntityNodeCard,
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
} satisfies ProjectionEntitySummary

const singularEntity = {
  ...entity,
  referenceCount: 1,
  reviewedEvidenceCount: 0,
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
    expect(html).toContain('2 refs (1 reviewed)')
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
    expect(html).toContain('2 refs (1 reviewed)')
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
    const action = html.match(/<button[^>]*>Research &amp; Expand<\/button>/)?.[0]
    const actionClasses = action?.match(/class="([^"]+)"/)?.[1]?.split(' ')

    expect(action).toBeDefined()
    expect(actionClasses).toContain('bg-sf-header-foreground')
    expect(actionClasses).toContain('text-sf-header')
    expect(actionClasses).not.toContain('bg-sf-accent')
    expect(actionClasses).not.toContain('text-white')
    expect(actionClasses).not.toContain('shadow-sm')
  })

  it('uses singular reference grammar on cards and in Details', () => {
    const card = renderToStaticMarkup(createElement(EntityNodeCard, { entity: singularSummary }))
    const details = renderToStaticMarkup(
      createElement(DetailsPane, {
        entity: singularEntity,
        focusEntityId: ENTITY_ID,
        open: true,
        onToggle: () => undefined,
      }),
    )

    expect(card).toContain('1 ref (0 reviewed)')
    expect(details).toContain('1 ref (0 reviewed)')
    expect(card).not.toContain('1 refs')
    expect(details).not.toContain('1 refs')
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
