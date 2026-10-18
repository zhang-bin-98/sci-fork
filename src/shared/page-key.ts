export const PAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function isPageKey(value: unknown): value is string {
  return typeof value === 'string' && PAGE_KEY_PATTERN.test(value)
}
