import { describe, expect, it } from 'vitest'
import {
  GIT_GRACE_MS,
  buildGitArgv,
  gitShowToplevel,
  parseRevParseToplevel,
} from '../../src/host/git-checkpoints.js'
import type { SubprocessPort } from '../../src/host/contracts.js'

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

function fakeSubprocess(opts: { exitCode?: number; stdout?: string }): SubprocessPort {
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
              return { text: opts.stdout ?? '', nextOffset: 0, lossy: false }
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
