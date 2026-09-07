import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/verify-source-install.mjs', import.meta.url))

it.each([
  ['12.3.4', 0, 'nested pnpm version mismatch: expected 11.23.0, received 12.3.4'],
  ['ERR_PNPM_BAD_PM_VERSION', 1, 'could not verify nested pnpm'],
])('rejects an unusable nested pnpm (%s) before copying or installing Git source', (output, status, message) => {
  const tempBase = realpathSync(tmpdir())
  const root = mkdtempSync(join(tempBase, 'scifork-pnpm-preflight-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'scifork-preflight-consumer',
      packageManager: 'pnpm@11.23.0',
    }))
    const invocation = join(root, 'invocation.txt')
    const windows = process.platform === 'win32'
    writeFileSync(join(root, windows ? 'corepack.cmd' : 'corepack'), windows
      ? '@echo off\r\necho %* > invocation.txt\r\necho ' + output + '\r\nexit /b ' + status + '\r\n'
      : '#!/bin/sh\nprintf "%s\\n" "$*" > invocation.txt\nprintf "' + output + '\\n"\nexit ' + status + '\n',
    { mode: 0o755 })
    const env = { ...process.env }
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
    env[pathKey] = `${root}${windows ? ';' : ':'}${env[pathKey] ?? ''}`
    const result = spawnSync(process.execPath, [script], { cwd: root, env, encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
    expect(result.stderr).toContain('corepack enable pnpm')
    expect(result.stderr).not.toContain('git ls-files')
    expect(readFileSync(invocation, 'utf8').trim()).toBe('pnpm exec pnpm --version')
  } finally {
    const resolved = realpathSync(root)
    if (!resolved.startsWith(`${tempBase}${sep}`)) throw new Error('unexpected test directory')
    rmSync(resolved, { recursive: true, force: true })
  }
})
