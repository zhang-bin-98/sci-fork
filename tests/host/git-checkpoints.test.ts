import { describe, expect, it } from 'vitest'
import {
  GIT_GRACE_MS,
  buildGitArgv,
  checkpointMessage,
  gitCheckpoint,
  gitIdentityConfigured,
  gitInit,
  gitInitPreflight,
  gitPreflight,
  gitShowToplevel,
  initCheckpointMessage,
  parsePorcelainStatus,
  parseRevParseToplevel,
} from '../../src/host/git-checkpoints.js'
import type { SubprocessPort } from '../../src/host/contracts.js'
import { scriptedGit } from './fakes.js'

const HEAD_SHA = 'abcdef1234567890abcdef1234567890abcdef12'

describe('buildGitArgv', () => {
  it('returns an argv-only spec with the program first', () => {
    expect(buildGitArgv('git', ['rev-parse', '--show-toplevel'], 'C:\\proj')).toEqual({
      argv: ['git', 'rev-parse', '--show-toplevel'],
      cwd: 'C:\\proj',
    })
  })

  it('rejects unsafe empty or NUL-containing arguments', () => {
    expect(() => buildGitArgv('', [], '.')).toThrow()
    expect(() => buildGitArgv('git', ['log', '-n\x001'], '.')).toThrow()
    expect(() => buildGitArgv('git', ['rev-parse'], '')).toThrow()
  })
})

describe('parseRevParseToplevel', () => {
  it('accepts one absolute path and rejects ambiguous output', () => {
    expect(parseRevParseToplevel('C:\\proj\n')).toBe('C:\\proj')
    expect(parseRevParseToplevel('/srv/research\n')).toBe('/srv/research')
    expect(parseRevParseToplevel('research-project\n')).toBeUndefined()
    expect(parseRevParseToplevel('C:\\a\nC:\\b\n')).toBeUndefined()
  })
})

function fakeSubprocess(opts: { exitCode?: number; stdout?: string; lossy?: boolean }): SubprocessPort {
  return {
    async resolveExecutable(command: string) {
      return command === 'git' ? 'C:\\git\\git.exe' : command
    },
    spawn() {
      return {
        pid: 1,
        collected: {
          stdout: {
            readFrom() {
              return { text: opts.stdout ?? '', nextOffset: 0, lossy: opts.lossy === true }
            },
          },
          stderr: {
            readFrom() {
              return { text: '', nextOffset: 0, lossy: false }
            },
          },
        },
        done: Promise.resolve({ exitCode: opts.exitCode ?? 0, signal: null }),
        terminate() {},
        async waitForExit() { return true },
      }
    },
  }
}

describe('gitShowToplevel', () => {
  it('uses argv-only execution and the bounded grace period', async () => {
    let seenArgv: readonly string[] = []
    let seenGrace = 0
    const subprocess = fakeSubprocess({ stdout: 'C:\\proj\n' })
    const original = subprocess.spawn.bind(subprocess)
    subprocess.spawn = (spec) => {
      seenArgv = spec.argv
      seenGrace = spec.graceMs
      return original(spec)
    }
    await expect(gitShowToplevel(subprocess, 'C:\\proj')).resolves.toBe('C:\\proj')
    expect(seenArgv).toEqual(['C:\\git\\git.exe', 'rev-parse', '--show-toplevel'])
    expect(seenGrace).toBe(GIT_GRACE_MS)
  })

  it('fails closed on non-zero or lossy output', async () => {
    await expect(gitShowToplevel(fakeSubprocess({ exitCode: 128 }), '.')).resolves.toBeUndefined()
    await expect(gitShowToplevel(fakeSubprocess({ stdout: 'C:\\proj\n', lossy: true }), 'C:\\proj')).resolves.toBeUndefined()
  })
})

function healthyResponder(argv: readonly string[]): { exitCode?: number; stdout?: string } {
  const sub = argv[1]
  if (sub === 'symbolic-ref') return { stdout: 'main\n' }
  if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { stdout: 'C:\\proj\n' }
  if (sub === 'rev-parse') return { stdout: `${HEAD_SHA}\n` }
  if (sub === 'ls-files' || sub === 'status') return { stdout: '' }
  return { stdout: '' }
}

describe('parsePorcelainStatus', () => {
  it('parses status entries and rename destinations', () => {
    expect(parsePorcelainStatus('## main\n M nodes/a.md\nA  nodes/b.md\nR  nodes/old.md -> nodes/new.md\n')).toEqual([
      { code: ' M', path: 'nodes/a.md' },
      { code: 'A ', path: 'nodes/b.md' },
      { code: 'R ', path: 'nodes/new.md' },
    ])
  })
})

describe('gitPreflight', () => {
  it('accepts a clean project-root repository', async () => {
    const { port } = scriptedGit(healthyResponder)
    await expect(gitPreflight(port, 'C:\\proj')).resolves.toEqual({ ok: true, branch: 'main', head: HEAD_SHA })
  })

  it('classifies detached, dirty, unmerged, missing, and mismatched states', async () => {
    const detached = scriptedGit((argv) => argv[1] === 'symbolic-ref' ? { exitCode: 1 } : healthyResponder(argv)).port
    await expect(gitPreflight(detached, 'C:\\proj')).resolves.toMatchObject({ ok: false, code: 'GIT_STATE_UNSUPPORTED' })

    const dirty = scriptedGit((argv) => argv[1] === 'status' ? { stdout: ' M nodes/a.md\n' } : healthyResponder(argv)).port
    await expect(gitPreflight(dirty, 'C:\\proj')).resolves.toMatchObject({ ok: false, code: 'READ_ONLY_CONFLICT' })

    const unmerged = scriptedGit((argv) => argv[1] === 'ls-files' ? { stdout: '100644 abc 1\tnodes/a.md\n' } : healthyResponder(argv)).port
    await expect(gitPreflight(unmerged, 'C:\\proj')).resolves.toMatchObject({ ok: false, code: 'GIT_STATE_UNSUPPORTED' })

    const missing = scriptedGit((argv) => argv[1] === 'rev-parse' && argv.includes('--show-toplevel') ? { exitCode: 128 } : healthyResponder(argv)).port
    await expect(gitPreflight(missing, 'C:\\proj')).resolves.toMatchObject({ ok: false, code: 'GIT_UNAVAILABLE' })

    const mismatch = scriptedGit((argv) => argv[1] === 'rev-parse' && argv.includes('--show-toplevel') ? { stdout: 'C:\\other\n' } : healthyResponder(argv)).port
    await expect(gitPreflight(mismatch, 'C:\\proj')).resolves.toMatchObject({ ok: false, code: 'PROJECT_REPOSITORY_MISMATCH' })
  })
})

describe('gitInitPreflight', () => {
  it('allows an attached unborn branch', async () => {
    const { port } = scriptedGit((argv) => {
      if (argv[1] === 'symbolic-ref') return { stdout: 'main\n' }
      if (argv[1] === 'rev-parse') return { exitCode: 128 }
      return { stdout: '' }
    })
    await expect(gitInitPreflight(port, 'C:\\proj')).resolves.toEqual({ ok: true, branch: 'main', head: undefined })
  })

  it('rejects detached HEAD before any write-related checks', async () => {
    const { port, calls } = scriptedGit((argv) => argv[1] === 'symbolic-ref' ? { exitCode: 1 } : { stdout: '' })
    await expect(gitInitPreflight(port, 'C:\\proj')).resolves.toMatchObject({ ok: false, code: 'GIT_STATE_UNSUPPORTED' })
    expect(calls).toHaveLength(1)
  })
})

describe('gitCheckpoint', () => {
  it('stages then commits only the supplied pathspecs', async () => {
    const { port, calls } = scriptedGit(healthyResponder)
    await expect(gitCheckpoint(port, 'C:\\proj', 'scifork: create_node node_1', ['nodes/node_1.md'])).resolves.toEqual({ ok: true, head: HEAD_SHA })
    expect(calls[0]).toEqual(['C:\\git\\git.exe', 'add', '--', 'nodes/node_1.md'])
    expect(calls[1]).toEqual(['C:\\git\\git.exe', 'commit', '--only', '-m', 'scifork: create_node node_1', '--', 'nodes/node_1.md'])
    expect(calls[2]).toEqual(['C:\\git\\git.exe', 'rev-parse', 'HEAD'])
  })

  it('reports a rejected commit', async () => {
    const { port } = scriptedGit((argv) => argv[1] === 'commit' ? { exitCode: 128 } : healthyResponder(argv))
    await expect(gitCheckpoint(port, 'C:\\proj', 'scifork: x', ['research.json'])).resolves.toEqual({ ok: false, code: 'CHECKPOINT_FAILED' })
  })

  it('marks a checkpoint committed when HEAD confirmation fails', async () => {
    let committed = false
    const { port } = scriptedGit((argv) => {
      if (argv[1] === 'commit') { committed = true; return { stdout: '' } }
      if (argv[1] === 'rev-parse' && committed) return { exitCode: 128 }
      return healthyResponder(argv)
    })
    await expect(gitCheckpoint(port, 'C:\\proj', 'scifork: x', ['research.json'])).resolves.toEqual({ ok: false, code: 'CHECKPOINT_FAILED', committed: true })
  })
})

describe('gitInit and identity', () => {
  it('runs git init and checks both identity fields', async () => {
    const { port, calls } = scriptedGit((argv) => {
      if (argv[1] === 'config') return { stdout: 'configured\n' }
      return { stdout: '' }
    })
    await expect(gitInit(port, 'C:\\proj')).resolves.toBe(true)
    await expect(gitIdentityConfigured(port, 'C:\\proj')).resolves.toBe(true)
    expect(calls[0]).toEqual(['C:\\git\\git.exe', 'init'])
  })

  it('reports missing identity', async () => {
    const { port } = scriptedGit((argv) => argv[1] === 'config' && argv.at(-1) === 'user.name' ? { stdout: 'Ada\n' } : { exitCode: 1 })
    await expect(gitIdentityConfigured(port, 'C:\\proj')).resolves.toBe(false)
  })
})

describe('checkpoint messages', () => {
  it('keeps subjects stable and content-free', () => {
    expect(checkpointMessage('create_node', 'node_abc')).toBe('scifork: create_node node_abc')
    expect(initCheckpointMessage()).toBe('scifork: init')
  })
})
