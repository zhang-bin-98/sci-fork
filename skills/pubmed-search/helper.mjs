#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

/**
 * Small, dependency-free PubMed adapter for the packaged retrieval Skill.
 * The CLI emits one JSON value on stdout; all failures are data failures so a
 * model cannot mistake an empty response for a successful fabricated record.
 */

const DEFAULT_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const BASE_URL = (process.env.SCIFORK_PUBMED_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_INPUT_BYTES = 64 * 1024
const MAX_OUTPUT_BYTES = 512 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_QUERY_LENGTH = 2_000
const MAX_RETRIES = 2
const DEFAULT_RETMAX = 20
const MAX_RETMAX = 300

let lastRequestAt = 0

function errorResult(code, message) {
  return { ok: false, error: { code, message } }
}

function validPmid(value) {
  return typeof value === 'string' && /^[1-9][0-9]{0,7}$/.test(value.trim())
}

function normalizePmid(value) {
  if (!validPmid(value)) return undefined
  return value.trim()
}

function normalizeDoi(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const bare = trimmed.replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '')
  const slash = bare.indexOf('/')
  if (slash < 0) return undefined
  const directory = bare.slice(0, slash)
  const suffix = bare.slice(slash + 1)
  if (!/^10\.\d{4,9}$/i.test(directory) || suffix.length === 0) return undefined
  return `${directory.toLowerCase()}/${suffix}`
}

function timeoutMs() {
  const value = Number(process.env.SCIFORK_PUBMED_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  return Number.isFinite(value) && value >= 1 && value <= 120_000 ? Math.floor(value) : DEFAULT_TIMEOUT_MS
}

function pause(ms, signal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function rateLimit(signal) {
  const interval = process.env.NCBI_API_KEY === undefined ? 334 : 100
  const wait = Math.max(0, interval - (Date.now() - lastRequestAt))
  await pause(wait, signal)
  lastRequestAt = Date.now()
}

function endpointUrl(endpoint) {
  return `${BASE_URL}/${endpoint}.fcgi`
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key))
}

async function requestBody(
  endpoint,
  params,
  method = 'GET',
  accept = 'application/json',
  expectedContentType = /application\/json/i,
  invalidContentTypeMessage = 'NCBI response was not JSON',
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs())
  const search = new URLSearchParams()
  search.set('tool', 'scifork-pubmed-search')
  if (process.env.NCBI_EMAIL !== undefined) search.set('email', process.env.NCBI_EMAIL)
  if (process.env.NCBI_API_KEY !== undefined) search.set('api_key', process.env.NCBI_API_KEY)
  for (const [key, value] of Object.entries(params)) search.set(key, String(value))

  try {
    await rateLimit(controller.signal)
    const init = method === 'POST'
      ? {
          method,
          headers: { accept, 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'SciFork/0.0 PubMed helper' },
          body: search.toString(),
          signal: controller.signal,
        }
      : {
          method,
          headers: { accept, 'user-agent': 'SciFork/0.0 PubMed helper' },
          signal: controller.signal,
        }
    const url = method === 'POST' ? endpointUrl(endpoint) : `${endpointUrl(endpoint)}?${search.toString()}`
    let response
    let lastError
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        response = await fetch(url, init)
        if (response.status >= 500 && attempt < MAX_RETRIES) {
          await pause(100 * (attempt + 1), controller.signal)
          continue
        }
        break
      } catch (error) {
        lastError = error
        if (controller.signal.aborted) throw error
        if (attempt >= MAX_RETRIES) throw error
        await pause(100 * (attempt + 1), controller.signal)
      }
    }
    if (response === undefined) throw lastError ?? new Error('request failed')
    if (!response.ok) return { ok: false, error: { code: 'UPSTREAM_HTTP', message: `NCBI returned HTTP ${response.status}` } }
    const contentType = response.headers.get('content-type') ?? ''
    if (!expectedContentType.test(contentType)) {
      return { ok: false, error: { code: 'INVALID_RESPONSE', message: invalidContentTypeMessage } }
    }
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      return { ok: false, error: { code: 'INVALID_RESPONSE', message: 'NCBI response exceeded the bounded response limit' } }
    }
    return { ok: true, value: body }
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, error: { code: 'TIMEOUT', message: 'NCBI request timed out' } }
    return { ok: false, error: { code: 'NETWORK_ERROR', message: 'NCBI request failed' } }
  } finally {
    clearTimeout(timer)
  }
}

async function requestJson(endpoint, params, method = 'GET') {
  const response = await requestBody(endpoint, params, method)
  if (!response.ok) return response
  try {
    return { ok: true, value: JSON.parse(response.value) }
  } catch {
    return { ok: false, error: { code: 'INVALID_RESPONSE', message: 'NCBI response contained invalid JSON' } }
  }
}

function decodeXmlText(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits) => {
      const codePoint = Number.parseInt(digits, 16)
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ''
    })
    .replace(/&#([0-9]+);/g, (_match, digits) => {
      const codePoint = Number.parseInt(digits, 10)
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ''
    })
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseAbstractXml(raw, pmid) {
  if (typeof raw !== 'string' || !/<PubmedArticleSet\b/i.test(raw)) return undefined
  const pmidMatch = /<PMID\b[^>]*>\s*([1-9][0-9]{0,7})\s*<\/PMID>/i.exec(raw)
  if (pmidMatch?.[1] !== pmid) return undefined
  const sections = []
  const pattern = /<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi
  for (const match of raw.matchAll(pattern)) {
    const text = decodeXmlText(match[2] ?? '')
    if (text.length === 0) continue
    const attributes = match[1] ?? ''
    const labelMatch = /\bLabel\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes)
    const label = decodeXmlText(labelMatch?.[1] ?? labelMatch?.[2] ?? '')
    sections.push(label.length === 0 ? text : `${label}: ${text}`)
  }
  return { ...(sections.length === 0 ? {} : { abstract: sections.join('\n\n') }) }
}

async function abstractFor(pmid) {
  const response = await requestBody(
    'efetch',
    { db: 'pubmed', id: pmid, retmode: 'xml' },
    'GET',
    'application/xml, text/xml;q=0.9',
    /(?:application|text)\/xml/i,
    'NCBI abstract response was not XML',
  )
  if (!response.ok) return response
  const parsed = parseAbstractXml(response.value, pmid)
  return parsed === undefined
    ? { ok: false, error: { code: 'INVALID_RESPONSE', message: 'NCBI abstract response had an unexpected shape' } }
    : { ok: true, ...parsed }
}

function parsePage(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw.esearchresult
  if (!result || typeof result !== 'object') return undefined
  const count = Number(result.count)
  const ids = result.idlist
  if (!Number.isInteger(count) || count < 0 || !Array.isArray(ids) || ids.some((id) => !validPmid(id))) return undefined
  return { count, ids: ids.map((id) => id.trim()) }
}

function parseSummary(raw, ids) {
  if (!raw || typeof raw !== 'object') return undefined
  const result = raw.result
  if (!result || typeof result !== 'object' || !Array.isArray(result.uids)) return undefined
  const records = []
  for (const id of ids) {
    const summary = result[id]
    if (!summary || typeof summary !== 'object') return undefined
    const title = typeof summary.title === 'string' ? summary.title.trim() : ''
    if (title.length === 0) return undefined
    const record = { pmid: id, title }
    const doi = Array.isArray(summary.articleids)
      ? summary.articleids.find((entry) => entry && typeof entry === 'object' && entry.idtype === 'doi' && typeof entry.value === 'string')?.value
      : undefined
    const normalizedDoi = normalizeDoi(doi)
    if (normalizedDoi !== undefined) record.doi = normalizedDoi
    const journal = typeof summary.fulljournalname === 'string' && summary.fulljournalname.trim().length > 0
      ? summary.fulljournalname.trim()
      : typeof summary.source === 'string' && summary.source.trim().length > 0
        ? summary.source.trim()
        : undefined
    if (journal !== undefined) record.journal = journal
    const pubdate = typeof summary.pubdate === 'string' ? summary.pubdate : ''
    const yearMatch = /(?:^|\D)([12][0-9]{3})(?:\D|$)/.exec(pubdate)
    if (yearMatch !== null) record.year = Number(yearMatch[1])
    if (Array.isArray(summary.authors)) {
      const authors = summary.authors
        .filter((entry) => entry && typeof entry === 'object' && typeof entry.name === 'string')
        .map((entry) => entry.name.trim())
        .filter((name) => name.length > 0)
      record.authors = authors.slice(0, 20)
    } else {
      record.authors = []
    }
    if (Array.isArray(summary.pubtype)) {
      record.publicationTypes = summary.pubtype.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean).slice(0, 20)
    } else {
      record.publicationTypes = []
    }
    records.push(record)
  }
  return records
}

async function summaries(ids) {
  if (ids.length === 0) return { ok: true, records: [] }
  const response = await requestJson('esummary', { db: 'pubmed', id: ids.join(','), retmode: 'json' }, ids.length > 200 ? 'POST' : 'GET')
  if (!response.ok) return response
  const records = parseSummary(response.value, ids)
  return records === undefined
    ? { ok: false, error: { code: 'INVALID_RESPONSE', message: 'NCBI summary response had an unexpected shape' } }
    : { ok: true, records }
}

function validateSearchRequest(request) {
  if (!request || typeof request !== 'object' || request.operation !== 'search') return errorResult('INVALID_REQUEST', 'operation must be search or lookup')
  if (!hasOnlyKeys(request, ['operation', 'query', 'retstart', 'retmax'])) return errorResult('INVALID_REQUEST', 'search request contains an unknown field')
  if (typeof request.query !== 'string' || request.query.trim().length === 0 || request.query.length > MAX_QUERY_LENGTH) return errorResult('INVALID_REQUEST', 'search query must be non-empty and bounded')
  const retstart = request.retstart === undefined ? 0 : request.retstart
  const retmax = request.retmax === undefined ? DEFAULT_RETMAX : request.retmax
  if (!Number.isInteger(retstart) || retstart < 0) return errorResult('INVALID_REQUEST', 'retstart must be a non-negative integer')
  if (!Number.isInteger(retmax) || retmax < 1 || retmax > MAX_RETMAX) return errorResult('INVALID_REQUEST', 'retmax must be an integer from 1 through 300')
  return { query: request.query, retstart, retmax }
}

async function search(request) {
  const valid = validateSearchRequest(request)
  if (valid.error) return valid
  const response = await requestJson('esearch', { db: 'pubmed', term: valid.query, retstart: valid.retstart, retmax: valid.retmax, retmode: 'json' })
  if (!response.ok) return { ok: false, error: response.error }
  const page = parsePage(response.value)
  if (page === undefined) return errorResult('INVALID_RESPONSE', 'NCBI search response had an unexpected shape')
  const metadata = await summaries(page.ids)
  if (!metadata.ok) return { ok: false, error: metadata.error }
  const output = {
    ok: true,
    operation: 'search',
    query: valid.query,
    retstart: valid.retstart,
    retmax: valid.retmax,
    count: page.count,
    ...(valid.retstart + page.ids.length < page.count ? { nextRetstart: valid.retstart + page.ids.length } : {}),
    records: metadata.records,
  }
  return output
}

function validateLookupRequest(request) {
  if (!request || typeof request !== 'object' || request.operation !== 'lookup' || !request.identifier || typeof request.identifier !== 'object') return errorResult('INVALID_REQUEST', 'lookup requires an identifier object')
  if (!hasOnlyKeys(request, ['operation', 'identifier']) || !hasOnlyKeys(request.identifier, ['pmid', 'doi'])) return errorResult('INVALID_REQUEST', 'lookup request contains an unknown field')
  const pmid = request.identifier.pmid === undefined ? undefined : normalizePmid(request.identifier.pmid)
  const doi = request.identifier.doi === undefined ? undefined : normalizeDoi(request.identifier.doi)
  if (request.identifier.pmid !== undefined && pmid === undefined) return errorResult('INVALID_REQUEST', 'identifier.pmid is invalid')
  if (request.identifier.doi !== undefined && doi === undefined) return errorResult('INVALID_REQUEST', 'identifier.doi is invalid')
  if ((pmid === undefined ? 0 : 1) + (doi === undefined ? 0 : 1) !== 1) return errorResult('INVALID_REQUEST', 'lookup requires exactly one valid PMID or DOI')
  return { pmid, doi }
}

async function lookup(request) {
  const valid = validateLookupRequest(request)
  if (valid.error) return valid
  let pmid = valid.pmid
  if (pmid === undefined) {
    const response = await requestJson('esearch', { db: 'pubmed', term: `${valid.doi}[doi]`, retmax: 1, retmode: 'json' })
    if (!response.ok) return { ok: false, error: response.error }
    const page = parsePage(response.value)
    if (page === undefined) return errorResult('INVALID_RESPONSE', 'NCBI DOI search response had an unexpected shape')
    pmid = page.ids[0]
    if (pmid === undefined) return errorResult('NOT_FOUND', 'no PubMed record matched the DOI')
  }
  const metadata = await summaries([pmid])
  if (!metadata.ok) return { ok: false, error: metadata.error }
  const record = metadata.records[0]
  if (record === undefined) return errorResult('NOT_FOUND', 'no PubMed record matched the identifier')
  if (valid.doi !== undefined && record.doi !== undefined && record.doi.toLowerCase() !== valid.doi.toLowerCase()) return errorResult('INVALID_RESPONSE', 'NCBI returned a DOI that did not match the lookup')
  const abstract = await abstractFor(record.pmid)
  if (!abstract.ok) return { ok: false, error: abstract.error }
  return {
    ok: true,
    operation: 'lookup',
    record: {
      ...record,
      ...(abstract.abstract === undefined ? {} : { abstract: abstract.abstract }),
      canonicalUrl: `https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`,
      retrievedAt: new Date().toISOString(),
    },
  }
}

export async function handleRequest(request) {
  if (!request || typeof request !== 'object' || (request.operation !== 'search' && request.operation !== 'lookup')) return errorResult('INVALID_REQUEST', 'operation must be search or lookup')
  try {
    return request.operation === 'search' ? await search(request) : await lookup(request)
  } catch {
    return errorResult('NETWORK_ERROR', 'PubMed helper failed')
  }
}

async function readInput() {
  if (process.argv[2] !== undefined) {
    if (Buffer.byteLength(process.argv[2]) > MAX_INPUT_BYTES) throw new Error('input too large')
    return process.argv[2]
  }
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    bytes += Buffer.byteLength(text)
    if (bytes > MAX_INPUT_BYTES) throw new Error('input too large')
    chunks.push(text)
  }
  return chunks.join('')
}

async function main() {
  let request
  try {
    const input = await readInput()
    request = JSON.parse(input)
  } catch {
    process.stdout.write(JSON.stringify(errorResult('INVALID_REQUEST', 'input must be one bounded JSON request')))
    return
  }
  let result = await handleRequest(request)
  const serialized = JSON.stringify(result)
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) result = errorResult('OUTPUT_TOO_LARGE', 'helper output exceeded the bounded output limit')
  process.stdout.write(JSON.stringify(result))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
