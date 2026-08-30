import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { CompanionApiPort } from '../../src/host/companion-service.js'
import type { WebRoute } from '../../src/host/contracts.js'
import {
  COMPANION_ASSET_MANIFEST,
  JSON_BODY_LIMIT,
  PAGE_KEY_HEADER,
  STATIC_CONTENT_SECURITY_POLICY,
  type CompanionAssets,
  isAbsoluteNoTrailingSlash,
  isAllowedJsonRequest,
  isJsonContentType,
  isLoopbackAddress,
  isLoopbackHost,
  readJsonBody,
  sciforkRoutes,
  sendJson,
} from '../../src/host/web-routes.js'
import {
  ROUTE_COMPANION,
  ROUTE_ENTITY,
  ROUTE_FOCUS,
  ROUTE_LAUNCH,
  ROUTE_SNAPSHOT,
} from '../../src/shared/routes.js'

const PAGE_KEY = 'A'.repeat(43)

interface RouteResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

interface RouteRequest {
  method?: string
  path?: string
  headers?: IncomingHttpHeaders | ((port: number) => IncomingHttpHeaders)
  body?: string
  remoteAddress?: string
}

function routeAt(routes: readonly WebRoute[], path: string): WebRoute {
  const route = routes.find((candidate) => candidate.path === path)
  if (route === undefined) throw new Error('missing test route ' + path)
  return route
}

async function invokeRoute(route: WebRoute, options: RouteRequest = {}): Promise<RouteResponse> {
  const server = createServer((req, res) => {
    if (options.remoteAddress !== undefined) {
      Object.defineProperty(req.socket, 'remoteAddress', {
        configurable: true,
        value: options.remoteAddress,
      })
    }
    Promise.resolve(route.handler(req, res)).catch((error: unknown) => {
      res.destroy(error instanceof Error ? error : new Error(String(error)))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  const headers =
    typeof options.headers === 'function' ? options.headers(port) : (options.headers ?? {})
  try {
    return await new Promise<RouteResponse>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: options.path ?? route.path,
          method: options.method ?? 'GET',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }))
        },
      )
      req.once('error', reject)
      req.end(options.body)
    })
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)))
    })
  }
}

function jsonHeaders(
  port: number,
  pageKey?: string,
  contentType = 'application/json',
): IncomingHttpHeaders {
  return {
    host: '127.0.0.1:' + port,
    origin: 'http://127.0.0.1:' + port,
    'content-type': contentType,
    ...(pageKey !== undefined ? { [PAGE_KEY_HEADER]: pageKey } : {}),
  }
}

function memoryAssets(): CompanionAssets {
  const bodies: Record<keyof typeof COMPANION_ASSET_MANIFEST, string> = {
    'index.html': '<!doctype html><main id=root></main>',
    'app.js': 'globalThis.__sciforkLoaded = true',
    'styles.css': 'body { margin: 0; }',
  }
  return { read: (name) => Buffer.from(bodies[name], 'utf8') }
}

function fakeApi(): CompanionApiPort {
  return {
    launch: vi.fn(async () => ({ ok: true as const, url: `/scifork#key=${PAGE_KEY}` })),
    snapshot: vi.fn(async () => ({
      ok: true as const,
      unchanged: false,
      project: {
        revision: 'b'.repeat(64),
        readOnly: false,
        diagnosticCount: 0,
        diagnostics: [],
      },
      graph: { entities: [], edges: [] },
    })),
    entity: vi.fn(async (_key: string, entityId: string) => ({
      ok: true as const,
      entity: {
        id: entityId,
        type: 'node' as const,
        kind: 'hypothesis' as const,
        confidence: 'low' as const,
        evidenceRefs: [],
        referenceCount: 0,
        reviewedEvidenceCount: 0,
        body: '# Test',
      },
    })),
    setFocus: vi.fn(async (_key: string, entityId: string) => ({
      ok: true as const,
      focus: { focusEntityId: entityId, pathIds: [] },
    })),
  }
}

function testRoutes(api = fakeApi(), assets = memoryAssets()): readonly WebRoute[] {
  return sciforkRoutes({ api, assets })
}

describe('M2 route table and request guards', () => {
  it('registers one static prefix and four exact JSON routes with no spike', () => {
    expect(testRoutes().map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: 'prefix', path: ROUTE_COMPANION },
      { kind: 'exact', path: ROUTE_LAUNCH },
      { kind: 'exact', path: ROUTE_SNAPSHOT },
      { kind: 'exact', path: ROUTE_ENTITY },
      { kind: 'exact', path: ROUTE_FOCUS },
    ])
    expect(testRoutes().some(({ path }) => path.includes('spike'))).toBe(false)
    for (const path of [ROUTE_COMPANION, ROUTE_LAUNCH, ROUTE_SNAPSHOT, ROUTE_ENTITY, ROUTE_FOCUS]) {
      expect(isAbsoluteNoTrailingSlash(path)).toBe(true)
    }
  })

  it('accepts only loopback Host/peers and exact same HTTP origin', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('localhost')).toBe(false)
    expect(isLoopbackHost('127.0.0.1:3080')).toBe(true)
    expect(isLoopbackHost('[::1]:3080')).toBe(true)
    expect(isLoopbackHost('localhost:3080')).toBe(true)
    expect(isLoopbackHost('0.0.0.0:3080')).toBe(false)
    expect(isAllowedJsonRequest('http://127.0.0.1:3199', '127.0.0.1:3199', '127.0.0.1')).toBe(true)
    expect(isAllowedJsonRequest(undefined, '127.0.0.1:3199', '127.0.0.1')).toBe(false)
    expect(isAllowedJsonRequest('http://localhost:3199', '127.0.0.1:3199', '127.0.0.1')).toBe(false)
    expect(isAllowedJsonRequest('http://127.0.0.1:3199', '127.0.0.1:3199', '203.0.113.7')).toBe(false)
  })

  it.each(['application/json', 'Application/JSON', 'application/json; charset=utf-8'])(
    'accepts the application/json media type: %s',
    (contentType) => expect(isJsonContentType(contentType)).toBe(true),
  )

  it('rejects a JSON prefix that is not the application/json media type', () => {
    expect(isJsonContentType('application/jsonp')).toBe(false)
  })
})

describe('static Companion route', () => {
  it.each([
    ['/scifork', 'index.html', 'text/html; charset=utf-8'],
    ['/scifork/index.html', 'index.html', 'text/html; charset=utf-8'],
    ['/scifork/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ['/scifork/styles.css', 'styles.css', 'text/css; charset=utf-8'],
  ])('serves allowlisted asset %s', async (path, name, contentType) => {
    const response = await invokeRoute(routeAt(testRoutes(), ROUTE_COMPANION), {
      path,
      headers: (port) => ({ host: '127.0.0.1:' + port }),
    })
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe(contentType)
    expect(response.headers['content-security-policy']).toBe(STATIC_CONTENT_SECURITY_POLICY)
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(response.body).toContain(
      name === 'index.html' ? 'root' : name === 'app.js' ? 'sciforkLoaded' : 'margin',
    )
  })

  it('redirects the legacy slash path to the canonical bare Companion URL', async () => {
    const response = await invokeRoute(routeAt(testRoutes(), ROUTE_COMPANION), {
      path: `${ROUTE_COMPANION}/`,
      headers: (port) => ({ host: '127.0.0.1:' + port }),
    })
    expect(response.status).toBe(308)
    expect(response.headers.location).toBe(ROUTE_COMPANION)
    expect(response.headers['content-security-policy']).toBe(STATIC_CONTENT_SECURITY_POLICY)
    expect(response.body).toBe('')
  })

  it.each([
    '/scifork/missing.js',
    '/scifork/api/snapshot',
    '/scifork/../secret.txt',
    '/scifork/%2e%2e/secret.txt',
    '/scifork/%252e%252e/secret.txt',
    '/scifork/app.js?key=secret',
  ])('rejects non-manifest, API-shaped, traversal, or queried path %s', async (path) => {
    const response = await invokeRoute(routeAt(testRoutes(), ROUTE_COMPANION), {
      path,
      headers: (port) => ({ host: '127.0.0.1:' + port }),
    })
    expect(response.status).toBe(404)
  })

  it('supports HEAD but rejects other methods and non-loopback requests', async () => {
    const route = routeAt(testRoutes(), ROUTE_COMPANION)
    const head = await invokeRoute(route, {
      method: 'HEAD',
      path: '/scifork/app.js',
      headers: (port) => ({ host: '127.0.0.1:' + port }),
    })
    const post = await invokeRoute(route, {
      method: 'POST',
      path: '/scifork/app.js',
      headers: (port) => ({ host: '127.0.0.1:' + port }),
    })
    const remote = await invokeRoute(route, {
      path: '/scifork/app.js',
      headers: (port) => ({ host: '127.0.0.1:' + port }),
      remoteAddress: '203.0.113.7',
    })
    expect(head.status).toBe(200)
    expect(head.body).toBe('')
    expect(post.status).toBe(405)
    expect(remote.status).toBe(403)
  })

  it('fails closed without exposing an asset-loader path', async () => {
    const assets: CompanionAssets = {
      read() {
        throw new Error('missing E:\\secret\\dist\\companion')
      },
    }
    const response = await invokeRoute(
      routeAt(testRoutes(fakeApi(), assets), ROUTE_COMPANION),
      { path: '/scifork', headers: (port) => ({ host: '127.0.0.1:' + port }) },
    )
    expect(response.status).toBe(503)
    expect(response.body).not.toContain('secret')
  })
})

describe('JSON Companion API routes', () => {
  it('dispatches the four strict request bodies to the Companion service', async () => {
    const api = fakeApi()
    const routes = testRoutes(api)
    const requests = [
      [ROUTE_LAUNCH, undefined, { sessionId: 'session-1' }],
      [ROUTE_SNAPSHOT, PAGE_KEY, { sinceProjectRevision: 'c'.repeat(64) }],
      [ROUTE_ENTITY, PAGE_KEY, { entityId: 'node-1' }],
      [ROUTE_FOCUS, PAGE_KEY, { entityId: 'node-1' }],
    ] as const

    for (const [path, key, body] of requests) {
      const response = await invokeRoute(routeAt(routes, path), {
        method: 'POST',
        headers: (port) => jsonHeaders(port, key),
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(200)
      expect(JSON.parse(response.body)).toMatchObject({ ok: true })
      expect(response.headers['cache-control']).toBe('no-store')
    }

    expect(api.launch).toHaveBeenCalledWith('session-1')
    expect(api.snapshot).toHaveBeenCalledWith(PAGE_KEY, 'c'.repeat(64))
    expect(api.entity).toHaveBeenCalledWith(PAGE_KEY, 'node-1')
    expect(api.setFocus).toHaveBeenCalledWith(PAGE_KEY, 'node-1')
  })

  it.each([ROUTE_SNAPSHOT, ROUTE_ENTITY, ROUTE_FOCUS])(
    'returns 401 before service dispatch for a missing or malformed key on %s',
    async (path) => {
      const api = fakeApi()
      const body = path === ROUTE_SNAPSHOT ? {} : { entityId: 'node-1' }
      const missing = await invokeRoute(routeAt(testRoutes(api), path), {
        method: 'POST',
        headers: (port) => jsonHeaders(port),
        body: JSON.stringify(body),
      })
      const malformed = await invokeRoute(routeAt(testRoutes(api), path), {
        method: 'POST',
        headers: (port) => jsonHeaders(port, 'not-a-page-key'),
        body: JSON.stringify(body),
      })
      expect(missing.status).toBe(401)
      expect(malformed.status).toBe(401)
      expect(JSON.parse(missing.body)).toMatchObject({
        ok: false,
        code: 'PAGE_KEY_INVALID',
      })
      expect(JSON.stringify([missing.body, malformed.body])).not.toContain(PAGE_KEY)
    },
  )

  it('maps a stale service binding to bounded HTTP 401 without key/path leakage', async () => {
    const api = fakeApi()
    api.snapshot = vi.fn(async () => ({
      ok: false as const,
      code: 'PAGE_KEY_INVALID',
      message: 'Reopen the Companion from DSH.',
      recoverable: true,
    }))
    const response = await invokeRoute(routeAt(testRoutes(api), ROUTE_SNAPSHOT), {
      method: 'POST',
      headers: (port) => jsonHeaders(port, PAGE_KEY),
      body: '{}',
    })
    expect(response.status).toBe(401)
    expect(response.body).not.toContain(PAGE_KEY)
    expect(response.body).not.toMatch(/[A-Z]:\\|\/project/u)
  })

  it.each([ROUTE_LAUNCH, ROUTE_SNAPSHOT, ROUTE_ENTITY, ROUTE_FOCUS])(
    'enforces method, same-origin loopback, media type, and body cap on %s',
    async (path) => {
      const route = routeAt(testRoutes(), path)
      const body = path === ROUTE_LAUNCH
        ? { sessionId: 'session-1' }
        : path === ROUTE_SNAPSHOT
          ? {}
          : { entityId: 'node-1' }
      const key = path === ROUTE_LAUNCH ? undefined : PAGE_KEY
      const get = await invokeRoute(route, { headers: (port) => jsonHeaders(port, key) })
      const noOrigin = await invokeRoute(route, {
        method: 'POST',
        headers: (port) => ({
          host: '127.0.0.1:' + port,
          'content-type': 'application/json',
          ...(key !== undefined ? { [PAGE_KEY_HEADER]: key } : {}),
        }),
        body: JSON.stringify(body),
      })
      const remote = await invokeRoute(route, {
        method: 'POST',
        headers: (port) => jsonHeaders(port, key),
        body: JSON.stringify(body),
        remoteAddress: '203.0.113.7',
      })
      const wrongType = await invokeRoute(route, {
        method: 'POST',
        headers: (port) => jsonHeaders(port, key, 'text/plain'),
        body: JSON.stringify(body),
      })
      const oversized = await invokeRoute(route, {
        method: 'POST',
        headers: (port) => jsonHeaders(port, key),
        body: JSON.stringify({ ...body, blob: 'x'.repeat(JSON_BODY_LIMIT) }),
      })
      expect(get.status).toBe(405)
      expect(noOrigin.status).toBe(403)
      expect(remote.status).toBe(403)
      expect(wrongType.status).toBe(415)
      expect(oversized.status).toBe(413)
    },
  )

  it.each([
    [ROUTE_LAUNCH, {}, { sessionId: 'session-1', extra: true }],
    [ROUTE_SNAPSHOT, { sinceProjectRevision: 1 }, { extra: true }],
    [ROUTE_ENTITY, {}, { entityId: 'node-1', extra: true }],
    [ROUTE_FOCUS, { entityId: 1 }, { entityId: 'node-1', extra: true }],
  ])('rejects missing, mistyped, and extra body fields on %s', async (path, badA, badB) => {
    const route = routeAt(testRoutes(), path as string)
    const key = path === ROUTE_LAUNCH ? undefined : PAGE_KEY
    for (const body of [badA, badB]) {
      const response = await invokeRoute(route, {
        method: 'POST',
        headers: (port) => jsonHeaders(port, key),
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
      expect(JSON.parse(response.body)).toMatchObject({ code: 'INVALID_REQUEST' })
    }
  })

  it('does not accept a Page Key from a query or request body', async () => {
    const route = routeAt(testRoutes(), ROUTE_SNAPSHOT)
    const fromQuery = await invokeRoute(route, {
      method: 'POST',
      path: `${ROUTE_SNAPSHOT}?key=${PAGE_KEY}`,
      headers: (port) => jsonHeaders(port),
      body: '{}',
    })
    const fromBody = await invokeRoute(route, {
      method: 'POST',
      headers: (port) => jsonHeaders(port),
      body: JSON.stringify({ pageKey: PAGE_KEY }),
    })
    expect(fromQuery.status).toBe(401)
    expect(fromBody.status).toBe(401)
  })

  it('returns a stable bounded response when the service throws', async () => {
    const api = fakeApi()
    api.snapshot = vi.fn(async () => {
      throw new Error('failed under E:\\secret\\project')
    })
    const response = await invokeRoute(routeAt(testRoutes(api), ROUTE_SNAPSHOT), {
      method: 'POST',
      headers: (port) => jsonHeaders(port, PAGE_KEY),
      body: '{}',
    })
    expect(response.status).toBe(500)
    expect(response.body).not.toContain('secret')
    expect(response.body).not.toContain(PAGE_KEY)
  })
})

describe('body and response helpers', () => {
  it('parses JSON and rejects invalid or oversized bodies', async () => {
    await expect(readJsonBody(Readable.from([JSON.stringify({ sessionId: 's1' })]), 1024)).resolves.toEqual({
      sessionId: 's1',
    })
    await expect(readJsonBody(Readable.from(['{nope']), 1024)).rejects.toThrow()
    await expect(
      readJsonBody(Readable.from([JSON.stringify({ blob: 'x'.repeat(1024) })]), 128),
    ).rejects.toThrow()
    expect(JSON_BODY_LIMIT).toBe(64 * 1024)
  })

  it('writes status and hardened JSON headers', () => {
    const calls: Array<[string, unknown]> = []
    const res = {
      statusCode: 200,
      setHeader(name: string, value: unknown) { calls.push([name, value]) },
      end(chunk: string) { calls.push(['end', chunk]) },
    } as unknown as ServerResponse
    sendJson(res, 201, { ok: true })
    expect(res.statusCode).toBe(201)
    expect(calls).toContainEqual(['content-type', 'application/json; charset=utf-8'])
    expect(calls).toContainEqual(['cache-control', 'no-store'])
    expect(calls).toContainEqual(['end', JSON.stringify({ ok: true })])
  })
})
