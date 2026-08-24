import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  JSON_BODY_LIMIT,
  ROUTE_LAUNCH,
  ROUTE_SPIKE,
  isAbsoluteNoTrailingSlash,
  isAllowedLaunchRequest,
  isLoopbackHost,
  isLoopbackOrigin,
  readJsonBody,
  sendJson,
} from '../../src/host/web-routes.js'
import type { ServerResponse } from 'node:http'

describe('route path guards', () => {
  it('keeps registered paths absolute with no trailing slash', () => {
    for (const path of [ROUTE_SPIKE, ROUTE_LAUNCH]) {
      expect(isAbsoluteNoTrailingSlash(path)).toBe(true)
    }
  })

  it('rejects relative or trailing-slash paths', () => {
    expect(isAbsoluteNoTrailingSlash('scifork/api')).toBe(false)
    expect(isAbsoluteNoTrailingSlash('/scifork/')).toBe(false)
    expect(isAbsoluteNoTrailingSlash('')).toBe(false)
  })
})

describe('loopback guards', () => {
  it('accepts loopback hosts and origins', () => {
    expect(isLoopbackHost('127.0.0.1:3080')).toBe(true)
    expect(isLoopbackHost('[::1]:3080')).toBe(true)
    expect(isLoopbackHost('localhost:3080')).toBe(true)
    expect(isLoopbackOrigin('http://127.0.0.1:3080')).toBe(true)
    expect(isLoopbackOrigin('http://localhost:3080')).toBe(true)
  })

  it('rejects non-loopback hosts and origins', () => {
    expect(isLoopbackHost('0.0.0.0:3080')).toBe(false)
    expect(isLoopbackHost('example.com:3080')).toBe(false)
    expect(isLoopbackHost(undefined)).toBe(false)
    expect(isLoopbackOrigin(undefined)).toBe(false)
    expect(isLoopbackOrigin('http://example.com:3080')).toBe(false)
  })
})

describe('launch request admission', () => {
  it('accepts a loopback host with a loopback or absent origin', () => {
    expect(isAllowedLaunchRequest('http://127.0.0.1:3199', '127.0.0.1:3199')).toBe(true)
    expect(isAllowedLaunchRequest(undefined, '127.0.0.1:3199')).toBe(true)
  })

  it('rejects a non-loopback origin even against a loopback host', () => {
    expect(isAllowedLaunchRequest('http://evil.example', '127.0.0.1:3199')).toBe(false)
  })

  it('rejects a non-loopback host regardless of origin', () => {
    expect(isAllowedLaunchRequest('http://127.0.0.1:3199', 'evil.example:3199')).toBe(false)
    expect(isAllowedLaunchRequest(undefined, undefined)).toBe(false)
  })
})

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    const body = await readJsonBody(Readable.from(['{"sessionId":', '"s1"}']), 1024)
    expect(body).toEqual({ sessionId: 's1' })
  })

  it('rejects bodies over the size cap', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(1024) })
    await expect(readJsonBody(Readable.from([big]), 128)).rejects.toThrow()
  })

  it('rejects invalid JSON', async () => {
    await expect(readJsonBody(Readable.from(['{nope']), 1024)).rejects.toThrow()
  })

  it('exposes the configured cap', () => {
    expect(JSON_BODY_LIMIT).toBe(64 * 1024)
  })
})

describe('sendJson', () => {
  it('writes the status, JSON content type, and serialized body', () => {
    const calls: Array<[string, unknown]> = []
    const res = {
      statusCode: 200,
      setHeader(name: string, value: unknown) {
        calls.push([name, value])
      },
      end(chunk: string) {
        calls.push(['end', chunk])
      },
    } as unknown as ServerResponse
    sendJson(res, 201, { ok: true })
    expect(res.statusCode).toBe(201)
    expect(calls).toContainEqual(['content-type', 'application/json; charset=utf-8'])
    expect(calls).toContainEqual(['end', '{"ok":true}'])
  })
})
