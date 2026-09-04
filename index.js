/**
 * SciFork bundle entry point. The Host plugin is built from src/host by
 * `pnpm build`; run it before installing the package from a checkout. The
 * release tarball always ships the built dist/ output.
 */
export * from './dist/host/index.js'
