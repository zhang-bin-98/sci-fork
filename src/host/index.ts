import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import type {
  CommandsPort,
  FsPort,
  SandboxPolicyPort,
  SessionLifecyclePort,
  SessionsPort,
  SkillsPort,
  StorageDomainPort,
  SubprocessPort,
  ToolsPort,
  WebServerPort,
} from './contracts.js'
import { registerResearchCommands } from './commands.js'
import { CompanionService } from './companion-service.js'
import { PageKeyStore } from './page-keys.js'
import { findSkillsRoot, loadPackagedSkills } from './skills.js'
import { registerResearchTools } from './tools.js'
import { uiStateDomainSpec } from './ui-state.js'
import { sciforkRoutes } from './web-routes.js'

export const name = 'scifork'

/**
 * Hard dependencies: Cordis waits for all nine services before applying the
 * fiber (and re-applies after service updates). The SciFork bundle targets
 * the DSH Web profile, which provides all of them.
 */
export const inject = [
  'skills',
  'subprocess',
  'fs',
  'storageDomain',
  'tools',
  'commands',
  'sessions',
  'sandboxPolicy',
] as const

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

/**
 * Host entry point. Every registration rides `ctx.effect` so bundle unload
 * removes it; the ui-state storage domain is opened once and closed through
 * its own effect disposer.
 */
export async function apply(ctx: Context): Promise<void> {
  // inject guarantees all nine services exist before activation.
  const skills = ctx.get('skills') as SkillsPort
  const subprocess = ctx.get('subprocess') as SubprocessPort
  const fs = ctx.get('fs') as FsPort
  const storageDomain = ctx.get('storageDomain') as StorageDomainPort
  const tools = ctx.get('tools') as ToolsPort
  const commands = ctx.get('commands') as CommandsPort
  const sessions = ctx.get('sessions') as SessionsPort
  const sandboxPolicy = ctx.get('sandboxPolicy') as SandboxPolicyPort
  const skillsRoot = findSkillsRoot(import.meta.url)
  if (skillsRoot === undefined) {
    throw new Error('scifork: packaged skills directory not found')
  }
  for (const skill of loadPackagedSkills(skillsRoot)) {
    ctx.effect(() => skills.register(skill))
  }

  const storage = await storageDomain.open(uiStateDomainSpec())
  ctx.effect(() => () => {
    void storage.close()
  })

  const researchDeps = { fs, subprocess, hash: sha256 }
  const researchMutationDeps = { ...researchDeps, sandboxPolicy }
  const pageKeys = new PageKeyStore()
  ctx.effect(() => () => pageKeys.clear())
  const sessionLifecycle = ctx as unknown as SessionLifecyclePort
  sessionLifecycle.on('session/disposed', (session) => {
    pageKeys.revokeSession(session.id)
  })
  const api = new CompanionService({ ...researchDeps, storage, sessions, pageKeys })
  // DSH 0.2.1 boots the web profile before the app creates the webServer
  // service; waiting through the runtime inject (the same pattern as the
  // shipped dsh-client-modules consumer) keeps the boot graph clean while
  // still failing closed unless the listener is loopback.
  ctx.inject(['webServer'], () => {
    const webServer = ctx.get('webServer') as WebServerPort
    if (webServer.host !== '127.0.0.1') {
      throw new Error('scifork: DSH Web must listen on 127.0.0.1')
    }
    for (const route of sciforkRoutes({ api })) {
      ctx.effect(() => webServer.register(route))
    }
  })

  ctx.effect(() => registerResearchTools({ ...researchMutationDeps, storage, tools }))
  ctx.effect(() => registerResearchCommands({ ...researchMutationDeps, commands }))
}
