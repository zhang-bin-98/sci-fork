import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Packaged skills shipped inside the bundle as `skills/<name>/SKILL.md`.
 * The DSH filesystem skill provider never scans npm packages, so the Host
 * registers each skill with ctx.skills.register() during apply(). The files
 * remain the single source of the instruction body.
 */
export interface PackagedSkillSource {
  name: string
  description: string
  whenToUse?: string
  file: string
}

export const PACKAGED_SKILLS = [
  {
    name: 'scifork-research',
    description:
      'Format retrieval results into Research Import Drafts, plan simulations, and critique the SciFork research graph.',
    whenToUse:
      'Load after a retrieval or PDF skill, when current results must become a Research Import Draft.',
    file: 'scifork-research/SKILL.md',
  },
  {
    name: 'pubmed-search',
    description:
      'Search PubMed metadata with full Entrez queries, paged batches up to 300 records, and PMID/DOI lookup.',
    whenToUse:
      'Use when the task needs PubMed literature metadata, PMID/DOI lookup, or paged search results.',
    file: 'pubmed-search/SKILL.md',
  },
] as const satisfies readonly PackagedSkillSource[]

export interface LoadedPackagedSkill {
  name: string
  description: string
  whenToUse?: string
  content: string
  source: 'runtime'
}

/**
 * Load every declared packaged skill from `skillsRoot`. Empty bodies fail
 * loudly: a packaged skill without instructions must not silently vanish
 * from the catalog.
 */
export function loadPackagedSkills(
  skillsRoot: string,
  entries: readonly PackagedSkillSource[] = PACKAGED_SKILLS,
): LoadedPackagedSkill[] {
  return entries.map((entry) => {
    const content = readFileSync(join(skillsRoot, entry.file), 'utf8')
    if (!content.trim()) {
      throw new Error(`scifork: packaged skill ${entry.name} body is empty`)
    }
    const skill: LoadedPackagedSkill = {
      name: entry.name,
      description: entry.description,
      content,
      source: 'runtime',
    }
    if (entry.whenToUse !== undefined) skill.whenToUse = entry.whenToUse
    return skill
  })
}

/** Maximum levels to walk upward when locating the package skills directory. */
const SKILLS_ROOT_WALK_LIMIT = 4

/**
 * Locate the package's `skills/` directory from a module URL. Works both in
 * the built layout (dist/host) and in source (src/host) by walking up until
 * the declared skill files exist.
 */
export function findSkillsRoot(fromUrl: string): string | undefined {
  let current = dirname(fileURLToPath(fromUrl))
  for (let depth = 0; depth < SKILLS_ROOT_WALK_LIMIT; depth += 1) {
    const candidate = join(current, 'skills')
    if (existsSync(join(candidate, 'scifork-research', 'SKILL.md'))) {
      return candidate
    }
    current = dirname(current)
  }
  return undefined
}
