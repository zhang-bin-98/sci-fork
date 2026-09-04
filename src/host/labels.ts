export function boundedLabel(value: string, fallback: string): string {
  const firstParagraph = value
    .split(/\r?\n\s*\r?\n/u)
    .map((paragraph) => paragraph.trim())
    .find((paragraph) => paragraph.length > 0)
  const boldSummary = firstParagraph?.match(/^(?:\*\*|__)\s*([\s\S]*?)\s*(?:\*\*|__)$/u)?.[1]
  const firstLine = firstParagraph
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const normalized = (boldSummary ?? firstLine ?? fallback)
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^(?:\*\*|__)\s*(.*?)\s*(?:\*\*|__)$/u, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
  return (normalized || fallback).slice(0, 240)
}
