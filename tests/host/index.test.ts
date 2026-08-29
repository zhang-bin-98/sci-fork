import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../../src/host/index.js'
import type {
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
        return undefined
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
  }
}

describe('host apply', () => {
  it('exports the scifork plugin name', () => {
    expect(name).toBe('scifork')
  })

  it('declares the seven host services as hard dependencies', () => {
    expect([...inject]).toEqual(['skills', 'webServer', 'subprocess', 'fs', 'storageDomain', 'tools', 'commands'])
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
    expect(fake.registeredRoutes.map((route) => route.path)).toEqual([
      '/scifork/api/spike',
      '/scifork/api/launch',
    ])
    expect(fake.storageDomain.openedSpecs).toEqual([uiStateDomainSpec()])
    expect(fake.tools.definitions.map((definition) => definition.name).sort()).toEqual([
      'research_graph_apply',
      'research_graph_focus',
      'research_graph_read',
    ])
    expect(fake.commands.definitions.map((definition) => definition.name)).toEqual(['research'])
  })

  it('wires the spike route to an argv-only Git subprocess probe', async () => {
    const fake = fakeContext()
    await apply(fake.ctx as never)
    const route = fake.registeredRoutes.find((candidate) => candidate.path.endsWith('/spike'))
    if (route === undefined) throw new Error('spike route was not registered')
    let body = ''
    const response = {
      statusCode: 0,
      setHeader() {},
      end(chunk: string) {
        body = chunk
      },
    }
    await route.handler({ method: 'GET' } as never, response as never)
    expect(fake.spawnedGit).toHaveLength(1)
    expect(fake.spawnedGit[0]?.argv).toEqual([
      'C:\\git\\git.exe',
      'rev-parse',
      '--show-toplevel',
    ])
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(body)).toEqual({ ok: true, stage: 'm0' })
    expect(body).not.toContain('C:\\repo')
  })

  it('keeps every registration disposable for unload', async () => {
    const fake = fakeContext()
    await apply(fake.ctx as never)
    // 2 skills + 2 routes + 1 domain close + 1 tools + 1 commands
    expect(fake.disposers).toHaveLength(7)
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
