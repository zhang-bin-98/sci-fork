export function boundedLabel(value: string, fallback: string): string {
  const firstLine = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const normalized = (firstLine ?? fallback)
    .replace(/^#{1,6}\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return (normalized || fallback).slice(0, 240)
}
