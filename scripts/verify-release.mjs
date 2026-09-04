import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tag = process.argv[2]
if (tag === undefined) fail('usage: node scripts/verify-release.mjs <version-tag>')

let manifest
try {
  manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
} catch {
  fail('package.json is missing or invalid')
}

if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
  fail('package name is missing')
}
if (typeof manifest.version !== 'string' || !isSemver(manifest.version)) {
  fail('package version must be valid SemVer')
}

const expectedTag = `v${manifest.version}`
if (tag !== expectedTag) {
  fail(`release tag ${tag} must exactly match package version ${expectedTag}`)
}

if (typeof manifest.license !== 'string'
  || manifest.license.trim().length === 0
  || manifest.license.trim().toUpperCase() === 'UNLICENSED') {
  fail('project license is not selected')
}

const licenseFiles = ['LICENSE', 'LICENSE.md', 'LICENSE.txt']
const licenseFile = licenseFiles.find((file) => {
  if (!existsSync(resolve(file))) return false
  return readFileSync(resolve(file), 'utf8').trim().length > 0
})
if (licenseFile === undefined) fail('license file is missing or empty')

for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  const dependencies = manifest[field]
  if (dependencies === undefined) continue
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    fail(`${field} must be an object`)
  }
  for (const [name, specifier] of Object.entries(dependencies)) {
    if (typeof specifier === 'string' && specifier.startsWith('workspace:')) {
      fail(`workspace dependency is not publishable: ${field}.${name}`)
    }
  }
}

process.stdout.write(`release preflight passed: ${manifest.name}@${manifest.version} (${licenseFile})\n`)

function isSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)
}

function fail(message) {
  process.stderr.write(`release preflight failed: ${message}\n`)
  process.exit(1)
}
