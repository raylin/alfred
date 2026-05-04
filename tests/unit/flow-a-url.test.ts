import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/capabilities/places/extract', () => ({
  extractFromHtml: vi.fn(),
}))
vi.mock('../../src/integrations/notion', () => ({
  createPlace: vi.fn(),
}))
vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))

import { runFlowA } from '../../src/capabilities/places/flow-a-url'
import { PlacesError } from '../../src/capabilities/places/errors'
import { extractFromHtml } from '../../src/capabilities/places/extract'
import { createPlace } from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'
import { SAMPLE_PLACE } from '../fixtures/places'

const mockExtract = vi.mocked(extractFromHtml)
const mockCreate = vi.mocked(createPlace)
const mockReply = vi.mocked(sendReply)

const mockEnv = {
  ANTHROPIC_API_KEY: 'test',
  NOTION_TOKEN: 'test',
  NOTION_DB_ID: 'test',
  LINE_CHANNEL_ACCESS_TOKEN: 'test',
  ALFRED_KV: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
  },
} as unknown as Env

const BLOG_URL = 'https://mommytime.blog/taipei-kids'
const HTML_BODY = '<html><body><p>台北親子樂園介紹</p></body></html>'
const NOTION_RESULT = { notion_page_id: 'page-abc', url: 'https://www.notion.so/page-abc' }

function makeFetchResponse(body: string, ok = true, status = 200, contentType = 'text/html; charset=utf-8') {
  return {
    ok,
    status,
    headers: { get: (h: string) => h === 'content-type' ? contentType : null },
    text: () => Promise.resolve(body),
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runFlowA — happy path', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(HTML_BODY) as unknown as Response)
    mockExtract.mockResolvedValue(SAMPLE_PLACE)
    mockCreate.mockResolvedValue(NOTION_RESULT)
  })

  it('fetches the URL, extracts, creates in Notion, and replies', async () => {
    await runFlowA(BLOG_URL, 'reply-token', mockEnv)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      BLOG_URL,
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(mockExtract).toHaveBeenCalledOnce()
    expect(mockCreate).toHaveBeenCalledOnce()
    expect(mockReply).toHaveBeenCalledOnce()
  })

  it('passes URL and stripped text to extractFromHtml', async () => {
    await runFlowA(BLOG_URL, 'reply-token', mockEnv)

    const [url, text] = mockExtract.mock.calls[0]
    expect(url).toBe(BLOG_URL)
    expect(text).toContain('台北親子樂園介紹')
    expect(text).not.toContain('<p>')
  })

  it('sends a flex message in the reply', async () => {
    await runFlowA(BLOG_URL, 'reply-token', mockEnv)

    const messages = mockReply.mock.calls[0][1]
    expect(messages[0].type).toBe('flex')
  })

  it('writes to KV with correct key pattern', async () => {
    await runFlowA(BLOG_URL, 'reply-token', mockEnv)

    const kvPut = (mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(
      expect.stringMatching(/^place:.+:raw$/),
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    )
  })
})

describe('runFlowA — error handling', () => {
  it('throws PlacesError when fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('timeout'))

    await expect(runFlowA(BLOG_URL, 'reply-token', mockEnv)).rejects.toBeInstanceOf(PlacesError)
  })

  it('throws PlacesError with user-friendly message on non-HTML content-type', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse('...', true, 200, 'application/pdf') as unknown as Response,
    )

    const err = await runFlowA(BLOG_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('打不開')
  })

  it('throws PlacesError when extraction fails', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(HTML_BODY) as unknown as Response)
    mockExtract.mockRejectedValue(new Error('claude error'))

    const err = await runFlowA(BLOG_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('整理時遇到狀況')
  })

  it('throws PlacesError when Notion write fails', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(HTML_BODY) as unknown as Response)
    mockExtract.mockResolvedValue(SAMPLE_PLACE)
    mockCreate.mockRejectedValue(new Error('Notion 503'))

    const err = await runFlowA(BLOG_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('寫入 Notion 失敗')
  })

  it('does not throw when KV write fails (best-effort)', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(HTML_BODY) as unknown as Response)
    mockExtract.mockResolvedValue(SAMPLE_PLACE)
    mockCreate.mockResolvedValue(NOTION_RESULT)
    ;(mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put.mockRejectedValueOnce(new Error('KV error'))

    await expect(runFlowA(BLOG_URL, 'reply-token', mockEnv)).resolves.toBeUndefined()
    expect(mockReply).toHaveBeenCalledOnce()
  })
})
