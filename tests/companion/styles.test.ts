import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../../src/companion/styles.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/companion/app.tsx', import.meta.url), 'utf8')

describe('Companion style ownership', () => {
  it('anchors document and control normalization on the SciFork container root', () => {
    const baseLayer = styles.match(/@layer base \{([\s\S]*?)\n\}\n\n\.react-flow__node-entity/)

    expect(baseLayer).not.toBeNull()
    expect(baseLayer?.[1]).toContain('.scifork-root {')
    expect(baseLayer?.[1]).toContain('.scifork-root button {')
    expect(baseLayer?.[1]).toContain('font: inherit')
    // The injected stylesheet never restyles the DSH shell (the words may
    // appear in comments; the selectors must not).
    expect(baseLayer?.[1]).not.toContain(':root {')
    expect(baseLayer?.[1]).not.toMatch(/(^|\s)html[,\s{]/)
    expect(baseLayer?.[1]).not.toMatch(/(^|\s)body[,\s{]/)
    expect(baseLayer?.[1]).not.toContain('#root')
    // The container root carries the container-query context.
    expect(baseLayer?.[1]).toContain('container-type: inline-size')
  })

  it('drives the wide graph layout from the pane width, not the viewport', () => {
    expect(appSource).not.toContain('matchMedia')
    expect(appSource).toContain('ResizeObserver')
    expect(appSource).toContain('width >= 768')
    expect(appSource).not.toContain("'(min-width: 48rem)'")
  })

  it('marks the app root as the SciFork container', () => {
    expect(appSource).toContain('scifork-root companion-app')
  })
})
