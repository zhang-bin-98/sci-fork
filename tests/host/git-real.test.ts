import { describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backMessage,
  gitCheckpoint,
  gitInit,
  gitListManagedFiles,
  gitPreflight,
  gitRestoreManagedFrom,
  initCheckpointMessage,
  managedCheckpointPaths,
} from '../../src/host/git-checkpoints.js'
import type { SubprocessPort } from '../../src/host/contracts.js'

const gitAvailable = ((): boolean => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** A real-git adapter over the pinned SubprocessPort shape. */
function realGitPort(): SubprocessPort {
  return {
    async resolveExecutable() {
      return 'git'
    },
    spawn(spec) {
      const child = spawn(spec.argv[0]!, spec.argv.slice(1), {
        cwd: spec.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString()
      })
      const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
        child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
      })
      return {
        pid: child.pid ?? 0,
        collected: {
          stdout: {
            readFrom() {
              return { text: stdout, nextOffset: stdout.length, lossy: false }
            },
          },
          stderr: {
            readFrom() {
              return { text: stderr, nextOffset: stderr.length, lossy: false }
            },
          },
        },
        done,
        terminate() {
          child.kill()
        },
        async waitForExit() {
          await done
          return true
        },
      }
    },
  }
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function nodeBExists(root: string): boolean {
  return existsSync(join(root, 'nodes', 'node_b.md'))
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'scifork-git-real-'))
  git(['init', '-q'], root)
  git(['config', 'user.name', 'Test User'], root)
  git(['config', 'user.email', 'test@example.com'], root)
  mkdirSync(join(root, 'nodes'))
  return root
}

describe.skipIf(!gitAvailable)('real git integration', () => {
  it('reports GIT_UNAVAILABLE outside a repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scifork-git-none-'))
    const result = await gitPreflight(realGitPort(), root)
    expect(result).toEqual({
      ok: false,
      code: 'GIT_UNAVAILABLE',
      reason: 'the project is not in a git repository',
    })
  })

  it('rejects unmerged entries outside managed paths', async () => {
    const root = makeRepo()
    const port = realGitPort()
    writeFileSync(join(root, 'research.json'), '{"schema_version":1,"project_id":"a","name":"x"}\n')
    await gitCheckpoint(port, root, initCheckpointMessage(), ['research.json'])
    writeFileSync(join(root, 'other.txt'), 'base\n')
    git(['add', 'other.txt'], root)
    git(['commit', '-q', '-m', 'base unrelated file'], root)
    const originalBranch = git(['branch', '--show-current'], root)

    git(['checkout', '-q', '-b', 'conflicting-change'], root)
    writeFileSync(join(root, 'other.txt'), 'branch\n')
    git(['commit', '-q', '-am', 'branch change'], root)
    git(['checkout', '-q', originalBranch], root)
    writeFileSync(join(root, 'other.txt'), 'current\n')
    git(['commit', '-q', '-am', 'current change'], root)
    try {
      execFileSync('git', ['merge', 'conflicting-change'], { cwd: root, stdio: 'ignore' })
    } catch {
      // The conflict is the state under test.
    }

    expect(git(['ls-files', '-u'], root)).toContain('other.txt')
    await expect(gitPreflight(port, root)).resolves.toEqual({
      ok: false,
      code: 'GIT_STATE_UNSUPPORTED',
      reason: 'the repository has unmerged entries',
    })
  })

  it('checkpoints untracked managed files and leaves unrelated staged files alone', async () => {
    const root = makeRepo()
    const port = realGitPort()
    writeFileSync(join(root, 'research.json'), '{"schema_version":1,"project_id":"a","name":"x"}\n')
    writeFileSync(join(root, 'nodes', 'node_a.md'), '---\nid: node_a\nkind: hypothesis\nconfidence: low\n---\nbody\n')
    // an unrelated staged file must survive the checkpoint untouched
    writeFileSync(join(root, 'unrelated.txt'), 'staged elsewhere\n')
    git(['add', 'unrelated.txt'], root)

    await expect(gitInit(port, root)).resolves.toBe(true)
    const checkpoint = await gitCheckpoint(port, root, initCheckpointMessage(), ['research.json', 'nodes'])
    expect(checkpoint.ok).toBe(true)

    const preflight = await gitPreflight(port, root)
    expect(preflight.ok).toBe(true)
    expect(git(['log', '-1', '--format=%s'], root)).toBe(initCheckpointMessage())
    const status = git(['status', '--porcelain'], root)
    expect(status.split('\n').filter((line) => line.length > 0)).toEqual(['A  unrelated.txt'])
  })

  it('restores one step back and forward with restore commits', async () => {
    const root = makeRepo()
    const port = realGitPort()
    const nodePath = join(root, 'nodes', 'node_a.md')
    writeFileSync(join(root, 'research.json'), '{"schema_version":1,"project_id":"a","name":"x"}\n')
    writeFileSync(nodePath, '---\nid: node_a\nkind: hypothesis\nconfidence: low\n---\n# Old\n\nBody.\n')

    const first = await gitCheckpoint(port, root, initCheckpointMessage(), ['research.json', 'nodes'])
    expect(first.ok).toBe(true)
    const firstHead = first.ok ? first.head : ''
    writeFileSync(nodePath, '---\nid: node_a\nkind: hypothesis\nconfidence: low\n---\n# New\n\nBody.\n')
    const second = await gitCheckpoint(port, root, 'scifork: update_node node_a', ['research.json', 'nodes'])
    expect(second.ok).toBe(true)
    const secondHead = second.ok ? second.head : ''
    expect(readFileSync(nodePath, 'utf8')).toContain('# New')

    // Back: restore the first checkpoint's managed tree and commit a restore commit.
    const sourcePaths = await gitListManagedFiles(port, root, firstHead)
    expect(sourcePaths).toEqual(['research.json', 'nodes/node_a.md'])
    await expect(gitRestoreManagedFrom(port, root, firstHead, sourcePaths ?? [], [])).resolves.toBe(true)
    const back = await gitCheckpoint(port, root, backMessage(secondHead), managedCheckpointPaths(new Map([
      ['research.json', '{}'],
      ['nodes/node_a.md', 'x'],
    ])))
    expect(back.ok).toBe(true)
    expect(readFileSync(nodePath, 'utf8')).toContain('# Old')
    expect(git(['log', '-1', '--format=%s'], root)).toBe(backMessage(secondHead))

    // Forward: restore the undone checkpoint and commit again.
    await expect(gitRestoreManagedFrom(port, root, secondHead, ['research.json', 'nodes/node_a.md'], [])).resolves.toBe(true)
    const forward = await gitCheckpoint(port, root, `scifork: forward to ${secondHead.slice(0, 12)}`, ['research.json', 'nodes'])
    expect(forward.ok).toBe(true)
    expect(readFileSync(nodePath, 'utf8')).toContain('# New')

    // History grew by restore commits only; nothing was reset or rewritten.
    expect(git(['rev-list', '--count', 'HEAD'], root)).toBe('4')
    expect(git(['log', '--format=%s'], root)).toContain('scifork: update_node node_a')
    expect(git(['log', '--format=%s'], root)).toContain(initCheckpointMessage())
  })

  it('removes managed files that a restored-away checkpoint had added', async () => {
    const root = makeRepo()
    const port = realGitPort()
    const nodeB = join(root, 'nodes', 'node_b.md')
    writeFileSync(join(root, 'research.json'), '{"schema_version":1,"project_id":"a","name":"x"}\n')
    writeFileSync(join(root, 'nodes', 'node_a.md'), '---\nid: node_a\nkind: hypothesis\nconfidence: low\n---\n# A\n\nBody.\n')

    const first = await gitCheckpoint(port, root, initCheckpointMessage(), ['research.json', 'nodes'])
    expect(first.ok).toBe(true)
    const firstHead = first.ok ? first.head : ''
    writeFileSync(nodeB, '---\nid: node_b\nkind: hypothesis\nconfidence: low\n---\n# B\n\nBody.\n')
    const second = await gitCheckpoint(port, root, 'scifork: create_node node_b', ['research.json', 'nodes'])
    expect(second.ok).toBe(true)
    const secondHead = second.ok ? second.head : ''

    // Back restores the first checkpoint: node_b must disappear from the tree.
    const sourcePaths = await gitListManagedFiles(port, root, firstHead)
    const removePaths = ['research.json', 'nodes/node_a.md', 'nodes/node_b.md'].filter(
      (path) => !(sourcePaths ?? []).includes(path),
    )
    await expect(gitRestoreManagedFrom(port, root, firstHead, sourcePaths ?? [], removePaths)).resolves.toBe(true)
    const back = await gitCheckpoint(port, root, backMessage(secondHead), ['research.json', 'nodes'])
    expect(back.ok).toBe(true)
    expect(readFileSync(join(root, 'nodes', 'node_a.md'), 'utf8')).toContain('# A')
    expect(nodeBExists(root)).toBe(false)
    expect(git(['status', '--porcelain'], root)).toBe('')
  })
})
