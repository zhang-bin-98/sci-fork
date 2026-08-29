import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DetailsMarkdown } from '../../src/companion/details.js'

describe('safe Details Markdown', () => {
  it('allows clicked HTTP links with isolation and renders other destinations inert', () => {
    const markdown = [
      '[secure paper](https://example.org/paper)',
      '',
      '[plain HTTP](http://example.org/record)',
      '',
      '[script](javascript:alert(1))',
      '',
      '[attachment](../attachments/private.pdf)',
    ].join('\n')

    const html = renderToStaticMarkup(createElement(DetailsMarkdown, { markdown }))

    expect(html).toContain('href="https://example.org/paper"')
    expect(html).toContain('href="http://example.org/record"')
    expect(html.match(/target="_blank"/g)).toHaveLength(2)
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2)
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="../attachments/private.pdf"')
    expect(html).toContain('script')
    expect(html).toContain('attachment')
  })

  it('renders image syntax as non-fetching alt text and never executes raw HTML', () => {
    const markdown = [
      '![Remote microscopy](https://images.example.org/cell.png)',
      '',
      '<script>window.researchData = "stolen"</script>',
      '<iframe src="https://evil.example/frame"></iframe>',
      '<object data="https://evil.example/payload"></object>',
      '<style>body { display: none }</style>',
      '<img src="https://evil.example/raw.png" alt="raw image">',
    ].join('\n')

    const html = renderToStaticMarkup(createElement(DetailsMarkdown, { markdown }))

    expect(html).toContain('Remote microscopy')
    expect(html).not.toMatch(/<(?:script|iframe|object|style|img)\b/i)
    expect(html).not.toMatch(/\s(?:src|data)="https?:/i)
  })
})
