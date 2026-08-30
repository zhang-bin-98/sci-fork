import { describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  gitCheckpoint,
  gitCheckpointManagedDeletion,
  gitInit,
  gitPreflight,
  gitRemoveManagedPath,
  initCheckpointMessage,
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
    async resolveExecutable() { return 'git' },
    spawn(spec) {
      const child = spawn(spec.argv[0]!, spec.argv.slice(1), {
        cwd: spec.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer | string) => { stdout += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString() })
      const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
        child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
      })
      return {
        pid: child.pid ?? 0,
        collected: {
          stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) },
        },
        done,
        terminate() { child.kill() },
        async waitForExit() { await done; return true },
      }
    },
  }
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
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
    await expect(gitPreflight(realGitPort(), root)).resolves.toMatchObject({
      ok: false,
      code: 'GIT_UNAVAILABLE',
    })
  })

  it('rejects unmerged entries even when they are outside managed paths', async () => {
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
    try { execFileSync('git', ['merge', 'conflicting-change'], { cwd: root, stdio: 'ignore' }) } catch { /* expected conflict */ }
    await expect(gitPreflight(port, root)).resolves.toMatchObject({
      ok: false,
      code: 'GIT_STATE_UNSUPPORTED',
    })
  })

  it('checkpoints the init marker and leaves unrelated staged files alone', async () => {
    const root = makeRepo()
    const port = realGitPort()
    writeFileSync(join(root, 'research.json'), '{"schema_version":1,"project_id":"a","name":"x"}\n')
    writeFileSync(join(root, 'unrelated.txt'), 'staged elsewhere\n')
    git(['add', 'unrelated.txt'], root)

    await expect(gitInit(port, root)).resolves.toBe(true)
    const checkpoint = await gitCheckpoint(port, root, initCheckpointMessage(), ['research.json'])
    expect(checkpoint.ok).toBe(true)
    await expect(gitPreflight(port, root)).resolves.toMatchObject({ ok: true })
    expect(git(['log', '-1', '--format=%s'], root)).toBe(initCheckpointMessage())
    expect(git(['status', '--porcelain'], root).split('\n').filter(Boolean)).toEqual(['A  unrelated.txt'])
  })

  it('can checkpoint one later managed file without touching unrelated staged work', async () => {
    const root = makeRepo()
    const port = realGitPort()
    writeFileSync(join(root, 'research.json'), '{"schema_version":1,"project_id":"a","name":"x"}\n')
    await gitCheckpoint(port, root, initCheckpointMessage(), ['research.json'])
    writeFileSync(join(root, 'nodes', 'node_a.md'), 'node\n')
    writeFileSync(join(root, 'unrelated.txt'), 'staged\n')
    git(['add', 'unrelated.txt'], root)
    const checkpoint = await gitCheckpoint(port, root, 'scifork: create_node node_a', ['nodes/node_a.md'])
    expect(checkpoint.ok).toBe(true)
    expect(git(['status', '--porcelain'], root)).toBe('A  unrelated.txt')
  })

  it('checkpoints a managed deletion without touching unrelated staged work', async () => {
    const root = makeRepo()
    const port = realGitPort()
    const edgePath = 'edges/edge_aaaaaaaa-1111-4111-8111-111111111111.json'
    mkdirSync(join(root, 'edges'))
    writeFileSync(join(root, 'research.json'), '{"schema_version":1,"project_id":"a","name":"x"}\n')
    await gitCheckpoint(port, root, initCheckpointMessage(), ['research.json'])
    writeFileSync(join(root, edgePath), '{}\n')
    await gitCheckpoint(port, root, 'scifork: create_edge edge_a', [edgePath])
    writeFileSync(join(root, 'unrelated.txt'), 'staged\n')
    git(['add', 'unrelated.txt'], root)

    await expect(gitRemoveManagedPath(port, root, edgePath)).resolves.toBe(true)
    expect(existsSync(join(root, edgePath))).toBe(false)
    await expect(gitCheckpointManagedDeletion(port, root, 'scifork: delete_edge edge_a', edgePath)).resolves.toMatchObject({ ok: true })
    expect(git(['show', '--format=', '--name-status', 'HEAD'], root)).toBe(`D\t${edgePath}`)
    expect(git(['status', '--porcelain'], root)).toBe('A  unrelated.txt')
  })
})
