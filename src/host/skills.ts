import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillResourceBase } from './contracts.js'

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
  directoryResources?: readonly string[]
}

export const PACKAGED_SKILLS = [
  {
    name: 'scifork-research',
    description:
      'Explicit current-Chat 深度研究, 深度调研, deep research, progressive, iterative, or multi-round requests mean a multi-level Progressive Research Run, not Evidence-only enrichment: plan at least two levels and continue through exactly one new Hypothesis without another click or import confirmation. Otherwise format retrieval/PDF results already in the current DSH Chat context for one-step Research Expansion/import; critique or delete exact current/selected/focused branches. This Skill does not retrieve.',
    whenToUse:
      'Use after a completed retrieval phase for Research Expansion or evidence import, for an explicit current-Chat request to orchestrate Progressive Research on an existing graph, or directly for graph critique or deletion including requests about the current, selected, or focused entity.',
    file: 'scifork-research/SKILL.md',
  },
  {
    name: 'pubmed-search',
    description:
      'Run concise PubMed/Entrez search or PMID/DOI lookup; complete retrieval before loading scifork-research, and do not load both while retrieval is unfinished.',
    whenToUse:
      'Use first when the task needs PubMed literature metadata, PMID/DOI lookup, or paged search results.',
    file: 'pubmed-search/SKILL.md',
    directoryResources: ['helper.mjs'],
  },
] as const satisfies readonly PackagedSkillSource[]

export interface LoadedPackagedSkill {
  name: string
  description: string
  whenToUse?: string
  content: string
  source: 'runtime'
  resourceBase?: SkillResourceBase
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
    const skillPath = join(skillsRoot, entry.file)
    let content: string
    try {
      content = readFileSync(skillPath, 'utf8')
    } catch {
      throw new Error(`scifork: failed to read packaged skill ${entry.name}`)
    }
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
    if (entry.directoryResources !== undefined) {
      const resourceDirectory = dirname(skillPath)
      for (const resource of entry.directoryResources) {
        if (!existsSync(join(resourceDirectory, resource))) {
          throw new Error(
            `scifork: failed to read packaged skill resource ${entry.name}/${resource}`,
          )
        }
      }
      skill.resourceBase = { kind: 'directory', path: resourceDirectory }
    }
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
