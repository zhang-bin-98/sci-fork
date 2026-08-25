import { describe, expect, it } from 'vitest'
import {
  GIT_GRACE_MS,
  backMessage,
  buildGitArgv,
  checkpointMessage,
  forwardMessage,
  gitCheckoutPath,
  gitCheckpoint,
  gitCleanPath,
  gitIdentityConfigured,
  gitInit,
  gitInitPreflight,
  gitListManagedFiles,
  gitPreflight,
  gitRemovePath,
  gitRestoreManagedFrom,
  gitShowToplevel,
  initCheckpointMessage,
  managedCheckpointPaths,
  parsePorcelainStatus,
  parseRevParseToplevel,
} from '../../src/host/git-checkpoints.js'
import type { SubprocessPort } from '../../src/host/contracts.js'
import { MANAGED_PATHS } from '../../src/core/schema.js'

describe('buildGitArgv', () => {
  it('returns an argv-only spec with the program first', () => {
    const spec = buildGitArgv('git', ['rev-parse', '--show-toplevel'], 'C:\\proj')
    expect(spec.argv).toEqual(['git', 'rev-parse', '--show-toplevel'])
    expect(spec.cwd).toBe('C:\\proj')
  })

  it('rejects an empty executable', () => {
    expect(() => buildGitArgv('', [], '.')).toThrow()
  })

  it('rejects arguments containing NUL bytes', () => {
    expect(() => buildGitArgv('git', ['log', '-n\x001'], '.')).toThrow()
  })

  it('rejects an empty cwd', () => {
    expect(() => buildGitArgv('git', ['rev-parse'], '')).toThrow()
  })
})

describe('parseRevParseToplevel', () => {
  it('returns Windows and POSIX absolute paths', () => {
    expect(parseRevParseToplevel('C:\\proj\n')).toBe('C:\\proj')
    expect(parseRevParseToplevel('/srv/research\n')).toBe('/srv/research')
  })

  it('returns undefined for a relative path', () => {
    expect(parseRevParseToplevel('research-project\n')).toBeUndefined()
  })

  it('returns undefined for empty output', () => {
    expect(parseRevParseToplevel('')).toBeUndefined()
    expect(parseRevParseToplevel('  \n')).toBeUndefined()
  })

  it('returns undefined when more than one path is printed', () => {
    expect(parseRevParseToplevel('C:\\a\nC:\\b\n')).toBeUndefined()
  })
})

function fakeSubprocess(opts: { exitCode?: number; stdout?: string; lossy?: boolean }): SubprocessPort {
  return {
    async resolveExecutable(command: string) {
      return command === 'git' ? 'C:\\git\\git.exe' : command
    },
    spawn(spec) {
      return {
        pid: 1,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: {
            readFrom() {
              return { text: opts.stdout ?? '', nextOffset: 0, lossy: opts.lossy === true }
            },
          },
        },
        done: Promise.resolve({
          exitCode: opts.exitCode ?? 0,
          signal: null,
        }),
        terminate() {},
        async waitForExit() {
          return true
        },
      }
    },
  }
}

describe('gitShowToplevel', () => {
  it('runs git rev-parse --show-toplevel with argv-only spec', async () => {
    let seenArgv: readonly string[] = []
    const subprocess = fakeSubprocess({ stdout: 'C:\\proj\n' })
    const spawn = subprocess.spawn.bind(subprocess)
    subprocess.spawn = (spec) => {
      seenArgv = spec.argv
      return spawn(spec)
    }
    const result = await gitShowToplevel(subprocess, 'C:\\proj')
    expect(seenArgv).toEqual(['C:\\git\\git.exe', 'rev-parse', '--show-toplevel'])
    expect(result).toBe('C:\\proj')
  })

  it('returns undefined on non-zero exit', async () => {
    const result = await gitShowToplevel(
      fakeSubprocess({ exitCode: 128, stdout: 'fatal: not a repository\n' }),
      '.',
    )
    expect(result).toBeUndefined()
  })

  it('returns undefined for ambiguous multi-line output', async () => {
    const result = await gitShowToplevel(
      fakeSubprocess({ stdout: 'C:\\a\nC:\\b\n' }),
      '.',
    )
    expect(result).toBeUndefined()
  })

  it('fails closed when Git output is truncated by the subprocess collector', async () => {
    const result = await gitShowToplevel(
      fakeSubprocess({ stdout: 'C:\\proj\n', lossy: true }),
      'C:\\proj',
    )
    expect(result).toBeUndefined()
  })

  it('uses a bounded grace period', async () => {
    let seenGraceMs = 0
    const subprocess = fakeSubprocess({ stdout: 'C:\\proj\n' })
    const spawn = subprocess.spawn.bind(subprocess)
    subprocess.spawn = (spec) => {
      seenGraceMs = spec.graceMs
      return spawn(spec)
    }
    await gitShowToplevel(subprocess, 'C:\\proj')
    expect(seenGraceMs).toBe(GIT_GRACE_MS)
  })
})

function scriptedGit(
  responder: (argv: readonly string[]) => { exitCode?: number; stdout?: string },
): { port: SubprocessPort; calls: string[][] } {
  const calls: string[][] = []
  const port: SubprocessPort = {
    async resolveExecutable() {
      return 'C:\\git\\git.exe'
    },
    spawn(spec) {
      calls.push([...spec.argv])
      const response = responder(spec.argv)
      return {
        pid: 1,
        collected: {
          stdout: {
            readFrom() {
              return { text: response.stdout ?? '', nextOffset: 0, lossy: false }
            },
          },
          stderr: {
            readFrom() {
              return { text: '', nextOffset: 0, lossy: false }
            },
          },
        },
        done: Promise.resolve({ exitCode: response.exitCode ?? 0, signal: null }),
        terminate() {},
        async waitForExit() {
          return true
        },
      }
    },
  }
  return { port, calls }
}

const HEAD_SHA = 'abcdef1234567890abcdef1234567890abcdef12'

function healthyResponder(argv: readonly string[]): { exitCode?: number; stdout?: string } {
  const sub = argv[1]
  if (sub === 'symbolic-ref') return { stdout: 'main\n' }
  if (sub === 'rev-parse' && argv.includes('--show-toplevel')) return { stdout: 'C:\\proj\n' }
  if (sub === 'rev-parse') return { stdout: `${HEAD_SHA}\n` }
  if (sub === 'ls-files') return { stdout: '' }
  if (sub === 'status') return { stdout: '' }
  return { stdout: '' }
}

describe('parsePorcelainStatus', () => {
  it('parses status lines and renames, skipping headers', () => {
    const parsed = parsePorcelainStatus('## main\n M nodes/a.md\nA  nodes/b.md\nR  nodes/old.md -> nodes/new.md\n')
    expect(parsed).toEqual([
      { code: ' M', path: 'nodes/a.md' },
      { code: 'A ', path: 'nodes/b.md' },
      { code: 'R ', path: 'nodes/new.md' },
    ])
  })

  it('returns an empty list for clean output', () => {
    expect(parsePorcelainStatus('')).toEqual([])
  })
})

describe('gitPreflight', () => {
  it('passes a clean on-branch repository and returns branch and HEAD', async () => {
    const { port } = scriptedGit(healthyResponder)
    const result = await gitPreflight(port, 'C:\\proj')
    expect(result).toEqual({ ok: true, branch: 'main', head: HEAD_SHA })
  })

  it('reports a detached HEAD as GIT_STATE_UNSUPPORTED', async () => {
    const { port } = scriptedGit((argv) =>
      argv[1] === 'symbolic-ref' ? { exitCode: 1, stdout: '' } : healthyResponder(argv),
    )
    const result = await gitPreflight(port, 'C:\\proj')
    expect(result).toEqual({ ok: false, code: 'GIT_STATE_UNSUPPORTED', reason: 'HEAD is detached or unborn' })
  })

  it('reports dirty managed paths as READ_ONLY_CONFLICT', async () => {
    const { port } = scriptedGit((argv) =>
      argv[1] === 'status' ? { stdout: ' M nodes/a.md\n' } : healthyResponder(argv),
    )
    const result = await gitPreflight(port, 'C:\\proj')
    expect(result).toEqual({ ok: false, code: 'READ_ONLY_CONFLICT', reason: 'managed paths have uncommitted changes' })
  })

  it('reports unmerged entries as GIT_STATE_UNSUPPORTED', async () => {
    const { port, calls } = scriptedGit((argv) =>
      argv[1] === 'ls-files' ? { stdout: '100644 abc 1\tnodes/a.md\n' } : healthyResponder(argv),
    )
    const result = await gitPreflight(port, 'C:\\proj')
    expect(result).toEqual({ ok: false, code: 'GIT_STATE_UNSUPPORTED', reason: 'the repository has unmerged entries' })
    expect(calls.find((call) => call[1] === 'ls-files')).toEqual([
      'C:\\git\\git.exe', 'ls-files', '-u',
    ])
  })

  it('reports a directory outside a Git repository as GIT_UNAVAILABLE', async () => {
    const { port, calls } = scriptedGit((argv) => {
      if (argv[1] === 'rev-parse' && argv.includes('--show-toplevel')) {
        return { exitCode: 128, stdout: '' }
      }
      return healthyResponder(argv)
    })
    const result = await gitPreflight(port, 'C:\\proj')
    expect(result).toEqual({ ok: false, code: 'GIT_UNAVAILABLE', reason: 'the project is not in a git repository' })
    expect(calls.some((call) => call[1] === 'symbolic-ref')).toBe(false)
  })

  it('fails closed when the repository root output is ambiguous', async () => {
    const { port, calls } = scriptedGit((argv) => {
      if (argv[1] === 'rev-parse' && argv.includes('--show-toplevel')) {
        return { stdout: 'C:\\proj\nC:\\other\n' }
      }
      return healthyResponder(argv)
    })
    const result = await gitPreflight(port, 'C:\\proj')
    expect(result).toEqual({
      ok: false,
      code: 'GIT_UNAVAILABLE',
      reason: 'the project repository root could not be determined',
    })
    expect(calls.some((call) => call[1] === 'symbolic-ref')).toBe(false)
  })

  it('rejects a repository whose top level differs from the project root', async () => {
    const { port, calls } = scriptedGit((argv) => {
      if (argv[1] === 'rev-parse' && argv.includes('--show-toplevel')) return { stdout: 'C:\\other\n' }
      return healthyResponder(argv)
    })
    const result = await gitPreflight(port, 'C:\\proj')
    expect(result).toEqual({
      ok: false,
      code: 'PROJECT_REPOSITORY_MISMATCH',
      reason: 'the research project lies inside an unrelated git repository',
    })
    expect(calls.some((call) => call[1] === 'symbolic-ref')).toBe(false)
  })

  it('reports GIT_UNAVAILABLE when git cannot run', async () => {
    const port: SubprocessPort = {
      async resolveExecutable() {
        throw new Error('no git')
      },
      spawn() {
        throw new Error('unreachable')
      },
    }
    const result = await gitPreflight(port, 'C:\\proj')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('GIT_UNAVAILABLE')
  })
})

describe('gitInitPreflight', () => {
  it('allows an attached unborn branch with clean managed paths', async () => {
    const { port } = scriptedGit((argv) => {
      if (argv[1] === 'symbolic-ref') return { stdout: 'main\n' }
      if (argv[1] === 'rev-parse') return { exitCode: 128, stdout: '' }
      if (argv[1] === 'ls-files') return { stdout: '' }
      if (argv[1] === 'status') return { stdout: '' }
      return { stdout: '' }
    })
    const result = await gitInitPreflight(port, 'C:\\proj')
    expect(result).toEqual({ ok: true, branch: 'main', head: undefined })
  })

  it('rejects detached HEAD before checking managed paths', async () => {
    const { port, calls } = scriptedGit((argv) =>
      argv[1] === 'symbolic-ref' ? { exitCode: 1, stdout: '' } : { stdout: '' },
    )
    const result = await gitInitPreflight(port, 'C:\\proj')
    expect(result).toEqual({ ok: false, code: 'GIT_STATE_UNSUPPORTED', reason: 'HEAD is detached or unborn' })
    expect(calls).toHaveLength(1)
  })
})

describe('gitCheckpoint', () => {
  it('stages then commits only the managed paths and returns the new HEAD', async () => {
    const { port, calls } = scriptedGit(healthyResponder)
    const result = await gitCheckpoint(port, 'C:\\proj', 'scifork: create_node node_1', ['research.json', 'nodes'])
    expect(result).toEqual({ ok: true, head: HEAD_SHA })
    expect(calls[0]).toEqual(['C:\\git\\git.exe', 'add', '--', 'research.json', 'nodes'])
    expect(calls[1]).toEqual([
      'C:\\git\\git.exe',
      'commit',
      '--only',
      '-m',
      'scifork: create_node node_1',
      '--',
      'research.json',
      'nodes',
    ])
    expect(calls[2]).toEqual(['C:\\git\\git.exe', 'rev-parse', 'HEAD'])
  })

  it('fails with CHECKPOINT_FAILED when the commit is rejected', async () => {
    const { port } = scriptedGit((argv) =>
      argv[1] === 'commit' ? { exitCode: 128, stdout: '' } : healthyResponder(argv),
    )
    const result = await gitCheckpoint(port, 'C:\\proj', 'scifork: x', ['research.json'])
    expect(result).toEqual({ ok: false, code: 'CHECKPOINT_FAILED' })
  })

  it('marks a checkpoint committed when reading the new HEAD fails', async () => {
    let committed = false
    const { port } = scriptedGit((argv) => {
      if (argv[1] === 'commit') {
        committed = true
        return { stdout: '' }
      }
      if (argv[1] === 'rev-parse' && committed) return { exitCode: 128, stdout: '' }
      return healthyResponder(argv)
    })
    const result = await gitCheckpoint(port, 'C:\\proj', 'scifork: x', ['research.json'])
    expect(result).toEqual({ ok: false, code: 'CHECKPOINT_FAILED', committed: true })
  })

})

describe('managedCheckpointPaths', () => {
  it('names only the manifest and non-empty managed directories', () => {
    expect(managedCheckpointPaths(new Map([
      ['research.json', '{}'],
      ['nodes/a.md', 'x'],
    ]))).toEqual(['research.json', 'nodes'])
    expect(managedCheckpointPaths(new Map([['research.json', '{}']]))).toEqual(['research.json'])
    expect(managedCheckpointPaths(new Map())).toEqual([])
  })
})

describe('gitListManagedFiles and gitRestoreManagedFrom', () => {
  it('lists managed files per directory from a commit', async () => {
    const { port, calls } = scriptedGit((argv) => {
      if (argv[1] === 'ls-tree') {
        const path = argv[argv.length - 1]
        if (path === 'research.json') return { stdout: 'research.json\n' }
        if (path === 'nodes') return { stdout: 'nodes/a.md\nnodes/b.md\n' }
        return { stdout: '' }
      }
      return { stdout: '' }
    })
    const files = await gitListManagedFiles(port, 'C:\\proj', HEAD_SHA)
    expect(files).toEqual(['research.json', 'nodes/a.md', 'nodes/b.md'])
    expect(calls.filter((call) => call[1] === 'ls-tree')).toHaveLength(MANAGED_PATHS.length)
  })

  it('restores source paths with checkout and removes extra files with git rm', async () => {
    const { port, calls } = scriptedGit(() => ({ stdout: '' }))
    await expect(gitRestoreManagedFrom(
      port,
      'C:\\proj',
      HEAD_SHA,
      ['research.json', 'nodes/a.md'],
      ['nodes/removed.md'],
    )).resolves.toBe(true)
    expect(calls[0]).toEqual([
      'C:\\git\\git.exe', 'checkout', HEAD_SHA, '--', 'research.json', 'nodes/a.md',
    ])
    expect(calls[1]).toEqual(['C:\\git\\git.exe', 'rm', '-f', '-q', '--', 'nodes/removed.md'])
    expect(calls[2]).toEqual(['C:\\git\\git.exe', 'restore', '--staged', '--', 'nodes/removed.md'])
  })
})

describe('restore and compensation ops', () => {
  it('checkouts and cleans exact single paths for compensation', async () => {
    const { port, calls } = scriptedGit(healthyResponder)
    await expect(gitCheckoutPath(port, 'C:\\proj', 'nodes/node_1.md')).resolves.toBe(true)
    await expect(gitCleanPath(port, 'C:\\proj', 'nodes/node_2.md')).resolves.toBe(true)
    await expect(gitRemovePath(port, 'C:\\proj', 'nodes/node_3.md')).resolves.toBe(true)
    expect(calls[0]).toEqual(['C:\\git\\git.exe', 'checkout', 'HEAD', '--', 'nodes/node_1.md'])
    expect(calls[1]).toEqual(['C:\\git\\git.exe', 'clean', '-f', '--', 'nodes/node_2.md'])
    expect(calls[2]).toEqual(['C:\\git\\git.exe', 'rm', '-f', '-q', '--', 'nodes/node_3.md'])
  })
})

describe('gitInit and gitIdentityConfigured', () => {
  it('runs a plain git init', async () => {
    const { port, calls } = scriptedGit(() => ({ stdout: 'Initialized empty Git repository\n' }))
    await expect(gitInit(port, 'C:\\proj')).resolves.toBe(true)
    expect(calls[0]).toEqual(['C:\\git\\git.exe', 'init'])
  })

  it('checks identity from repo or global config', async () => {
    const { port } = scriptedGit((argv) => {
      const key = argv[argv.length - 1]
      if (key === 'user.name') return { stdout: 'Ada\n' }
      if (key === 'user.email') return { stdout: 'ada@example.com\n' }
      return { exitCode: 1 }
    })
    await expect(gitIdentityConfigured(port, 'C:\\proj')).resolves.toBe(true)
  })

  it('reports missing identity', async () => {
    const { port } = scriptedGit((argv) => {
      const key = argv[argv.length - 1]
      if (key === 'user.name') return { stdout: 'Ada\n' }
      return { exitCode: 1 }
    })
    await expect(gitIdentityConfigured(port, 'C:\\proj')).resolves.toBe(false)
  })
})

describe('checkpoint messages', () => {
  it('builds stable subjects without research content', () => {
    expect(checkpointMessage('create_node', 'node_abc')).toBe('scifork: create_node node_abc')
    expect(initCheckpointMessage()).toBe('scifork: init')
    expect(backMessage(HEAD_SHA)).toBe('scifork: back to abcdef123456')
    expect(forwardMessage(HEAD_SHA)).toBe('scifork: forward to abcdef123456')
  })
})
