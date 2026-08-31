import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/verify-release.mjs', import.meta.url))
const roots: string[] = []

function fixture(manifest: Record<string, unknown>, license?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'scifork-release-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  if (license !== undefined) writeFileSync(join(root, 'LICENSE'), license)
  return root
}

function run(root: string, tag: string) {
  return spawnSync(process.execPath, [script, tag], {
    cwd: root,
    encoding: 'utf8',
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('release preflight', () => {
  it('accepts an exact version tag with a selected license', () => {
    const root = fixture({ name: 'dsh-scifork', version: '1.2.3', license: 'MIT' }, 'MIT license text')
    const result = run(root, 'v1.2.3')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('dsh-scifork@1.2.3')
  })

  it('rejects a tag that does not exactly match the package version', () => {
    const root = fixture({ name: 'dsh-scifork', version: '1.2.3', license: 'MIT' }, 'MIT license text')
    const result = run(root, 'v1.2.4')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must exactly match package version v1.2.3')
  })

  it('rejects a package version that is not SemVer', () => {
    const root = fixture({ name: 'dsh-scifork', version: 'release-1', license: 'MIT' }, 'MIT license text')
    const result = run(root, 'vrelease-1')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('package version must be valid SemVer')
  })

  it.each([
    [{ name: 'dsh-scifork', version: '1.2.3', license: 'UNLICENSED' }, 'license is not selected'],
    [{ name: 'dsh-scifork', version: '1.2.3', license: 'MIT' }, 'license file is missing'],
    [{ name: 'dsh-scifork', version: '1.2.3', license: 'MIT' }, 'license file is missing', ''],
  ])('rejects unresolved license metadata', (manifest, message, license) => {
    const root = fixture(manifest, license ?? (manifest.license === 'UNLICENSED' ? 'placeholder' : undefined))
    const result = run(root, 'v1.2.3')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })

  it('rejects workspace dependency specifiers', () => {
    const root = fixture({
      name: 'dsh-scifork',
      version: '1.2.3-rc.1',
      license: 'MIT',
      dependencies: { example: 'workspace:*' },
    }, 'MIT license text')
    const result = run(root, 'v1.2.3-rc.1')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('workspace dependency is not publishable: dependencies.example')
  })
})
