import { describe, expect, it } from 'vitest'
import { PINNED_DSH_VERSION, unverifiedDshVersion } from '../../src/companion/version-guard.js'

describe('unverifiedDshVersion', () => {
  it('accepts the pinned version and ignores an absent release', () => {
    expect(unverifiedDshVersion(PINNED_DSH_VERSION)).toBeNull()
    expect(unverifiedDshVersion(undefined)).toBeNull()
    expect(unverifiedDshVersion('')).toBeNull()
  })

  it('reports any other runtime version as unverified', () => {
    expect(unverifiedDshVersion('0.2.1-rc.3')).toBe('0.2.1-rc.3')
    expect(unverifiedDshVersion('0.3.0')).toBe('0.3.0')
  })
})
