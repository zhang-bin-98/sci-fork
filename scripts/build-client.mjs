import { buildSync } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'

/**
 * Build the browser client bundle in the exact shape the DSH client module
 * system consumes (pinned from @deepseek-ai/dsh-client-modules, DSH
 * 0.1.1-rc.2): a classic script registering a CJS factory that receives the
 * synchronous `require` bound to the boot graph. React and Cordis are
 * shell-seeded baseline modules, so they stay external.
 *
 * buildSync keeps the bundle assembly synchronous; on Windows esbuild still
 * runs its native binary as a child process, so confined sandboxes that deny
 * piped spawns must run this build with wider permissions.
 */
const result = buildSync({
  entryPoints: ['src/bridge/client.tsx'],
  outfile: 'dist/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react', '@deepseek-ai/cordis'],
  sourcemap: 'external',
  write: false,
})

const code = result.outputFiles.find((file) => file.path.endsWith('client.js'))
const map = result.outputFiles.find((file) => file.path.endsWith('client.js.map'))
if (code === undefined) throw new Error('scifork: client build produced no bundle')

const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: "dsh-scifork",',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  code.text,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')

mkdirSync('dist', { recursive: true })
writeFileSync('dist/client.js', wrapped)
if (map !== undefined) writeFileSync('dist/client.js.map', map.text)
console.log(`scifork: built dist/client.js (${Buffer.byteLength(wrapped)} bytes)`)
