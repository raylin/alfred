import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/capabilities/places/extract', () => ({
  extractFromImage: vi.fn(),
  NoPlaceDetectedError: class NoPlaceDetectedError extends Error {
    constructor() { super('no_place_detected'); this.name = 'NoPlaceDetectedError' }
  },
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

import { runFlowImage } from '../../src/capabilities/places/flow-image'
import { PlacesError } from '../../src/capabilities/places/errors'
import { extractFromImage, NoPlaceDetectedError } from '../../src/capabilities/places/extract'
import { createPlace } from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'
import { resolveGooglePlace } from '../../src/capabilities/places/resolve-google-place'
import { checkDuplicate } from '../../src/capabilities/places/duplicate-check'
import { SAMPLE_PLACE } from '../fixtures/places'

const mockResolve = vi.mocked(resolveGooglePlace)
const mockCheckDuplicate = vi.mocked(checkDuplicate)

const mockExtract = vi.mocked(extractFromImage)
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

const NOTION_RESULT = { notion_page_id: 'page-abc', url: 'https://www.notion.so/page-abc' }
const IMAGE_INPUT = {
  contentBase64: 'aGVsbG8=',
  mimeType: 'image/jpeg',
  sizeBytes: 100_000,
  lineMessageId: 'msg-123',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExtract.mockResolvedValue(SAMPLE_PLACE)
  mockCreate.mockResolvedValue(NOTION_RESULT)
  mockResolve.mockResolvedValue(null)
  mockCheckDuplicate.mockResolvedValue({ found: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runFlowImage — happy path', () => {
  it('extracts, writes to Notion, and sends flex reply', async () => {
    await runFlowImage(IMAGE_INPUT, 'reply-token', mockEnv)

    expect(mockExtract).toHaveBeenCalledWith('aGVsbG8=', 'image/jpeg', mockEnv)
    expect(mockCreate).toHaveBeenCalledOnce()
    expect(mockReply).toHaveBeenCalledOnce()
    expect(mockReply.mock.calls[0][1][0].type).toBe('flex')
  })

  it('writes raw KV entry with metadata but NOT base64 image body', async () => {
    await runFlowImage(IMAGE_INPUT, 'reply-token', mockEnv)

    const kvPut = (mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    const rawCall = kvPut.mock.calls.find((c: unknown[]) => (c[0] as string).endsWith(':raw'))
    expect(rawCall).toBeDefined()
    const storedJson = rawCall![1] as string
    expect(storedJson).toContain('msg-123')
    expect(storedJson).not.toContain('aGVsbG8=')
  })

  it('writes user:last_place KV when userId and chatId provided', async () => {
    await runFlowImage(IMAGE_INPUT, 'reply-token', mockEnv, 'U001', 'C001')

    const kvPut = (mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(
      'user:U001:last_place',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 24 * 60 * 60 }),
    )
  })
})

describe('runFlowImage — Google resolve + dedup', () => {
  it('sends dedup card and returns early when duplicate found', async () => {
    mockResolve.mockResolvedValue({ google_place_id: 'ChIJimg', lat: null, lng: null, address: null })
    mockCheckDuplicate.mockResolvedValue({ found: true, notion_page_id: 'p1', internal_id: 'i1', name: '兒童新樂園' })

    await runFlowImage(IMAGE_INPUT, 'reply-token', mockEnv)

    expect(mockCreate).not.toHaveBeenCalled()
    const reply = mockReply.mock.calls[0][1][0]
    expect(reply.type).toBe('flex')
  })

  it('merges resolved address into place when resolve succeeds', async () => {
    mockResolve.mockResolvedValue({ google_place_id: 'ChIJimg', lat: 25.0, lng: 121.5, address: '台北市士林區' })

    await runFlowImage(IMAGE_INPUT, 'reply-token', mockEnv)

    const written = mockCreate.mock.calls[0][0]
    expect(written.google_place_id).toBe('ChIJimg')
    expect(written.address).toBe('台北市士林區')
  })
})

describe('runFlowImage — size gate', () => {
  it('sends size-too-large message for images > 5MB', async () => {
    const bigImage = { ...IMAGE_INPUT, sizeBytes: 5 * 1024 * 1024 + 1 }

    await runFlowImage(bigImage, 'reply-token', mockEnv)

    expect(mockExtract).not.toHaveBeenCalled()
    const reply = mockReply.mock.calls[0][1][0]
    expect(reply.type).toBe('text')
    expect((reply as { type: string; text: string }).text).toContain('圖片太大了')
  })

  it('allows images at exactly 5MB', async () => {
    const exactImage = { ...IMAGE_INPUT, sizeBytes: 5 * 1024 * 1024 }

    await runFlowImage(exactImage, 'reply-token', mockEnv)

    expect(mockExtract).toHaveBeenCalledOnce()
  })
})

describe('runFlowImage — no_place_detected', () => {
  it('sends not-a-place message when extraction returns no_place_detected', async () => {
    mockExtract.mockRejectedValue(new NoPlaceDetectedError())

    await runFlowImage(IMAGE_INPUT, 'reply-token', mockEnv)

    expect(mockCreate).not.toHaveBeenCalled()
    const reply = mockReply.mock.calls[0][1][0]
    expect(reply.type).toBe('text')
    expect((reply as { type: string; text: string }).text).toContain('不是景點相關的圖')
  })
})

describe('runFlowImage — error handling', () => {
  it('throws PlacesError when extraction fails with non-place error', async () => {
    mockExtract.mockRejectedValue(new Error('claude API error'))

    const err = await runFlowImage(IMAGE_INPUT, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('整理時遇到狀況')
  })

  it('throws PlacesError when Notion write fails', async () => {
    mockCreate.mockRejectedValue(new Error('Notion 503'))

    const err = await runFlowImage(IMAGE_INPUT, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('寫入 Notion 失敗')
  })

  it('does not throw when KV write fails (best-effort)', async () => {
    ;(mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put.mockRejectedValueOnce(new Error('KV error'))

    await expect(runFlowImage(IMAGE_INPUT, 'reply-token', mockEnv)).resolves.toBeUndefined()
    expect(mockReply).toHaveBeenCalledOnce()
  })
})
