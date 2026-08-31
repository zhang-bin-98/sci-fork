import { spawnSync } from 'node:child_process'

const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'corepack'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'corepack pnpm pack --dry-run --json']
  : ['pnpm', 'pack', '--dry-run', '--json']
const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

if (result.error !== undefined || result.status !== 0) {
  process.stderr.write(result.stderr || result.error?.message || 'pack dry-run failed\n')
  process.exit(result.status ?? 1)
}

const marker = '{\n  "name":'
const start = result.stdout.indexOf(marker)
if (start < 0) {
  process.stderr.write('pack dry-run did not return JSON metadata\n')
  process.exit(1)
}

let metadata
try {
  metadata = JSON.parse(result.stdout.slice(start))
} catch {
  process.stderr.write('pack dry-run returned invalid JSON metadata\n')
  process.exit(1)
}

const files = new Set(metadata.files?.map((entry) => entry.path))
const required = [
  'dist/client.js',
  'dist/companion/index.html',
  'dist/host/index.js',
  'SECURITY.md',
  'docs/specs/m3-research.md',
  'docs/specs/research-questions-machine-review.md',
  'docs/specs/simulation-branches.md',
  'skills/pubmed-search/helper.mjs',
  'skills/pubmed-search/SKILL.md',
  'skills/scifork-research/SKILL.md',
]
const missing = required.filter((path) => !files.has(path))
if (missing.length > 0) {
  process.stderr.write(`pack is missing required files: ${missing.join(', ')}\n`)
  process.exit(1)
}

process.stdout.write(`pack verified: ${metadata.name}@${metadata.version} (${files.size} files)\n`)
