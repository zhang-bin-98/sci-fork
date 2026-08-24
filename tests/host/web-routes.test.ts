import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
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
  sciforkRoutes,
  sendJson,
} from '../../src/host/web-routes.js'
import type { WebRoute } from '../../src/host/contracts.js'

interface RouteResponse {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

interface RouteRequest {
  method?: string
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
          path: route.path,
          method: options.method ?? 'GET',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          })
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

function launchHeaders(port: number, contentType = 'application/json'): IncomingHttpHeaders {
  return {
    host: '127.0.0.1:' + port,
    origin: 'http://127.0.0.1:' + port,
    'content-type': contentType,
  }
}

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
  it('accepts only an exact loopback Origin, Host, and socket address', () => {
    expect(
      isAllowedLaunchRequest(
        'http://127.0.0.1:3199',
        '127.0.0.1:3199',
        '127.0.0.1',
      ),
    ).toBe(true)
  })

  it('requires Origin and rejects a different loopback origin', () => {
    expect(isAllowedLaunchRequest(undefined, '127.0.0.1:3199', '127.0.0.1')).toBe(false)
    expect(
      isAllowedLaunchRequest('http://localhost:3199', '127.0.0.1:3199', '127.0.0.1'),
    ).toBe(false)
    expect(
      isAllowedLaunchRequest('http://127.0.0.1:3200', '127.0.0.1:3199', '127.0.0.1'),
    ).toBe(false)
  })

  it('rejects a non-loopback host or socket address', () => {
    expect(
      isAllowedLaunchRequest('http://evil.example:3199', 'evil.example:3199', '127.0.0.1'),
    ).toBe(false)
    expect(
      isAllowedLaunchRequest(
        'http://127.0.0.1:3199',
        '127.0.0.1:3199',
        '203.0.113.7',
      ),
    ).toBe(false)
  })
})


describe('route handler integration', () => {
  it('runs the Git probe before returning the fixed spike response', async () => {
    let calls = 0
    const route = routeAt(
      sciforkRoutes({
        gitProbe: async () => {
          calls += 1
          return true
        },
      }),
      ROUTE_SPIKE,
    )
    const response = await invokeRoute(route)
    expect(calls).toBe(1)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, stage: 'm0' })
  })

  it('returns the same path-free 503 when the Git probe is false or throws', async () => {
    const falseRoute = routeAt(
      sciforkRoutes({ gitProbe: async () => false }),
      ROUTE_SPIKE,
    )
    const throwRoute = routeAt(
      sciforkRoutes({
        gitProbe: async () => {
          throw new Error('git failed under E:\\secret\\research-project')
        },
      }),
      ROUTE_SPIKE,
    )
    const [falseResponse, throwResponse] = await Promise.all([
      invokeRoute(falseRoute),
      invokeRoute(throwRoute),
    ])
    expect(falseResponse.status).toBe(503)
    expect(throwResponse.status).toBe(503)
    expect(throwResponse.body).toBe(falseResponse.body)
    expect(falseResponse.body).toBe(
      '{"code":"GIT_PROBE_FAILED","message":"Git probe unavailable"}',
    )
    expect(throwResponse.body).not.toContain('secret')
  })

  it.each(['application/json', 'Application/JSON', 'application/json; charset=utf-8'])(
    'accepts the exact JSON media type: %s',
    async (contentType) => {
      const route = routeAt(
        sciforkRoutes({ gitProbe: async () => true }),
        ROUTE_LAUNCH,
      )
      const response = await invokeRoute(route, {
        method: 'POST',
        headers: (port) => launchHeaders(port, contentType),
        body: JSON.stringify({ sessionId: 's1' }),
      })
      expect(response.status).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ url: '/scifork/' })
    },
  )

  it('rejects a JSON prefix that is not the application/json media type', async () => {
    const route = routeAt(
      sciforkRoutes({ gitProbe: async () => true }),
      ROUTE_LAUNCH,
    )
    const response = await invokeRoute(route, {
      method: 'POST',
      headers: (port) => launchHeaders(port, 'application/jsonp'),
      body: JSON.stringify({ sessionId: 's1' }),
    })
    expect(response.status).toBe(415)
  })

  it('requires exact Origin/Host equality in the complete launch handler', async () => {
    const route = routeAt(
      sciforkRoutes({ gitProbe: async () => true }),
      ROUTE_LAUNCH,
    )
    const missingOrigin = await invokeRoute(route, {
      method: 'POST',
      headers: (port) => ({
        host: '127.0.0.1:' + port,
        'content-type': 'application/json',
      }),
      body: JSON.stringify({ sessionId: 's1' }),
    })
    const differentOrigin = await invokeRoute(route, {
      method: 'POST',
      headers: (port) => ({
        ...launchHeaders(port),
        origin: 'http://localhost:' + port,
      }),
      body: JSON.stringify({ sessionId: 's1' }),
    })
    expect(missingOrigin.status).toBe(403)
    expect(differentOrigin.status).toBe(403)
  })

  it('rejects a non-loopback socket even when Origin and Host match', async () => {
    const route = routeAt(
      sciforkRoutes({ gitProbe: async () => true }),
      ROUTE_LAUNCH,
    )
    const response = await invokeRoute(route, {
      method: 'POST',
      headers: (port) => launchHeaders(port),
      body: JSON.stringify({ sessionId: 's1' }),
      remoteAddress: '203.0.113.7',
    })
    expect(response.status).toBe(403)
  })

  it('returns a JSON 413 without resetting the socket for an oversized body', async () => {
    const route = routeAt(
      sciforkRoutes({ gitProbe: async () => true }),
      ROUTE_LAUNCH,
    )
    const response = await invokeRoute(route, {
      method: 'POST',
      headers: (port) => launchHeaders(port),
      body: JSON.stringify({ sessionId: 's1', blob: 'x'.repeat(JSON_BODY_LIMIT) }),
    })
    expect(response.status).toBe(413)
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(response.body)).toEqual({
      code: 'BODY_TOO_LARGE',
      message: 'request body exceeds the size limit',
    })
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
