import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const projectRoot = process.cwd()
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const tempBase = realpathSync(tmpdir())
const root = mkdtempSync(join(tempBase, 'scifork-source-install-'))
const sourceRoot = join(root, 'source')
const consumerRoot = join(root, 'consumer')

try {
  copySourceCheckout(sourceRoot)
  initializeRepository(sourceRoot)
  initializeConsumer(consumerRoot)

  const sourceSpec = `git+${pathToFileURL(sourceRoot).href}`
  runCorepack(['pnpm', 'add', '--save-exact', sourceSpec], consumerRoot)
  rmSync(sourceRoot, { recursive: true, force: true })

  const installedRoot = join(consumerRoot, 'node_modules', manifest.name)
  const required = [
    'dist/host/index.js',
    'dist/client.js',
    'dist/companion/index.html',
    'dist/companion/app.js',
    'dist/companion/styles.css',
    'skills/pubmed-search/helper.mjs',
    'skills/pubmed-search/SKILL.md',
    'skills/scifork-research/SKILL.md',
  ]
  const missing = required.filter((path) => !existsSync(join(installedRoot, path)))
  if (missing.length > 0) {
    fail(`installed Git dependency is missing required files: ${missing.join(', ')}`)
  }

  const installedManifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  if (installedManifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
    fail('installed Git dependency does not preserve package.json#dsh.bundle.patch')
  }

  const entry = await import(pathToFileURL(join(installedRoot, 'index.js')).href)
  if (typeof entry.apply !== 'function') {
    fail('installed Git dependency does not export apply(ctx)')
  }

  process.stdout.write(`source install verified: ${installedManifest.name}@${installedManifest.version}\n`)
} finally {
  const resolvedRoot = realpathSync(root)
  const allowedPrefix = tempBase.endsWith(sep) ? tempBase : `${tempBase}${sep}`
  if (!resolvedRoot.startsWith(allowedPrefix)) {
    fail(`refusing to remove unexpected verification directory: ${resolvedRoot}`)
  }
  rmSync(resolvedRoot, { recursive: true, force: true })
}

function copySourceCheckout(destination) {
  mkdirSync(destination, { recursive: true })
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: projectRoot, encoding: 'utf8' },
  )
  const files = output.split('\0').filter(Boolean)
  if (files.length === 0) fail('Git source file list is empty')
  if (files.some((path) => path === 'dist' || path.startsWith('dist/'))) {
    fail('dist must remain excluded from the Git source checkout')
  }

  for (const path of files) {
    const source = join(projectRoot, path)
    if (!existsSync(source)) continue
    const target = join(destination, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
}

function initializeRepository(directory) {
  run('git', ['init', '--initial-branch=main'], directory)
  run('git', ['config', 'user.name', 'SciFork Source Install Verifier'], directory)
  run('git', ['config', 'user.email', 'source-install@example.invalid'], directory)
  run('git', ['add', '--all'], directory)
  run('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'verify source install'], directory)
}

function initializeConsumer(directory) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
    name: 'scifork-source-install-consumer',
    private: true,
    packageManager: manifest.packageManager,
  }, null, 2)}\n`)
  writeFileSync(join(directory, 'pnpm-workspace.yaml'), 'dangerouslyAllowAllBuilds: true\n')
}

function runCorepack(args, cwd) {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'corepack'
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', windowsCorepackCommand(args)]
    : args
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5 * 60 * 1000,
  })
  if (result.error !== undefined || result.status !== 0) {
    const detail = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n')
    fail(`Git dependency installation failed${detail ? `:\n${detail}` : ''}`)
  }
}

function windowsCorepackCommand(args) {
  const values = ['corepack', ...args]
  if (values.some((value) => !/^[A-Za-z0-9_@%+.:/=\-]+$/.test(value))) {
    fail('unsafe argument in Windows Corepack invocation')
  }
  return values.join(' ')
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'ignore' })
}

function fail(message) {
  throw new Error(`source install verification failed: ${message}`)
}
