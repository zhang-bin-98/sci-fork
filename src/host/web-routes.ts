import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'
import type { CompanionFailure } from '../shared/companion-contract.js'
import { isPageKey } from '../shared/page-key.js'
import {
  ROUTE_COMPANION,
  ROUTE_ENTITY,
  ROUTE_FOCUS,
  ROUTE_LAUNCH,
  ROUTE_SNAPSHOT,
} from '../shared/routes.js'
import type { CompanionApiPort } from './companion-service.js'
import type { WebRoute } from './contracts.js'

/** Upper bound for all Companion JSON request bodies. */
export const JSON_BODY_LIMIT = 64 * 1024
export const PAGE_KEY_HEADER = 'x-scifork-page-key'

export const COMPANION_ASSET_MANIFEST = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'styles.css': 'text/css; charset=utf-8',
} as const

export type CompanionAssetName = keyof typeof COMPANION_ASSET_MANIFEST

export interface CompanionAssets {
  read(name: CompanionAssetName): Uint8Array
}

export const STATIC_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export interface SciforkRouteDependencies {
  api: CompanionApiPort
  assets: CompanionAssets
}

interface AdmittedJsonRequest {
  body: unknown
  pageKey?: string
}

interface LaunchRequest {
  sessionId: string
}

interface SnapshotRequest {
  sinceProjectRevision?: string
}

interface EntityRequest {
  entityId: string
}

type RouteApiResponse = { readonly ok: true } | CompanionFailure

const STATIC_PATHS: Readonly<Record<string, CompanionAssetName>> = {
  [ROUTE_COMPANION]: 'index.html',
  [`${ROUTE_COMPANION}/`]: 'index.html',
  [`${ROUTE_COMPANION}/index.html`]: 'index.html',
  [`${ROUTE_COMPANION}/app.js`]: 'app.js',
  [`${ROUTE_COMPANION}/styles.css`]: 'styles.css',
}

const PAGE_KEY_INVALID: CompanionFailure = {
  ok: false,
  code: 'PAGE_KEY_INVALID',
  message: 'Reopen the Companion from DSH.',
  recoverable: true,
}

/** Registered route paths must be absolute and carry no trailing slash. */
export function isAbsoluteNoTrailingSlash(path: string): boolean {
  return path.startsWith('/') && path.length > 1 && !path.endsWith('/')
}

function isValidPort(value: string | undefined): boolean {
  if (value === undefined || value.length === 0) return true
  if (!/^\d+$/u.test(value)) return false
  return Number(value) <= 65_535
}

/** Accept only the loopback Host spellings supported by the pinned DSH server. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false
  const normalized = host.toLowerCase()
  if (normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1') {
    return true
  }
  const ipv4OrName = /^(127\.0\.0\.1|localhost):(\d+)$/u.exec(normalized)
  if (ipv4OrName !== null) return isValidPort(ipv4OrName[2])
  const ipv6 = /^\[::1\](?::(\d+))?$/u.exec(normalized)
  return ipv6 !== null && isValidPort(ipv6[1])
}

/** Socket peers must be numeric loopback addresses; hostnames are not resolved. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.toLowerCase()
  return (
    normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1'
  )
}

/** Require a numeric loopback peer and an HTTP Origin exactly matching Host. */
export function isAllowedJsonRequest(
  origin: string | undefined,
  host: string | undefined,
  remoteAddress: string | undefined,
): boolean {
  if (!origin || !host || !isLoopbackHost(host) || !isLoopbackAddress(remoteAddress)) {
    return false
  }
  try {
    const parsed = new URL(origin)
    const expectedOrigin = new URL(`http://${host}`).origin
    return (
      parsed.protocol === 'http:'
      && parsed.origin === expectedOrigin
      && origin.toLowerCase() === parsed.origin.toLowerCase()
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

/** Bounded protocol error used while reading request bodies. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Read and parse a JSON body while enforcing its byte limit. */
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
      total += buffer.byteLength
      if (total > limit) {
        settled = true
        chunks.length = 0
        reject(new ApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds the size limit.'))
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
        reject(new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON.'))
      }
    }
    const onError = (): void => {
      cleanup()
      if (settled) return
      settled = true
      reject(new ApiError(400, 'BODY_READ_FAILED', 'Request body could not be read.'))
    }
    const onClose = (): void => {
      cleanup()
      if (settled) return
      settled = true
      reject(new ApiError(400, 'INCOMPLETE_BODY', 'Request body ended unexpectedly.'))
    }

    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
    req.once('close', onClose)
  })
}

/** Write one bounded JSON response with the common API hardening headers. */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(encoded)
}

function protocolFailure(code: string, message: string, recoverable = true): CompanionFailure {
  return { ok: false, code, message, recoverable }
}

function sendPageKeyInvalid(res: ServerResponse): void {
  sendJson(res, 401, PAGE_KEY_INVALID)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key))
}

function parseLaunchRequest(value: unknown): LaunchRequest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['sessionId'])) return undefined
  return typeof value.sessionId === 'string' && value.sessionId.length > 0
    ? { sessionId: value.sessionId }
    : undefined
}

function parseSnapshotRequest(value: unknown): SnapshotRequest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, [], ['sinceProjectRevision'])) {
    return undefined
  }
  if (value.sinceProjectRevision === undefined) return {}
  return typeof value.sinceProjectRevision === 'string'
    ? { sinceProjectRevision: value.sinceProjectRevision }
    : undefined
}

function parseEntityRequest(value: unknown): EntityRequest | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['entityId'])) return undefined
  return typeof value.entityId === 'string' && value.entityId.length > 0
    ? { entityId: value.entityId }
    : undefined
}

async function admitJsonRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedPath: string,
  pageKeyRequired: boolean,
): Promise<AdmittedJsonRequest | undefined> {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    sendJson(res, 405, protocolFailure('METHOD_NOT_ALLOWED', 'POST is required.'))
    return undefined
  }
  if (!isAllowedJsonRequest(req.headers.origin, req.headers.host, req.socket.remoteAddress)) {
    sendJson(res, 403, protocolFailure('NOT_SAME_ORIGIN', 'A loopback same-origin request is required.'))
    return undefined
  }
  if (!isJsonContentType(req.headers['content-type'])) {
    sendJson(res, 415, protocolFailure('UNSUPPORTED_MEDIA', 'An application/json body is required.'))
    return undefined
  }

  let pageKey: string | undefined
  if (pageKeyRequired) {
    const header = req.headers[PAGE_KEY_HEADER]
    if (!isPageKey(header)) {
      sendPageKeyInvalid(res)
      return undefined
    }
    pageKey = header
  }

  if (req.url !== expectedPath) {
    sendJson(res, 400, protocolFailure('INVALID_REQUEST', 'The request target is invalid.'))
    return undefined
  }

  try {
    const body = await readJsonBody(req, JSON_BODY_LIMIT)
    return pageKey === undefined ? { body } : { body, pageKey }
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(400, 'BAD_REQUEST', 'Request body could not be read.')
    sendJson(res, apiError.status, protocolFailure(apiError.code, apiError.message))
    return undefined
  }
}

async function sendApiResult(
  res: ServerResponse,
  execute: () => Promise<RouteApiResponse>,
): Promise<void> {
  try {
    const result = await execute()
    if (!result.ok && result.code === 'PAGE_KEY_INVALID') {
      sendPageKeyInvalid(res)
      return
    }
    sendJson(res, 200, result)
  } catch {
    sendJson(
      res,
      500,
      protocolFailure('INTERNAL_ERROR', 'The Companion request could not be completed.'),
    )
  }
}

function setStaticHeaders(res: ServerResponse): void {
  res.setHeader('content-security-policy', STATIC_CONTENT_SECURITY_POLICY)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('cache-control', 'no-store')
}

function sendStaticError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end(message)
}

function staticHandler(assets: CompanionAssets): WebRoute['handler'] {
  return (req, res) => {
    setStaticHeaders(res)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD')
      sendStaticError(res, 405, 'Method not allowed.')
      return
    }
    if (!isLoopbackHost(req.headers.host) || !isLoopbackAddress(req.socket.remoteAddress)) {
      sendStaticError(res, 403, 'Loopback access is required.')
      return
    }

    const target = req.url
    if (target === `${ROUTE_COMPANION}/`) {
      res.statusCode = 308
      res.setHeader('location', ROUTE_COMPANION)
      res.end()
      return
    }
    if (target === undefined || target.includes('?') || target.includes('#') || target.includes('%')) {
      sendStaticError(res, 404, 'Asset not found.')
      return
    }
    const assetName = STATIC_PATHS[target]
    if (assetName === undefined) {
      sendStaticError(res, 404, 'Asset not found.')
      return
    }

    let body: Uint8Array
    try {
      body = assets.read(assetName)
    } catch {
      sendStaticError(res, 503, 'Companion assets are unavailable.')
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', COMPANION_ASSET_MANIFEST[assetName])
    res.setHeader('content-length', body.byteLength)
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}

/** M2 static shell and JSON API route table. */
export function sciforkRoutes({ api, assets }: SciforkRouteDependencies): readonly WebRoute[] {
  return [
    {
      kind: 'prefix',
      path: ROUTE_COMPANION,
      handler: staticHandler(assets),
    },
    {
      kind: 'exact',
      path: ROUTE_LAUNCH,
      handler: async (req, res) => {
        const admitted = await admitJsonRequest(req, res, ROUTE_LAUNCH, false)
        if (admitted === undefined) return
        const body = parseLaunchRequest(admitted.body)
        if (body === undefined) {
          sendJson(res, 400, protocolFailure('INVALID_REQUEST', 'A valid sessionId is required.'))
          return
        }
        await sendApiResult(res, () => api.launch(body.sessionId))
      },
    },
    {
      kind: 'exact',
      path: ROUTE_SNAPSHOT,
      handler: async (req, res) => {
        const admitted = await admitJsonRequest(req, res, ROUTE_SNAPSHOT, true)
        if (admitted === undefined || admitted.pageKey === undefined) return
        const body = parseSnapshotRequest(admitted.body)
        if (body === undefined) {
          sendJson(res, 400, protocolFailure('INVALID_REQUEST', 'The snapshot request is invalid.'))
          return
        }
        const { pageKey } = admitted
        await sendApiResult(res, () => api.snapshot(pageKey, body.sinceProjectRevision))
      },
    },
    {
      kind: 'exact',
      path: ROUTE_ENTITY,
      handler: async (req, res) => {
        const admitted = await admitJsonRequest(req, res, ROUTE_ENTITY, true)
        if (admitted === undefined || admitted.pageKey === undefined) return
        const body = parseEntityRequest(admitted.body)
        if (body === undefined) {
          sendJson(res, 400, protocolFailure('INVALID_REQUEST', 'A valid entityId is required.'))
          return
        }
        const { pageKey } = admitted
        await sendApiResult(res, () => api.entity(pageKey, body.entityId))
      },
    },
    {
      kind: 'exact',
      path: ROUTE_FOCUS,
      handler: async (req, res) => {
        const admitted = await admitJsonRequest(req, res, ROUTE_FOCUS, true)
        if (admitted === undefined || admitted.pageKey === undefined) return
        const body = parseEntityRequest(admitted.body)
        if (body === undefined) {
          sendJson(res, 400, protocolFailure('INVALID_REQUEST', 'A valid entityId is required.'))
          return
        }
        const { pageKey } = admitted
        await sendApiResult(res, () => api.setFocus(pageKey, body.entityId))
      },
    },
  ]
}
