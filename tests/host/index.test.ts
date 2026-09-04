import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../../src/host/index.js'
import { PageKeyStore } from '../../src/host/page-keys.js'
import type {
  SessionPort,
  SessionsPort,
  SkillRegistration,
  SkillsPort,
  SubprocessPort,
  SubprocessSpawnSpec,
  WebRoute,
  WebServerPort,
} from '../../src/host/contracts.js'
import { FakeCommandsPort, FakeFs, FakeStorageDomainPort, FakeToolsPort } from './fakes.js'
import { UI_STATE_DOMAIN, uiStateDomainSpec } from '../../src/host/ui-state.js'

function fakeContext(host: '127.0.0.1' | '0.0.0.0' = '127.0.0.1') {
  const disposers: Array<() => void> = []
  const registeredSkills: Array<() => SkillRegistration> = []
  const registeredRoutes: WebRoute[] = []
  const spawnedGit: SubprocessSpawnSpec[] = []
  const sessionDisposedListeners: Array<(session: SessionPort) => void> = []
  const skills: SkillsPort = {
    register(skill) {
      registeredSkills.push(() => skill)
      return () => {}
    },
  }
  const webServer: WebServerPort = {
    host,
    register(route) {
      registeredRoutes.push(route)
      return () => {}
    },
  }
  const subprocess: SubprocessPort = {
    async resolveExecutable(command) {
      return command === 'git' ? 'C:\\git\\git.exe' : command
    },
    spawn(spec) {
      spawnedGit.push(spec)
      return {
        pid: 1,
        collected: {
          stdout: {
            readFrom() {
              return {
                text: 'C:\\repo\n',
                nextOffset: 8,
                lossy: false,
              }
            },
          },
        },
        done: Promise.resolve({ exitCode: 0, signal: null }),
        terminate() {},
        async waitForExit() {
          return true
        },
      }
    },
  }
  const fs = new FakeFs({})
  const storageDomain = new FakeStorageDomainPort()
  const tools = new FakeToolsPort()
  const commands = new FakeCommandsPort()
  const sandboxPolicy = {
    resolve: () => ({ mode: 'workspace-write' as const, workspaceRoot: '/proj', sessionId: 's1' }),
  }
  const sessionsById = new Map<string, SessionPort>([
    ['s1', { id: 's1', header: { cwd: '/proj' } }],
  ])
  const sessions: SessionsPort = {
    get(id) {
      return sessionsById.get(id)
    },
  }
  return {
    ctx: {
      get(key: string) {
        if (key === 'skills') return skills
        if (key === 'webServer') return webServer
        if (key === 'subprocess') return subprocess
        if (key === 'fs') return fs
        if (key === 'storageDomain') return storageDomain
        if (key === 'tools') return tools
        if (key === 'commands') return commands
        if (key === 'sessions') return sessions
        if (key === 'sandboxPolicy') return sandboxPolicy
        return undefined
      },
      on(name: string, listener: (session: SessionPort) => void) {
        if (name === 'session/disposed') sessionDisposedListeners.push(listener)
        return () => {
          const index = sessionDisposedListeners.indexOf(listener)
          if (index >= 0) sessionDisposedListeners.splice(index, 1)
        }
      },
      effect(callback: () => () => void) {
        const disposer = callback()
        disposers.push(disposer)
        return disposer
      },
    },
    disposers,
    registeredSkills,
    registeredRoutes,
    spawnedGit,
    storageDomain,
    tools,
    commands,
    sessionDisposedListeners,
    sessionsById,
  }
}

describe('host apply', () => {
  it('exports the scifork plugin name', () => {
    expect(name).toBe('scifork')
  })

  it('declares the nine host services as hard dependencies', () => {
    expect([...inject]).toEqual([
      'skills',
      'webServer',
      'subprocess',
      'fs',
      'storageDomain',
      'tools',
      'commands',
      'sessions',
      'sandboxPolicy',
    ])
  })

  it('fails closed before registration when DSH Web listens on all interfaces', async () => {
    const fake = fakeContext('0.0.0.0')
    await expect(apply(fake.ctx as never)).rejects.toThrow(/127\.0\.0\.1/)
    expect(fake.registeredSkills).toHaveLength(0)
    expect(fake.registeredRoutes).toHaveLength(0)
    expect(fake.tools.definitions).toHaveLength(0)
  })

  it('registers skills, routes, the ui-state domain, tools, and commands', async () => {
    const fake = fakeContext()
    await apply(fake.ctx as never)
    expect(fake.registeredSkills.map((register) => register().name)).toEqual([
      'scifork-research',
      'pubmed-search',
    ])
    expect(fake.registeredSkills.map((register) => register().resourceBase)).toEqual([
      undefined,
      {
        kind: 'directory',
        path: expect.stringMatching(/[\\/]skills[\\/]pubmed-search$/),
      },
    ])
    expect(fake.registeredRoutes.map((route) => route.path)).toEqual([
      '/scifork',
      '/scifork/api/launch',
      '/scifork/api/snapshot',
      '/scifork/api/entity',
      '/scifork/api/focus',
    ])
    expect(fake.storageDomain.openedSpecs).toEqual([uiStateDomainSpec()])
    expect(fake.tools.definitions.map((definition) => definition.name).sort()).toEqual([
      'research_graph_apply',
      'research_graph_focus',
      'research_graph_read',
    ])
    expect(fake.commands.definitions.map((definition) => definition.name)).toEqual(['research'])
  })

  it('revokes Page Keys on Session disposal and clears them on unload', async () => {
    const revokeSession = vi.spyOn(PageKeyStore.prototype, 'revokeSession')
    const clear = vi.spyOn(PageKeyStore.prototype, 'clear')
    const fake = fakeContext()
    await apply(fake.ctx as never)
    expect(fake.sessionDisposedListeners).toHaveLength(1)
    fake.sessionDisposedListeners[0]?.({ id: 's1', header: { cwd: '/proj' } })
    expect(revokeSession).toHaveBeenCalledWith('s1')

    for (const dispose of fake.disposers) dispose()
    expect(clear).toHaveBeenCalledOnce()
    revokeSession.mockRestore()
    clear.mockRestore()
  })

  it('keeps every registration disposable for unload', async () => {
    const fake = fakeContext()
    await apply(fake.ctx as never)
    // 2 skills + 5 routes + 1 domain close + 1 Page Key clear + tools + commands
    expect(fake.disposers).toHaveLength(11)
    for (const dispose of fake.disposers) dispose()
    expect(fake.storageDomain.closedCount).toBe(1)
    expect(fake.tools.disposals).toHaveLength(3)
    expect(fake.commands.disposals).toHaveLength(1)
  })

  it('opens the pinned domain name exactly once', async () => {
    const fake = fakeContext()
    await apply(fake.ctx as never)
    expect(fake.storageDomain.openedSpecs).toHaveLength(1)
    expect((fake.storageDomain.openedSpecs[0] as { name: string }).name).toBe(UI_STATE_DOMAIN)
  })
})
