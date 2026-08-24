import type { Context } from '@deepseek-ai/cordis'
import { dirname } from 'node:path'
import type { SkillsPort, SubprocessPort, WebServerPort } from './contracts.js'
import { gitShowToplevel } from './git-checkpoints.js'
import { findSkillsRoot, loadPackagedSkills } from './skills.js'
import { sciforkRoutes } from './web-routes.js'

export const name = 'scifork'

/**
 * Hard dependencies: Cordis waits for all three services before applying the
 * fiber (and re-applies after service updates). The SciFork bundle targets
 * the DSH Web profile, which provides all three.
 */
export const inject = ['skills', 'webServer', 'subprocess'] as const

/**
 * M0 compatibility spike entry point. Every registration rides `ctx.effect`
 * so bundle unload removes it.
 */
export function apply(ctx: Context): void {
  // inject guarantees all three services exist before activation.
  const skills = ctx.get('skills') as SkillsPort
  const webServer = ctx.get('webServer') as WebServerPort
  const subprocess = ctx.get('subprocess') as SubprocessPort
  if (webServer.host !== '127.0.0.1') {
    throw new Error('scifork: DSH Web must listen on 127.0.0.1')
  }
  const skillsRoot = findSkillsRoot(import.meta.url)
  if (skillsRoot === undefined) {
    throw new Error('scifork: packaged skills directory not found')
  }
  for (const skill of loadPackagedSkills(skillsRoot)) {
    ctx.effect(() => skills.register(skill))
  }
  const packageRoot = dirname(skillsRoot)
  const gitProbe = async (): Promise<boolean> =>
    (await gitShowToplevel(subprocess, packageRoot)) !== undefined

  for (const route of sciforkRoutes({ gitProbe })) {
    ctx.effect(() => webServer.register(route))
  }
}
