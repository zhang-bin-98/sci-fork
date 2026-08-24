import type { Readable } from 'node:stream'
import type { ServerResponse } from 'node:http'
import { COMPANION_URL, ROUTE_LAUNCH, ROUTE_SPIKE } from '../shared/routes.js'
import type { WebRoute } from './contracts.js'

export { COMPANION_URL, ROUTE_LAUNCH, ROUTE_SPIKE }

/** Upper bound for JSON API request bodies. */
export const JSON_BODY_LIMIT = 64 * 1024

/** Registered route paths must be absolute and carry no trailing slash. */
export function isAbsoluteNoTrailingSlash(path: string): boolean {
  return path.startsWith('/') && path.length > 1 && !path.endsWith('/')
}

/**
 * v0.1 runs loopback-only. Accept the three loopback hostnames (with or
 * without port); reject everything else, including 0.0.0.0.
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false
  const normalized = host.toLowerCase()
  const name = normalized.startsWith('[')
    ? /^\[(.+)\](?::\d+)?$/.exec(normalized)?.[1] ?? ''
    : normalized.replace(/:\d+$/, '')
  return name === '127.0.0.1' || name === '::1' || name === 'localhost'
}

/** An Origin header is acceptable only when it names a loopback host. */
export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    return isLoopbackHost(new URL(origin).host)
  } catch {
    return false
  }
}

/** Bounded error used by the API handlers. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Collect a request body up to `limit` bytes and parse it as JSON. Oversized
 * or malformed bodies fail loudly; the request stream is destroyed on
 * overflow so the connection cannot linger.
 */
export async function readJsonBody(req: Readable, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    total += buffer.length
    if (total > limit) {
      req.destroy()
      throw new ApiError(413, 'BODY_TOO_LARGE', 'request body exceeds the size limit')
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'request body is not valid JSON')
  }
}

/** Write one JSON response with the standard content type. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/** The M0 route table; handlers stay thin over the tested pure helpers. */
export function sciforkRoutes(): readonly WebRoute[] {
  return [
    {
      kind: 'exact',
      path: ROUTE_SPIKE,
      handler: (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'GET only' })
          return
        }
        sendJson(res, 200, { ok: true, stage: 'm0' })
      },
    },
    {
      kind: 'exact',
      path: ROUTE_LAUNCH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'POST only' })
          return
        }
        if (!isLoopbackOrigin(req.headers.origin) && !isLoopbackHost(req.headers.host)) {
          sendJson(res, 403, { code: 'NOT_LOOPBACK', message: 'loopback only' })
          return
        }
        const contentType = req.headers['content-type'] ?? ''
        if (!contentType.startsWith('application/json')) {
          sendJson(res, 415, { code: 'UNSUPPORTED_MEDIA', message: 'JSON body required' })
          return
        }
        try {
          const body = (await readJsonBody(req, JSON_BODY_LIMIT)) as {
            sessionId?: unknown
          }
          if (typeof body.sessionId !== 'string' || !body.sessionId) {
            sendJson(res, 400, { code: 'INVALID_REQUEST', message: 'sessionId required' })
            return
          }
          // M0 spike: fixed URL. M2 replaces this with a 256-bit Page Key
          // bound to the session, delivered via the fragment handshake.
          sendJson(res, 200, { url: COMPANION_URL })
        } catch (error) {
          const apiError = error as ApiError
          sendJson(res, apiError.status ?? 400, {
            code: apiError.code ?? 'BAD_REQUEST',
            message: apiError.message,
          })
        }
      },
    },
  ]
}
