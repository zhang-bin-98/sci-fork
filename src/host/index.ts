import type { Context } from '@deepseek-ai/cordis'
import type { SkillsPort, WebServerPort } from './contracts.js'
import { findSkillsRoot, loadPackagedSkills } from './skills.js'
import { sciforkRoutes } from './web-routes.js'

export const name = 'scifork'

/**
 * Hard dependencies: Cordis waits for both services before applying the
 * fiber (and re-applies after service updates). The SciFork bundle targets
 * the DSH Web profile, which always provides them.
 */
export const inject = ['skills', 'webServer'] as const

/**
 * M0 compatibility spike entry point. Every registration rides `ctx.effect`
 * so bundle unload removes it.
 */
export function apply(ctx: Context): void {
  // inject guarantees both services exist before activation.
  const skills = ctx.get('skills') as SkillsPort
  const webServer = ctx.get('webServer') as WebServerPort
  const skillsRoot = findSkillsRoot(import.meta.url)
  if (skillsRoot === undefined) {
    throw new Error('scifork: packaged skills directory not found')
  }
  for (const skill of loadPackagedSkills(skillsRoot)) {
    ctx.effect(() => skills.register(skill))
  }
  for (const route of sciforkRoutes()) {
    ctx.effect(() => webServer.register(route))
  }
}
