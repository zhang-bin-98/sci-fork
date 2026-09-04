import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const helper = join(repoRoot, 'skills', 'pubmed-search', 'helper.mjs')
const servers: Server[] = []

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

async function runHelper(request: unknown, baseUrl: string, timeoutMs = 5000): Promise<RunResult> {
  const child = spawn(process.execPath, [helper], {
    cwd: repoRoot,
    env: { ...process.env, SCIFORK_PUBMED_BASE_URL: baseUrl, SCIFORK_PUBMED_TIMEOUT_MS: String(timeoutMs) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdin.write(JSON.stringify(request))
  child.stdin.end()
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const [code] = await once(child, 'close') as [number | null]
  return { code, stdout, stderr }
}

async function fixture(handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse, body: string) => void): Promise<string> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      handler(request, response, body)
      if (!response.writableEnded) {
        response.statusCode = 500
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'fixture did not respond' }))
      }
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}/entrez/eutils`
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

function sendJson(response: import('node:http').ServerResponse, value: unknown): void {
  response.statusCode = 200
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

function sendXml(response: import('node:http').ServerResponse, value: string): void {
  response.statusCode = 200
  response.setHeader('content-type', 'application/xml')
  response.end(value)
}

describe('pubmed helper', () => {
  it('rejects malformed requests without making a network call', async () => {
    let called = false
    const base = await fixture((_request, response) => {
      called = true
      sendJson(response, {})
    })
    const result = await runHelper({ operation: 'search', query: '', retmax: 301 }, base)
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(called).toBe(false)
  })

  it('rejects unknown request fields', async () => {
    const run = await runHelper({ operation: 'search', query: 'claim', unexpected: true }, 'http://127.0.0.1:1/entrez/eutils')
    expect(JSON.parse(run.stdout)).toEqual({ ok: false, error: { code: 'INVALID_REQUEST', message: 'search request contains an unknown field' } })
  })

  it('searches a page, returns metadata, and reports the next page', async () => {
    const calls: { method: string; url: string; body: string }[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString() })
      request.on('end', () => {
        calls.push({ method: request.method ?? '', url: request.url ?? '', body })
        if ((request.url ?? '').includes('esearch.fcgi')) {
          sendJson(response, { esearchresult: { count: '25', retstart: '10', retmax: '2', idlist: ['1', '2'] } })
        } else {
          sendJson(response, {
            result: {
              uids: ['1', '2'],
              '1': { uid: '1', title: 'First claim', fulljournalname: 'Journal A', pubdate: '2024 Jan', authors: [{ name: 'A One' }], pubtype: ['Journal Article'], articleids: [{ idtype: 'doi', value: '10.1000/one' }] },
              '2': { uid: '2', title: 'Second claim', pubdate: '2023', authors: [{ name: 'B Two' }], pubtype: ['Review'], articleids: [] },
            },
          })
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    const result = await runHelper({ operation: 'search', query: 'kinase[title]', retstart: 10, retmax: 2 }, `http://127.0.0.1:${address.port}/entrez/eutils`)
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      operation: 'search',
      query: 'kinase[title]',
      retstart: 10,
      retmax: 2,
      count: 25,
      nextRetstart: 12,
      records: [
        { pmid: '1', doi: '10.1000/one', title: 'First claim', journal: 'Journal A', year: 2024, authors: ['A One'], publicationTypes: ['Journal Article'] },
        { pmid: '2', title: 'Second claim', year: 2023, authors: ['B Two'], publicationTypes: ['Review'] },
      ],
    })
    expect(calls[0]?.method).toBe('GET')
    expect(calls[1]?.method).toBe('GET')
  })

  it('uses the documented default page values and returns an empty page', async () => {
    const calls: string[] = []
    const base = await fixture((request, response) => {
      calls.push(request.url ?? '')
      if ((request.url ?? '').includes('esearch.fcgi')) {
        sendJson(response, { esearchresult: { count: '0', retstart: '0', retmax: '20', idlist: [] } })
      } else {
        sendJson(response, { result: { uids: [] } })
      }
    })
    const result = await runHelper({ operation: 'search', query: 'rare disease' }, base)
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      operation: 'search',
      query: 'rare disease',
      retstart: 0,
      retmax: 20,
      count: 0,
      records: [],
    })
    expect(calls[0]).toContain('retmax=20')
  })

  it('uses POST for metadata batches over 200 identifiers', async () => {
    const calls: { method: string; url: string; body: string }[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString() })
      request.on('end', () => {
        calls.push({ method: request.method ?? '', url: request.url ?? '', body })
        if ((request.url ?? '').includes('esearch.fcgi')) {
          sendJson(response, { esearchresult: { count: '300', retstart: '0', retmax: '300', idlist: Array.from({ length: 300 }, (_, i) => String(i + 1)) } })
        } else {
          const ids = Array.from({ length: 300 }, (_, i) => String(i + 1))
          const result: Record<string, unknown> = { uids: ids }
          for (const id of ids) result[id] = { uid: id, title: `Claim ${id}`, authors: [], pubtype: [], articleids: [] }
          sendJson(response, { result })
        }
      })
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    const run = await runHelper({ operation: 'search', query: 'all[all fields]', retmax: 300 }, `http://127.0.0.1:${address.port}/entrez/eutils`)
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, retmax: 300, count: 300 })
    expect(calls[1]?.method).toBe('POST')
    expect(calls[1]?.body).toContain('id=1%2C2%2C3')
  })

  it('resolves DOI lookup and returns a canonical URL', async () => {
    const calls: string[] = []
    const server = createServer((request, response) => {
      calls.push(`${request.method} ${request.url}`)
      if ((request.url ?? '').includes('esearch.fcgi')) {
        sendJson(response, { esearchresult: { count: '1', idlist: ['123456'] } })
        } else if ((request.url ?? '').includes('esummary.fcgi')) {
          sendJson(response, { result: { uids: ['123456'], '123456': { uid: '123456', title: 'Lookup claim', pubdate: '2022', authors: [], pubtype: [], articleids: [{ idtype: 'doi', value: '10.1000/lookup' }] } } })
        } else {
          sendXml(response, [
            '<?xml version="1.0"?>',
            '<PubmedArticleSet><PubmedArticle><MedlineCitation>',
            '<PMID>123456</PMID><Article><Abstract>',
            '<AbstractText Label="BACKGROUND">STAT3 &amp; IL-6 rise together.</AbstractText>',
            '<AbstractText>A second <i>bounded</i> observation.</AbstractText>',
            '</Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>',
          ].join(''))
        }
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    const run = await runHelper({ operation: 'lookup', identifier: { doi: 'https://doi.org/10.1000/LOOKUP' } }, `http://127.0.0.1:${address.port}/entrez/eutils`)
    const output = JSON.parse(run.stdout)
    expect(output).toMatchObject({
      ok: true,
      operation: 'lookup',
      record: {
        pmid: '123456',
        doi: '10.1000/lookup',
        abstract: 'BACKGROUND: STAT3 & IL-6 rise together.\n\nA second bounded observation.',
        canonicalUrl: 'https://pubmed.ncbi.nlm.nih.gov/123456/',
      },
    })
    expect(output.record.retrievedAt).toMatch(/Z$/)
    expect(calls[0]).toContain('esearch.fcgi')
    expect(calls[1]).toContain('esummary.fcgi')
    expect(calls[2]).toContain('efetch.fcgi')
  })

  it('reports a missing DOI without fabricating a record', async () => {
    const base = await fixture((_request, response) => {
      sendJson(response, { esearchresult: { count: '0', idlist: [] } })
    })
    const run = await runHelper({ operation: 'lookup', identifier: { doi: '10.1000/missing' } }, base)
    expect(JSON.parse(run.stdout)).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'no PubMed record matched the DOI' } })
  })

  it('maps a timed-out upstream request to a stable timeout error', async () => {
    const server = createServer((_request, _response) => {
      // Keep the socket open beyond the helper timeout.
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    const run = await runHelper({ operation: 'search', query: 'slow' }, `http://127.0.0.1:${address.port}/entrez/eutils`, 100)
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
  })

  it('returns stable errors for not found and malformed upstream data', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 200
      response.setHeader('content-type', 'application/json')
      response.end('{"unexpected":true}')
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    const run = await runHelper({ operation: 'lookup', identifier: { pmid: '123456' } }, `http://127.0.0.1:${address.port}/entrez/eutils`)
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_RESPONSE' } })
  })

  it('rejects a successful response whose serialized output is too large', async () => {
    const server = createServer((request, response) => {
      if ((request.url ?? '').includes('esearch.fcgi')) {
        sendJson(response, { esearchresult: { count: '1', idlist: ['123456'] } })
      } else {
        sendJson(response, {
          result: {
            uids: ['123456'],
            '123456': { uid: '123456', title: 'x'.repeat(600_000), authors: [], pubtype: [], articleids: [] },
          },
        })
      }
    })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address() as AddressInfo
    const run = await runHelper({ operation: 'search', query: 'large' }, `http://127.0.0.1:${address.port}/entrez/eutils`)
    expect(JSON.parse(run.stdout)).toEqual({ ok: false, error: { code: 'OUTPUT_TOO_LARGE', message: 'helper output exceeded the bounded output limit' } })
  })
})
