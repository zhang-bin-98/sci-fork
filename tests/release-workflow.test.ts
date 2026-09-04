import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface WorkflowStep {
  id?: string
  name?: string
  uses?: string
  env?: Record<string, string>
  run?: string
}

interface ReleaseWorkflow {
  on?: { push?: { tags?: string[] } }
  jobs?: {
    verify?: {
      permissions?: Record<string, string>
      env?: Record<string, string>
      outputs?: Record<string, string>
      steps?: WorkflowStep[]
    }
    release?: {
      needs?: string
      permissions?: Record<string, string>
      env?: Record<string, string>
      steps?: WorkflowStep[]
    }
  }
}

const source = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const workflow = yaml.load(source) as ReleaseWorkflow
const verify = workflow.jobs?.verify
const release = workflow.jobs?.release
const verifySteps = verify?.steps ?? []
const releaseSteps = release?.steps ?? []
const steps = [...verifySteps, ...releaseSteps]

describe('GitHub release workflow', () => {
  it('uses the protected tag trigger, least privilege, and immutable action pins', () => {
    expect(workflow.on?.push?.tags).toEqual(['v*'])
    expect(verify?.permissions).toEqual({ contents: 'read' })
    expect(release?.permissions).toEqual({ actions: 'read', contents: 'write' })
    expect(release?.needs).toBe('verify')
    expect(release?.env?.GH_REPO).toBe('${{ github.repository }}')
    expect(verify?.outputs?.commit).toBe('${{ steps.source.outputs.commit }}')
    expect(release?.env?.VERIFIED_COMMIT).toBe('${{ needs.verify.outputs.commit }}')

    const actions = steps.flatMap((step) => step.uses === undefined ? [] : [step.uses])
    expect(actions).not.toHaveLength(0)
    for (const action of actions) expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/)
    expect(releaseSteps.every((step) => step.uses === undefined)).toBe(true)
  })

  it('exposes the GitHub token only to repository API steps', () => {
    expect(verify?.env).not.toHaveProperty('GH_TOKEN')
    expect(release?.env).not.toHaveProperty('GH_TOKEN')
    expect(steps.filter((step) => step.env?.GH_TOKEN !== undefined).map((step) => step.name)).toEqual([
      'Verify release does not exist',
      'Download verified release assets',
      'Create GitHub Release',
    ])
  })

  it('checks for both published releases and drafts by tag', () => {
    const lookup = steps.find((step) => step.name === 'Verify release does not exist')?.run ?? ''

    expect(lookup).toContain('gh api graphql')
    expect(lookup).toContain('release(tagName:$tag)')
    expect(lookup).not.toContain('/releases/tags/')
  })

  it('publishes only after draft creation and both asset uploads', () => {
    const publish = steps.find((step) => step.name === 'Create GitHub Release')?.run ?? ''
    const draft = publish.indexOf('-F draft=true')
    const tarballUpload = publish.indexOf('upload_asset "$TARBALL"')
    const checksumUpload = publish.indexOf('upload_asset "$CHECKSUM"')
    const finish = publish.indexOf('--method PATCH')

    expect(draft).toBeGreaterThanOrEqual(0)
    expect(tarballUpload).toBeGreaterThan(draft)
    expect(checksumUpload).toBeGreaterThan(tarballUpload)
    expect(finish).toBeGreaterThan(checksumUpload)
    expect(publish).toContain('-F draft=false')
    expect(publish).toContain("--jq '.draft'")
  })

  it('binds publishing and cleanup to the newly created draft id', () => {
    const publish = steps.find((step) => step.name === 'Create GitHub Release')?.run ?? ''

    expect(publish).toContain('release_id=')
    expect(publish).toContain('releases/${release_id}')
    expect(publish).toContain('matching_release_count')
    expect(publish).toContain('for attempt in 1 2 3 4 5')
    expect(publish).not.toContain('--slurp')
    expect(publish).not.toContain('gh release upload')
    expect(publish).not.toContain('gh release edit')
    expect(publish).not.toContain('gh release delete')
  })

  it('rechecks the remote tag against the packaged commit before release creation', () => {
    const sourceCheck = verifySteps.find((step) => step.name === 'Verify release source')
    const publish = releaseSteps.find((step) => step.name === 'Create GitHub Release')?.run ?? ''

    expect(sourceCheck?.id).toBe('source')
    expect(sourceCheck?.run).toContain('commit=${tag_commit}')
    expect(publish).toContain('git/tags/${tag_object_sha}')
    expect(publish).toContain('current_tag_commit')
    expect(publish).toContain('VERIFIED_COMMIT')
  })

  it('requires both README languages and the MIT license in the archive', () => {
    const archive = verifySteps.find((step) => step.name === 'Build release assets')?.run ?? ''

    expect(archive).toContain('package/README.md')
    expect(archive).toContain('package/README.zh-CN.md')
    expect(archive).toContain('package/LICENSE')
  })

  it('verifies installation from tagged Git source before packaging', () => {
    const verification = verifySteps.find((step) => step.name === 'Verify source and dry-run package')?.run ?? ''

    expect(verification).toContain('corepack pnpm verify:source')
  })

  it('enables the pnpm shim before installing a tagged Git dependency', () => {
    const enableIndex = verifySteps.findIndex((step) => step.name === 'Enable package manager shims')
    const installIndex = verifySteps.findIndex((step) => step.name === 'Install locked dependencies')
    const verifyIndex = verifySteps.findIndex((step) => step.name === 'Verify source and dry-run package')

    expect(enableIndex).toBeGreaterThanOrEqual(0)
    expect(verifySteps[enableIndex]?.run).toBe('corepack enable pnpm')
    expect(installIndex).toBeGreaterThan(enableIndex)
    expect(verifyIndex).toBeGreaterThan(installIndex)
  })
})
