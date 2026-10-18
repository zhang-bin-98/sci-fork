import { describe, expect, it } from 'vitest'
import { scopeCss } from '../../scripts/scope-css.mjs'

describe('scopeCss', () => {
  it('prefixes plain and comma-separated selectors', () => {
    const css = '.a{color:red}.b,.c{color:blue}'
    expect(scopeCss(css, '.sf')).toBe(
      '.sf .a{color:red}.sf .b,.sf .c{color:blue}',
    )
  })

  it('preserves escaped commas in Tailwind grid selectors at base and container widths', () => {
    const base = String.raw`.grid-rows-\[minmax\(0\,55fr\)_minmax\(200px\,45fr\)\]`
    const wide = String.raw`.\@min-\[1280px\]\:grid-cols-\[minmax\(0\,1fr\)_minmax\(320px\,38vw\)\]`
    const css =
      base + '{grid-template-rows:minmax(0,55fr) minmax(200px,45fr)}' +
      '@container (min-width:1280px){' + wide + '{grid-template-columns:minmax(0,1fr) minmax(320px,38vw)}}'
    expect(scopeCss(css, '.sf')).toBe(
      '.sf ' + base + '{grid-template-rows:minmax(0,55fr) minmax(200px,45fr)}' +
        '@container (min-width:1280px){.sf ' + wide + '{grid-template-columns:minmax(0,1fr) minmax(320px,38vw)}}',
    )
  })

  it('splits selector lists outside functions and quoted attribute values', () => {
    const css = ':is(.a,.b),[data-label="a,b"] .c{display:flex}'
    expect(scopeCss(css, '.sf')).toBe(
      '.sf :is(.a,.b),.sf [data-label="a,b"] .c{display:flex}',
    )
  })

  it('preserves comments before layers and rules while scoping the following selectors', () => {
    const banner = '/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */\n'
    const css = banner + '@layer theme{/* theme */:root,:host{--x:1}}/* controls */.a{color:red}'
    expect(scopeCss(css, '.sf')).toBe(
      banner + '@layer theme{/* theme */.sf{--x:1}}/* controls */.sf .a{color:red}',
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
