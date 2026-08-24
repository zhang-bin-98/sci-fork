import type { Context } from '@deepseek-ai/cordis'
import type { SkillsPort, WebServerPort } from './contracts.js'
import { findSkillsRoot, loadPackagedSkills } from './skills.js'
import { sciforkRoutes } from './web-routes.js'

export const name = 'scifork'

/**
 * M0 compatibility spike entry point. Every DSH service is optional
 * (`ctx.get`) so the bundle loads on profiles that lack a surface, and every
 * registration rides `ctx.effect` so bundle unload removes it.
 */
export function apply(ctx: Context): void {
  const skills = ctx.get('skills') as SkillsPort | undefined
  if (skills !== undefined) {
    const skillsRoot = findSkillsRoot(import.meta.url)
    if (skillsRoot !== undefined) {
      for (const skill of loadPackagedSkills(skillsRoot)) {
        ctx.effect(() => skills.register(skill))
      }
    }
  }

  const webServer = ctx.get('webServer') as WebServerPort | undefined
  if (webServer !== undefined) {
    for (const route of sciforkRoutes()) {
      ctx.effect(() => webServer.register(route))
    }
  }
}
