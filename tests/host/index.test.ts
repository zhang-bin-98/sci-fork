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
  return {
    ctx: {
      get(key: string) {
        if (key === 'skills') return skills
        if (key === 'webServer') return webServer
        if (key === 'subprocess') return subprocess
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
  }
}

describe('host apply', () => {
  it('exports the scifork plugin name', () => {
    expect(name).toBe('scifork')
  })

  it('declares skills, webServer, and subprocess as hard dependencies', () => {
    expect([...inject]).toEqual(['skills', 'webServer', 'subprocess'])
  })

  it('fails closed before registration when DSH Web listens on all interfaces', () => {
    const fake = fakeContext('0.0.0.0')
    expect(() => apply(fake.ctx as never)).toThrow(/127\.0\.0\.1/)
    expect(fake.registeredSkills).toHaveLength(0)
    expect(fake.registeredRoutes).toHaveLength(0)
  })

  it('registers both packaged skills and the API routes', () => {
    const fake = fakeContext()
    apply(fake.ctx as never)
    expect(fake.registeredSkills).toHaveLength(2)
    expect(fake.registeredSkills.map((register) => register().name)).toEqual([
      'scifork-research',
      'pubmed-search',
    ])
    expect(fake.registeredRoutes.map((route) => route.path)).toEqual([
      '/scifork/api/spike',
      '/scifork/api/launch',
    ])
    for (const route of fake.registeredRoutes) {
      expect(route.kind).toBe('exact')
    }
  })


  it('wires the spike route to an argv-only Git subprocess probe', async () => {
    const fake = fakeContext()
    apply(fake.ctx as never)
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
  it('keeps every registration disposable for unload', () => {
    const fake = fakeContext()
    apply(fake.ctx as never)
    expect(fake.disposers).toHaveLength(4)
    for (const dispose of fake.disposers) dispose()
  })
})
