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
vi.mock('../../src/capabilities/places/resolve-google-place', () => ({
  resolveGooglePlace: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../src/capabilities/places/duplicate-check', () => ({
  checkDuplicate: vi.fn().mockResolvedValue({ found: false }),
  writeDedupKV: vi.fn().mockResolvedValue(undefined),
}))

import { runFlowD } from '../../src/capabilities/places/flow-d-instagram'
import { PlacesError } from '../../src/capabilities/places/errors'
import { extractFromHtml } from '../../src/capabilities/places/extract'
import { createPlace } from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'
import { resolveGooglePlace } from '../../src/capabilities/places/resolve-google-place'
import { checkDuplicate } from '../../src/capabilities/places/duplicate-check'
import { SAMPLE_PLACE } from '../fixtures/places'

const mockResolve = vi.mocked(resolveGooglePlace)
const mockCheckDuplicate = vi.mocked(checkDuplicate)

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

const IG_URL = 'https://www.instagram.com/reel/ABC123/'
const NOTION_RESULT = { notion_page_id: 'page-abc', url: 'https://www.notion.so/page-abc' }

const RICH_OG_DESCRIPTION = '台北兒童新樂園，適合2-10歲的小朋友，週末記得早點來才不用排太久！室內室外都有設施，超級好玩。'
const HTML_WITH_OG = `<html><head>
  <meta property="og:description" content="${RICH_OG_DESCRIPTION}" />
  <meta property="og:title" content="兒童新樂園" />
</head><body></body></html>`

function makeFetchResponse(body: string, ok = true, status = 200) {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  vi.clearAllMocks()
  mockResolve.mockResolvedValue(null)
  mockCheckDuplicate.mockResolvedValue({ found: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runFlowD — happy path (OG description rich enough)', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(HTML_WITH_OG) as unknown as Response)
    mockExtract.mockResolvedValue(SAMPLE_PLACE)
    mockCreate.mockResolvedValue(NOTION_RESULT)
  })

  it('fetches with facebookexternalhit User-Agent', async () => {
    await runFlowD(IG_URL, 'reply-token', mockEnv)

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      IG_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': expect.stringContaining('facebookexternalhit') }),
      }),
    )
  })

  it('extracts og:description and passes to Claude', async () => {
    await runFlowD(IG_URL, 'reply-token', mockEnv)

    expect(mockExtract).toHaveBeenCalledWith(IG_URL, RICH_OG_DESCRIPTION, mockEnv)
  })

  it('creates Notion entry and sends flex reply', async () => {
    await runFlowD(IG_URL, 'reply-token', mockEnv)

    expect(mockCreate).toHaveBeenCalledOnce()
    expect(mockReply).toHaveBeenCalledOnce()
    expect(mockReply.mock.calls[0][1][0].type).toBe('flex')
  })

  it('writes raw extraction to KV', async () => {
    await runFlowD(IG_URL, 'reply-token', mockEnv)

    const kvPut = (mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(
      expect.stringMatching(/^place:.+:raw$/),
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    )
  })
})

describe('runFlowD — Google resolve + dedup', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(HTML_WITH_OG) as unknown as Response)
    mockExtract.mockResolvedValue(SAMPLE_PLACE)
    mockCreate.mockResolvedValue(NOTION_RESULT)
  })

  it('sends dedup card and returns early when duplicate found', async () => {
    mockResolve.mockResolvedValue({ google_place_id: 'ChIJig', lat: null, lng: null, address: null })
    mockCheckDuplicate.mockResolvedValue({ found: true, notion_page_id: 'p1', internal_id: 'i1', name: '兒童新樂園' })

    await runFlowD(IG_URL, 'reply-token', mockEnv)

    expect(mockCreate).not.toHaveBeenCalled()
    const reply = mockReply.mock.calls[0][1][0]
    expect(reply.type).toBe('flex')
  })
})

describe('runFlowD — fallback paths', () => {
  it('sends fallback text when og:description is too short', async () => {
    const shortHtml = '<html><head><meta property="og:description" content="短" /></head></html>'
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(shortHtml) as unknown as Response)

    await runFlowD(IG_URL, 'reply-token', mockEnv)

    expect(mockExtract).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    const reply = mockReply.mock.calls[0][1][0]
    expect(reply.type).toBe('text')
    expect((reply as { type: string; text: string }).text).toContain('IG 連結我目前還沒辦法')
  })

  it('sends fallback when og:description is absent', async () => {
    const noOgHtml = '<html><head><title>IG post</title></head><body></body></html>'
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(noOgHtml) as unknown as Response)

    await runFlowD(IG_URL, 'reply-token', mockEnv)

    expect(mockExtract).not.toHaveBeenCalled()
    const reply = mockReply.mock.calls[0][1][0]
    expect(reply.type).toBe('text')
  })

  it('sends fallback when fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network timeout'))

    await runFlowD(IG_URL, 'reply-token', mockEnv)

    expect(mockExtract).not.toHaveBeenCalled()
    const reply = mockReply.mock.calls[0][1][0]
    expect(reply.type).toBe('text')
  })

  it('sends fallback when Claude extraction fails', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(HTML_WITH_OG) as unknown as Response)
    mockExtract.mockRejectedValue(new Error('claude error'))

    await runFlowD(IG_URL, 'reply-token', mockEnv)

    expect(mockCreate).not.toHaveBeenCalled()
    const reply = mockReply.mock.calls[0][1][0]
    expect(reply.type).toBe('text')
  })

  it('throws PlacesError when Notion write fails after successful extraction', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(HTML_WITH_OG) as unknown as Response)
    mockExtract.mockResolvedValue(SAMPLE_PLACE)
    mockCreate.mockRejectedValue(new Error('Notion 503'))

    const err = await runFlowD(IG_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('寫入 Notion 失敗')
  })

  it('does not throw when KV write fails (best-effort)', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(HTML_WITH_OG) as unknown as Response)
    mockExtract.mockResolvedValue(SAMPLE_PLACE)
    mockCreate.mockResolvedValue(NOTION_RESULT)
    ;(mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put.mockRejectedValueOnce(new Error('KV error'))

    await expect(runFlowD(IG_URL, 'reply-token', mockEnv)).resolves.toBeUndefined()
    expect(mockReply).toHaveBeenCalledOnce()
  })
})
