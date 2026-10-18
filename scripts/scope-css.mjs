/**
 * Scope every style rule of a stylesheet under one container selector.
 *
 * The Companion's injected stylesheet would otherwise define global class
 * names (.flex, .px-0, ...) inside the DSH page. Rewriting happens at build
 * time so the source markup can keep ordinary Tailwind class names: plain
 * rules get the root selector as a descendant prefix, at-rules recurse,
 * and constructs whose blocks are not selector lists (@keyframes,
 * @property, @font-face) pass through untouched. Selectors that already
 * start with the root stay as written.
 */

/** At-rules whose blocks are declaration lists or names, never selectors. */
const NON_SELECTOR_BLOCKS = new Set([
  'keyframes',
  'property',
  'font-face',
  'font-feature-values',
  'counter-style',
  'page',
])

/**
 * Scope one comma-separated selector list. Selectors that already begin
 * with the root stay as written; `:root`/`:host` (variable and document
 * anchors) are re-anchored ONTO the root — prefixing them as descendants
 * would match nothing and leave every var() unresolved; everything else
 * gets the root prepended as a descendant.
 */
function prefixSelectorList(selectorList, root) {
  const mapped = selectorList
    .split(',')
    .map((rawSelector) => {
      const selector = rawSelector.trim()
      if (selector.length === 0) return rawSelector
      if (selector === root || selector.startsWith(`${root} `)) {
        return selector
      }
      if (selector === ':root' || selector === ':host') {
        return root
      }
      return `${root} ${selector}`
    })
  return [...new Set(mapped)].join(',')
}

function transform(css, root) {
  let out = ''
  let i = 0
  while (i < css.length) {
    // Skip any whitespace between constructs.
    while (i < css.length && /\s/.test(css[i])) {
      out += css[i]
      i += 1
    }
    if (i >= css.length) break

    if (css[i] === '@') {
      // An at-statement (`@layer a,b;`, `@charset "...";`) ends at `;`
      // before any `{`; an at-rule block ends at its matching `}`.
      const brace = css.indexOf('{', i)
      const semicolon = css.indexOf(';', i)
      if (semicolon !== -1 && (brace === -1 || semicolon < brace)) {
        out += css.slice(i, semicolon + 1)
        i = semicolon + 1
        continue
      }
      if (brace === -1) {
        out += css.slice(i)
        break
      }
      const head = css.slice(i, brace)
      const atName = /^@([a-zA-Z-]+)/.exec(head.trimStart())?.[1] ?? ''

      let depth = 1
      let j = brace + 1
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1
        else if (css[j] === '}') depth -= 1
        j += 1
      }
      const body = css.slice(brace + 1, j - 1)

      if (NON_SELECTOR_BLOCKS.has(atName.toLowerCase())) {
        out += head + '{' + body + '}'
      } else {
        out += head + '{' + transform(body, root) + '}'
      }
      i = j
      continue
    }

    // A plain style rule: selector list up to `{`, declarations to `}`.
    const brace = css.indexOf('{', i)
    if (brace === -1) {
      out += css.slice(i)
      break
    }
    const selector = css.slice(i, brace)
    let depth = 1
    let j = brace + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    const body = css.slice(brace + 1, j - 1)
    out += prefixSelectorList(selector, root) + '{' + body + '}'
    i = j
  }
  return out
}

export function scopeCss(css, root = '.scifork-root') {
  return transform(css, root)
}
