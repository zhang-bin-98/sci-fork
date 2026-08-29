import * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function isExternalHttpUrl(value: string | undefined): value is string {
  if (value === undefined) return false
  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0
    )
  } catch {
    return false
  }
}

function InertText(props: { children?: ReactNode }): ReactElement {
  return <span className="details-inert">{props.children}</span>
}

const components: Components = {
  a({ href, children }) {
    if (!isExternalHttpUrl(href)) return <InertText>{children}</InertText>
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
  img({ alt }) {
    return <span className="details-image-alt">{alt?.trim() || 'Image'}</span>
  },
}

export function DetailsMarkdown(props: { markdown: string }): ReactElement {
  return (
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
      {props.markdown}
    </Markdown>
  )
}
