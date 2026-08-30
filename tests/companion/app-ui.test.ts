import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DetailsPane,
  EntityNodeCard,
  compactEntityId,
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
  label: LONG_LABEL,
} satisfies ProjectionEntitySummary

const entity = {
  ...summary,
  body: '# Full node\n\nBody',
  fileVersion: 'a'.repeat(64),
} satisfies EntityDocument

describe('Companion graph UI', () => {
  it('exposes a complete wrapped node label to pointer and keyboard users', () => {
    const html = renderToStaticMarkup(createElement(EntityNodeCard, { entity: summary }))

    expect(html).toContain('tabindex="0"')
    expect(html).toContain('role="tooltip"')
    expect(html).toContain(LONG_LABEL)
    expect(html).toContain('aria-describedby=')
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
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('class="details-body"')
  })

  it('keeps breadcrumb ids compact without losing their identifying suffix', () => {
    expect(compactEntityId(ENTITY_ID)).toBe('node_bbbbbbb…22222222')
    expect(compactEntityId('node_short')).toBe('node_short')
  })
})
