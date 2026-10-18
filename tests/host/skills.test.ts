import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PACKAGED_SKILLS, loadPackagedSkills } from '../../src/host/skills.js'

const tempDirs: string[] = []

function makeSkillRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'scifork-skills-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'scifork-research'), { recursive: true })
  writeFileSync(
    join(root, 'scifork-research', 'SKILL.md'),
    '# SciFork Research\n\nM0 stub body.\n',
  )
  return root
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('loadPackagedSkills', () => {
  it('loads the single packaged skill with runtime source and no resourceBase', () => {
    const skills = loadPackagedSkills(makeSkillRoot())
    expect(skills).toHaveLength(1)
    expect(skills.map((skill) => skill.name)).toEqual(['scifork-research'])
    for (const skill of skills) {
      expect(skill.source).toBe('runtime')
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.content).toContain('M0 stub body.')
      expect('resourceBase' in skill).toBe(false)
    }
  })

  it('publishes retrieval-before-formatting in the catalog description', () => {
    const research = PACKAGED_SKILLS.find((skill) => skill.name === 'scifork-research')
    expect(PACKAGED_SKILLS).toHaveLength(1)
    expect(research?.description).toMatch(/already .*current .*Chat context/i)
    expect(research?.description).toMatch(/does not .*retriev/i)
    expect(research?.description).toMatch(/research expansion/i)
    expect(research?.description).toMatch(/progressive research/i)
    expect(research?.description).toContain('深度研究')
    expect(research?.description).toContain('深度调研')
    expect(research?.description).toMatch(/without another click/i)
    expect(research?.description).toMatch(/delete.*branch/i)
    expect(research?.description).toMatch(/current\/selected\/focused/i)
    expect(research?.whenToUse).toMatch(/existing .*graph/i)
    expect(research?.whenToUse).toMatch(/explicit .*Chat/i)
    expect(research?.whenToUse).toMatch(/current, selected, or focused/i)
    expect(research?.whenToUse).toMatch(/external retrieval/i)
  })

  it('keeps skill names kebab-case', () => {
    for (const skill of PACKAGED_SKILLS) {
      expect(skill.name).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it('throws when a declared skill file is missing', () => {
    const root = makeSkillRoot()
    rmSync(join(root, 'scifork-research', 'SKILL.md'))
    expect(() => loadPackagedSkills(root)).toThrow(
      'scifork: failed to read packaged skill scifork-research',
    )

    try {
      loadPackagedSkills(root)
    } catch (error) {
      expect((error as Error).message).not.toContain(root)
    }
  })

  it('throws when a declared skill body is empty', () => {
    const root = makeSkillRoot()
    writeFileSync(join(root, 'scifork-research', 'SKILL.md'), '   \n')
    expect(() => loadPackagedSkills(root)).toThrow()
  })
})
