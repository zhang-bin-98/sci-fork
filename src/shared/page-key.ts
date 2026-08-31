export const PAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/
/** Legacy v1 wire value retained so an already-open Companion survives bundle reloads. */
export const RESEARCH_EXPANSION_CHANNEL_PREFIX = 'scifork:simulate:v1:'

export function isPageKey(value: unknown): value is string {
  return typeof value === 'string' && PAGE_KEY_PATTERN.test(value)
}

export function channelNameForPageKey(pageKey: string): string {
  if (!isPageKey(pageKey)) throw new Error('invalid SciFork Page Key')
  return `${RESEARCH_EXPANSION_CHANNEL_PREFIX}${pageKey}`
}
