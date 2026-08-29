import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { companionAssetsFromPackageRoot } from '../../src/host/companion-assets.js'

describe('packaged Companion assets', () => {
  let root: string | undefined

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  it('constructs lazily and reads only fixed dist/companion files', () => {
    root = mkdtempSync(join(tmpdir(), 'scifork-assets-'))
    const dist = join(root, 'dist', 'companion')
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<main>index</main>')
    writeFileSync(join(dist, 'app.js'), 'void 0')
    writeFileSync(join(dist, 'styles.css'), 'body{}')

    const assets = companionAssetsFromPackageRoot(root)
    expect(assets.read('index.html').toString()).toBe('<main>index</main>')
    expect(assets.read('app.js').toString()).toBe('void 0')
    expect(assets.read('styles.css').toString()).toBe('body{}')
  })

  it('does not read at construction and fails closed when an asset is missing', () => {
    root = mkdtempSync(join(tmpdir(), 'scifork-assets-'))
    const assets = companionAssetsFromPackageRoot(root)
    expect(() => assets.read('index.html')).toThrow()
  })

  it('builds asset URLs that also resolve from the slashless Companion path', () => {
    const buildScript = readFileSync('scripts/build-companion.mjs', 'utf8')
    expect(buildScript).toContain('/scifork/styles.css')
    expect(buildScript).toContain('/scifork/app.js')
  })
})
