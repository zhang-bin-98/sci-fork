import { describe, expect, it, vi } from 'vitest'
import {
  CompanionApiClient,
  CompanionApiError,
} from '../../src/companion/api.js'

const PAGE_KEY = 'K'.repeat(43)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Companion API client', () => {
  it('sends the Page Key only in the header and uses strict endpoint bodies', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          unchanged: true,
          project: {
            revision: 'revision-a',
            readOnly: false,
            diagnosticCount: 0,
            diagnostics: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          entity: {
            id: 'node_a',
            type: 'node',
            kind: 'hypothesis',
            confidence: 'low',
            evidenceRefs: [],
            publicationCount: 0,
            machineReviewedEvidenceCount: 0,
            humanReviewedEvidenceCount: 0,
            body: '# Hypothesis',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          focus: { focusEntityId: 'node_a', pathIds: [] },
        }),
      )
    const api = new CompanionApiClient({ pageKey: PAGE_KEY, fetch })

    await api.snapshot('revision-a')
    await api.entity('node_a')
    await api.setFocus('node_a')

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/scifork/api/snapshot',
      '/scifork/api/entity',
      '/scifork/api/focus',
    ])
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { sinceProjectRevision: 'revision-a' },
      { entityId: 'node_a' },
      { entityId: 'node_a' },
    ])
    for (const [url, init] of fetch.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(init?.method).toBe('POST')
      expect(headers.get('content-type')).toBe('application/json')
      expect(headers.get('X-SciFork-Page-Key')).toBe(PAGE_KEY)
      expect(String(url)).not.toContain(PAGE_KEY)
      expect(String(init?.body)).not.toContain(PAGE_KEY)
    }
  })

  it('maps an invalid-key response, clears the stored key through one callback, and exposes no key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          code: 'PAGE_KEY_INVALID',
          message: 'Reopen the Companion from DSH.',
          recoverable: true,
        },
        401,
      ),
    )
    const onPageKeyInvalid = vi.fn()
    const api = new CompanionApiClient({ pageKey: PAGE_KEY, fetch, onPageKeyInvalid })

    const error = await api.snapshot().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CompanionApiError)
    expect(error).toMatchObject({
      code: 'PAGE_KEY_INVALID',
      message: 'Reopen the Companion from DSH.',
    })
    expect(String(error)).not.toContain(PAGE_KEY)
    expect(onPageKeyInvalid).toHaveBeenCalledOnce()
  })
})
