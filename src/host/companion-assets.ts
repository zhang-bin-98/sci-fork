import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CompanionAssetName, CompanionAssets } from './web-routes.js'

/** Build fixed asset paths now; read bytes only when the static route is requested. */
export function companionAssetsFromPackageRoot(packageRoot: string): CompanionAssets {
  const paths: Record<CompanionAssetName, string> = {
    'index.html': resolve(packageRoot, 'dist', 'companion', 'index.html'),
    'app.js': resolve(packageRoot, 'dist', 'companion', 'app.js'),
    'styles.css': resolve(packageRoot, 'dist', 'companion', 'styles.css'),
  }
  return {
    read(name) {
      return readFileSync(paths[name])
    },
  }
}
