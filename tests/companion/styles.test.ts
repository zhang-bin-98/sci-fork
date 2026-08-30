import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../../src/companion/styles.css', import.meta.url), 'utf8')

describe('Companion style ownership', () => {
  it('keeps document and control normalization in the base layer so utilities win', () => {
    const baseLayer = styles.match(/@layer base \{([\s\S]*?)\n\}\n\n\.react-flow__node-entity/)

    expect(baseLayer).not.toBeNull()
    expect(baseLayer?.[1]).toContain(':root {')
    expect(baseLayer?.[1]).toContain('button {')
    expect(baseLayer?.[1]).toContain('font: inherit')
  })
})
