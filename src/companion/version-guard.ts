/**
 * M4 version guard. The DSH boot graph publishes the Host release identity
 * as `window.__DSH_BOOT__.release.version` (verified live on 0.2.1-rc.2).
 * A mismatch is a compatibility warning only — never a fail-closed gate,
 * because a version difference is not a security boundary.
 */
export const PINNED_DSH_VERSION = '0.2.1-rc.2'

interface BootGraphFace {
  readonly release?: { readonly version?: string }
}

export function bootReleaseVersion(): string | undefined {
  const boot = (globalThis as { __DSH_BOOT__?: BootGraphFace }).__DSH_BOOT__
  return boot?.release?.version
}

/** Returns the unverified runtime version, or null when pinned/absent. */
export function unverifiedDshVersion(actual: string | undefined): string | null {
  if (actual === undefined || actual.length === 0) return null
  return actual === PINNED_DSH_VERSION ? null : actual
}
