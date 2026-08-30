import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DetailsPane,
  EntityNodeCard,
  HeaderIdentity,
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
    expect(html).toContain('header-identity')
    expect(html).toContain('branch-chip')
  })

  it('expands the card itself with a complete label and no detached tooltip', () => {
    const html = renderToStaticMarkup(createElement(EntityNodeCard, { entity: summary }))

    expect(html).toContain('tabindex="0"')
    expect(html).not.toContain('role="tooltip"')
    expect(html).toContain(LONG_LABEL)
    expect(html).not.toContain('aria-describedby=')
    expect(html).toContain('entity-type-dot entity-type-hypothesis')
    expect(html).toContain('HYPOTHESIS')
    expect(html).toContain('2 refs (1 reviewed)')
  })

  it('shows the full focused entity id with a copy action in open Details', () => {
    const html = renderToStaticMarkup(
      createElement(DetailsPane, {
        entity,
        focusEntityId: ENTITY_ID,
        open: true,
        onToggle: () => undefined,
      }),
    )

    expect(html).toContain(ENTITY_ID)
    expect(html).toContain('Copy ID')
    expect(html).toContain('Focused')
    expect(html).toContain('HYPOTHESIS')
    expect(html).toContain('<strong>2</strong> refs')
    expect(html).toContain('<strong>1</strong> reviewed')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('class="details-body"')
    expect(html).toContain('aria-label="Details content"')
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
    expect(html).toContain('drawer-chevron')
  })
})
