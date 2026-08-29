import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { registerResearchCommands } from '../../src/host/commands.js'
import type { ResearchHostDeps } from '../../src/host/apply-command.js'
import { FakeCommandsPort, FakeFs, scriptedGit } from './fakes.js'
import type { CommandInvocation } from '../../src/host/contracts.js'

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex')

const PROJECT_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const NODE = 'node_bbbbbbbb-2222-4222-8222-222222222222'
const MANIFEST = JSON.stringify({ schema_version: 1, project_id: PROJECT_ID, name: 'Commands' })

function initGit() {
  return scriptedGit((argv) => {
    const sub = argv[1]
    if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { exitCode: 128, stdout: '' }
    if (sub === 'symbolic-ref') return { stdout: 'main\n' }
    if (sub === 'rev-parse') return { stdout: 'fedcba0987654321fedcba0987654321fedcba09\n' }
    if (sub === 'config') {
      const key = argv[argv.length - 1]
      if (key === 'user.name') return { stdout: 'Ada\n' }
      if (key === 'user.email') return { stdout: 'ada@example.com\n' }
      return { exitCode: 1 }
    }
    return { stdout: '' }
  }).port
}

async function registered(entries: Record<string, string> = {}) {
  const fs = new FakeFs(entries)
  const commands = new FakeCommandsPort()
  const deps: ResearchHostDeps & { commands: FakeCommandsPort; mkdirs?: (root: string) => void } = {
    fs,
    subprocess: initGit(),
    hash: sha256,
    commands,
  }
  const dispose = registerResearchCommands(deps)
  return { fs, commands, dispose, deps }
}

function invocation(cwd: string | undefined, rawInput: string): CommandInvocation {
  return {
    ...(cwd !== undefined ? { agent: { id: 's', session: { header: { cwd } } } } : {}),
    rawInput,
    signal: new AbortController().signal,
  }
}

describe('registerResearchCommands', () => {
  it('registers the research command with an input hint and disposes it', async () => {
    const { commands, dispose } = await registered()
    expect(commands.definitions).toHaveLength(1)
    expect(commands.definitions[0]).toMatchObject({ name: 'research', input: { hint: 'init | open | validate' } })
    dispose()
    expect(commands.disposals).toHaveLength(1)
  })

  it('initializes a project via /research init', async () => {
    const { commands, fs } = await registered()
    const result = await commands.definitions[0]!.handler(invocation('/newproj', ' init '))
    expect(result.kind).toBe('success')
    const text = result.kind === 'success' ? (result.text ?? '') : ''
    expect(text).toContain('initialized')
    expect(fs.contentOf('/newproj/research.json')).toContain('"schema_version": 1')
    // the success text never leaks the local absolute path
    expect(text).not.toContain('/newproj')
  })

  it('directs /research open to the keyed DSH action without emitting a URL', async () => {
    const { commands } = await registered()
    const result = await commands.definitions[0]!.handler(invocation('/proj', ' open'))
    expect(result).toMatchObject({ kind: 'success' })
    if (result.kind === 'success') {
      expect(result.text).toContain('Open Research Graph')
      expect(result.text).not.toMatch(/https?:|\/scifork|#key=/u)
    }
  })

  it('validates a healthy project', async () => {
    const { commands } = await registered({
      '/proj/research.json': MANIFEST,
      [`/proj/nodes/${NODE}.md`]: `---\nid: ${NODE}\nkind: hypothesis\nconfidence: low\n---\n# H\n\nBody.\n`,
    })
    const result = await commands.definitions[0]!.handler(invocation('/proj', ' validate'))
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.text).toContain('valid')
      expect(result.text).toContain('nodes: 1')
    }
  })

  it('reports diagnostics for an invalid project', async () => {
    const { commands } = await registered({
      '/proj/research.json': MANIFEST,
      '/proj/nodes/readme.md': '# stray',
    })
    const result = await commands.definitions[0]!.handler(invocation('/proj', ' validate'))
    expect(result).toMatchObject({ kind: 'success' })
    if (result.kind === 'success') {
      expect(result.text).toContain('unknown_managed_file')
    }
  })

  it('rejects unknown subcommands with usage text', async () => {
    const { commands } = await registered()
    const result = await commands.definitions[0]!.handler(invocation('/proj', ' branch'))
    expect(result.kind).toBe('error')
  })

  it('reports missing session context as an error', async () => {
    const { commands } = await registered()
    const result = await commands.definitions[0]!.handler(invocation(undefined, ' validate'))
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.text).toContain('SESSION_UNAVAILABLE')
  })
})
