import { buildSync } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'

const outputDirectory = 'dist/companion'

mkdirSync(outputDirectory, { recursive: true })

buildSync({
  entryPoints: ['src/companion/index.tsx'],
  outfile: outputDirectory + '/app.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
})

const html = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1">',
  '  <meta name="color-scheme" content="light">',
  '  <title>SciFork Research Graph</title>',
  '  <link rel="stylesheet" href="/scifork/styles.css">',
  '</head>',
  '<body>',
  '  <div id="root"></div>',
  '  <script type="module" src="/scifork/app.js"></script>',
  '</body>',
  '</html>',
  '',
].join('\n')

writeFileSync(outputDirectory + '/index.html', html)
console.log('scifork: built dist/companion assets')
