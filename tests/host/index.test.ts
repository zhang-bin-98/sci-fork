import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../../src/host/index.js'
import type {
  SkillRegistration,
  SkillsPort,
  WebRoute,
  WebServerPort,
} from '../../src/host/contracts.js'

function fakeContext() {
  const disposers: Array<() => void> = []
  const registeredSkills: Array<() => SkillRegistration> = []
  const registeredRoutes: WebRoute[] = []
  const skills: SkillsPort = {
    register(skill) {
      registeredSkills.push(() => skill)
      return () => {}
    },
  }
  const webServer: WebServerPort = {
    register(route) {
      registeredRoutes.push(route)
      return () => {}
    },
  }
  return {
    ctx: {
      get(key: string) {
        if (key === 'skills') return skills
        if (key === 'webServer') return webServer
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
  }
}

describe('host apply', () => {
  it('exports the scifork plugin name', () => {
    expect(name).toBe('scifork')
  })

  it('declares skills and webServer as hard dependencies', () => {
    expect([...inject]).toEqual(['skills', 'webServer'])
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

  it('keeps every registration disposable for unload', () => {
    const fake = fakeContext()
    apply(fake.ctx as never)
    expect(fake.disposers).toHaveLength(4)
    for (const dispose of fake.disposers) dispose()
  })
})
