import { describe, expect, it } from 'vitest'
import { scopeCss } from '../../scripts/scope-css.mjs'

describe('scopeCss', () => {
  it('prefixes plain and comma-separated selectors', () => {
    const css = '.a{color:red}.b,.c{color:blue}'
    expect(scopeCss(css, '.sf')).toBe(
      '.sf .a{color:red}.sf .b,.sf .c{color:blue}',
    )
  })

  it('keeps already-scoped selectors un-prefixed', () => {
    const css = '.sf{display:flex}.sf *,.sf button{box-sizing:border-box}'
    expect(scopeCss(css, '.sf')).toBe(css)
  })

  it('recurses into media, container, supports, and layer blocks', () => {
    const css =
      '@media (min-width:100px){.a{color:red}}' +
      '@container (min-width:640px){.b{color:blue}}' +
      '@supports (display:grid){.c{display:grid}}' +
      '@layer utilities{.d{color:green}}'
    expect(scopeCss(css, '.sf')).toBe(
      '@media (min-width:100px){.sf .a{color:red}}' +
        '@container (min-width:640px){.sf .b{color:blue}}' +
        '@supports (display:grid){.sf .c{display:grid}}' +
        '@layer utilities{.sf .d{color:green}}',
    )
  })

  it('never touches keyframes, property, or block-less at-statements', () => {
    const css =
      '@layer theme,base,utilities;' +
      '@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}' +
      '@property --tw-x{syntax:"<number>";inherits:false;initial-value:0}' +
      '.a{animation:spin 1s linear infinite}'
    expect(scopeCss(css, '.sf')).toBe(
      '@layer theme,base,utilities;' +
        '@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}' +
        '@property --tw-x{syntax:"<number>";inherits:false;initial-value:0}' +
        '.sf .a{animation:spin 1s linear infinite}',
    )
  })

  it('anchors root-scoped variable blocks (:root/:host) on the container', () => {
    // Tailwind v4 emits theme variables under ':root, :host'; prefixing them
    // as descendants would match nothing and leave every var() unresolved.
    expect(scopeCss(':root,:host{--x:1}', '.sf')).toBe('.sf{--x:1}')
    expect(scopeCss(':root{--a:1}.b{color:red}', '.sf')).toBe(
      '.sf{--a:1}.sf .b{color:red}',
    )
  })

  it('handles pseudo elements and attribute selectors as ordinary selectors', () => {
    const css = '.a::before{content:"x"}[data-y="1"] .b{color:red}'
    expect(scopeCss(css, '.sf')).toBe(
      '.sf .a::before{content:"x"}.sf [data-y="1"] .b{color:red}',
    )
  })

  it('passes through an already fully scoped document unchanged', () => {
    const css = '.sf{margin:0}@media print{.sf p{margin:0}}'
    expect(scopeCss(css, '.sf')).toBe(css)
  })
})
