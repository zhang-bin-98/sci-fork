import type { Readable } from 'node:stream'
import type { ServerResponse } from 'node:http'
import { COMPANION_URL, ROUTE_LAUNCH, ROUTE_SPIKE } from '../shared/routes.js'
import type { WebRoute } from './contracts.js'

export { COMPANION_URL, ROUTE_LAUNCH, ROUTE_SPIKE }

/** Upper bound for JSON API request bodies. */
export const JSON_BODY_LIMIT = 64 * 1024
export interface SciforkRouteDependencies {
  gitProbe(): Promise<boolean>
}


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

/** Socket peer addresses must be numeric loopback addresses. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.toLowerCase()
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '::ffff:127.0.0.1'
  )
}

/** An Origin header is acceptable only when it names an HTTP(S) loopback host. */
export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const parsed = new URL(origin)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      isLoopbackHost(parsed.host)
    )
  } catch {
    return false
  }
}

/**
 * Launch requests require all three boundaries: a loopback Host, a numeric
 * loopback socket peer, and a mandatory HTTP Origin that exactly matches Host.
 */
export function isAllowedLaunchRequest(
  origin: string | undefined,
  host: string | undefined,
  remoteAddress: string | undefined,
): boolean {
  if (!origin || !host || !isLoopbackHost(host) || !isLoopbackAddress(remoteAddress)) {
    return false
  }
  try {
    const parsed = new URL(origin)
    const expectedOrigin = new URL('http://' + host).origin
    return (
      parsed.protocol === 'http:' &&
      parsed.origin === expectedOrigin &&
      origin.toLowerCase() === parsed.origin.toLowerCase()
    )
  } catch {
    return false
  }
}

/** Match the application/json media type exactly, case-insensitively. */
export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false
  const separator = contentType.indexOf(';')
  const mediaType = (separator === -1 ? contentType : contentType.slice(0, separator)).trim()
  return mediaType.toLowerCase() === 'application/json'
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
 * Collect a request body up to limit bytes and parse it as JSON. On overflow,
 * reject immediately while keeping a data listener attached to discard the
 * remaining body; the handler can send 413 without first destroying the socket.
 */
export function readJsonBody(req: Readable, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false

    const cleanup = (): void => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('close', onClose)
    }
    const onData = (chunk: unknown): void => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string'
          ? Buffer.from(chunk)
          : Buffer.from(chunk as Uint8Array)
      total += buffer.length
      if (total > limit) {
        settled = true
        chunks.length = 0
        reject(new ApiError(413, 'BODY_TOO_LARGE', 'request body exceeds the size limit'))
        return
      }
      chunks.push(buffer)
    }
    const onEnd = (): void => {
      cleanup()
      if (settled) return
      settled = true
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new ApiError(400, 'INVALID_JSON', 'request body is not valid JSON'))
      }
    }
    const onError = (): void => {
      cleanup()
      if (settled) return
      settled = true
      reject(new ApiError(400, 'BODY_READ_FAILED', 'request body could not be read'))
    }
    const onClose = (): void => {
      cleanup()
      if (settled) return
      settled = true
      reject(new ApiError(400, 'INCOMPLETE_BODY', 'request body ended unexpectedly'))
    }

    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
    req.once('close', onClose)
  })
}

/** Write one JSON response with the standard content type. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function sendGitProbeUnavailable(res: ServerResponse): void {
  sendJson(res, 503, {
    code: 'GIT_PROBE_FAILED',
    message: 'Git probe unavailable',
  })
}

/** The M0 route table; handlers stay thin over the tested helpers. */
export function sciforkRoutes({
  gitProbe,
}: SciforkRouteDependencies): readonly WebRoute[] {
  return [
    {
      kind: 'exact',
      path: ROUTE_SPIKE,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'GET only' })
          return
        }
        try {
          if (!(await gitProbe())) {
            sendGitProbeUnavailable(res)
            return
          }
        } catch {
          sendGitProbeUnavailable(res)
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
        if (
          !isAllowedLaunchRequest(
            req.headers.origin,
            req.headers.host,
            req.socket.remoteAddress,
          )
        ) {
          sendJson(res, 403, {
            code: 'NOT_SAME_ORIGIN',
            message: 'loopback same-origin request required',
          })
          return
        }
        if (!isJsonContentType(req.headers['content-type'])) {
          sendJson(res, 415, { code: 'UNSUPPORTED_MEDIA', message: 'JSON body required' })
          return
        }
        try {
          const body = await readJsonBody(req, JSON_BODY_LIMIT)
          if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            sendJson(res, 400, { code: 'INVALID_REQUEST', message: 'sessionId required' })
            return
          }
          const sessionId = (body as Record<string, unknown>).sessionId
          if (typeof sessionId !== 'string' || !sessionId) {
            sendJson(res, 400, { code: 'INVALID_REQUEST', message: 'sessionId required' })
            return
          }
          // M0 spike: fixed URL. M2 replaces this with a 256-bit Page Key
          // bound to the session, delivered via the fragment handshake.
          sendJson(res, 200, { url: COMPANION_URL })
        } catch (error) {
          const apiError =
            error instanceof ApiError
              ? error
              : new ApiError(400, 'BAD_REQUEST', 'request body could not be read')
          sendJson(res, apiError.status, {
            code: apiError.code,
            message: apiError.message,
          })
        }
      },
    },
  ]
}
