export const PAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const RESEARCH_EXPANSION_CHANNEL_PREFIX = 'scifork:research-expansion:v1:'

export function isPageKey(value: unknown): value is string {
  return typeof value === 'string' && PAGE_KEY_PATTERN.test(value)
}

export function channelNameForPageKey(pageKey: string): string {
  if (!isPageKey(pageKey)) throw new Error('invalid SciFork Page Key')
  return `${RESEARCH_EXPANSION_CHANNEL_PREFIX}${pageKey}`
}
