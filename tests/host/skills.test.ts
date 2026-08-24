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
  mkdirSync(join(root, 'pubmed-search'), { recursive: true })
  writeFileSync(
    join(root, 'scifork-research', 'SKILL.md'),
    '# SciFork Research\n\nM0 stub body.\n',
  )
  writeFileSync(
    join(root, 'pubmed-search', 'SKILL.md'),
    '# PubMed Search\n\nM0 stub body.\n',
  )
  return root
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('loadPackagedSkills', () => {
  it('loads both packaged skills with runtime source', () => {
    const skills = loadPackagedSkills(makeSkillRoot())
    expect(skills).toHaveLength(2)
    expect(skills.map((skill) => skill.name)).toEqual([
      'scifork-research',
      'pubmed-search',
    ])
    for (const skill of skills) {
      expect(skill.source).toBe('runtime')
      expect(skill.description.length).toBeGreaterThan(0)
      expect(skill.content).toContain('M0 stub body.')
    }
  })

  it('keeps skill names kebab-case', () => {
    for (const skill of PACKAGED_SKILLS) {
      expect(skill.name).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it('throws when a declared skill file is missing', () => {
    const root = makeSkillRoot()
    rmSync(join(root, 'pubmed-search', 'SKILL.md'))
    expect(() => loadPackagedSkills(root)).toThrow()
  })

  it('throws when a declared skill body is empty', () => {
    const root = makeSkillRoot()
    writeFileSync(join(root, 'scifork-research', 'SKILL.md'), '   \n')
    expect(() => loadPackagedSkills(root)).toThrow()
  })
})
