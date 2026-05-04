import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/google-places', () => ({
  parseGoogleMapsUrl: vi.fn(),
  getPlaceDetails: vi.fn(),
  textSearch: vi.fn(),
  toGooglePlacesContext: vi.fn(),
}))
vi.mock('../../src/capabilities/places/extract', () => ({
  extractFromGooglePlaces: vi.fn(),
}))
vi.mock('../../src/integrations/notion', () => ({
  createPlace: vi.fn(),
}))
vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/capabilities/places/duplicate-check', () => ({
  checkDuplicate: vi.fn().mockResolvedValue({ found: false }),
  writeDedupKV: vi.fn().mockResolvedValue(undefined),
}))

import { runFlowC } from '../../src/capabilities/places/flow-c-maps'
import { PlacesError } from '../../src/capabilities/places/errors'
import { parseGoogleMapsUrl, getPlaceDetails, textSearch, toGooglePlacesContext } from '../../src/integrations/google-places'
import { extractFromGooglePlaces } from '../../src/capabilities/places/extract'
import { createPlace } from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'
import { checkDuplicate, writeDedupKV } from '../../src/capabilities/places/duplicate-check'
import { SAMPLE_PLACE } from '../fixtures/places'

const mockParse = vi.mocked(parseGoogleMapsUrl)
const mockDetails = vi.mocked(getPlaceDetails)
const mockSearch = vi.mocked(textSearch)
const mockContext = vi.mocked(toGooglePlacesContext)
const mockExtract = vi.mocked(extractFromGooglePlaces)
const mockCreate = vi.mocked(createPlace)
const mockReply = vi.mocked(sendReply)
const mockCheckDuplicate = vi.mocked(checkDuplicate)
const mockWriteDedupKV = vi.mocked(writeDedupKV)

const mockEnv = {
  ANTHROPIC_API_KEY: 'test',
  NOTION_TOKEN: 'test',
  NOTION_DB_ID: 'test',
  LINE_CHANNEL_ACCESS_TOKEN: 'test',
  GOOGLE_PLACES_API_KEY: 'test',
  ALFRED_KV: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
  },
} as unknown as Env

const MAPS_URL = 'https://maps.app.goo.gl/abc'
const PARSED_WITH_ID = { place_id: 'ChIJabc', name: '兒童新樂園', lat: 25.09, lng: 121.52 }
const PARSED_NAME_ONLY = { name: '兒童新樂園' }
const CANDIDATE = { place_id: 'ChIJabc', name: '兒童新樂園', formatted_address: '台北市士林區', types: [] }
const DETAILS = {
  place_id: 'ChIJabc',
  name: '兒童新樂園',
  formatted_address: '台北市士林區承德路55號',
  types: ['amusement_park'],
  rating: 4.5,
  opening_hours: null,
  website: null,
  editorial_summary: null,
  lat: 25.09,
  lng: 121.52,
}
const NOTION_RESULT = { notion_page_id: 'page-abc', url: 'https://www.notion.so/page-abc' }
const CONTEXT = { name: '兒童新樂園', address: '台北市士林區', types: 'amusement_park', rating: 4.5, hours: null, website: null, editorialSummary: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockParse.mockResolvedValue(PARSED_WITH_ID)
  mockDetails.mockResolvedValue(DETAILS)
  mockSearch.mockResolvedValue([CANDIDATE])
  mockContext.mockReturnValue(CONTEXT)
  mockExtract.mockResolvedValue(SAMPLE_PLACE)
  mockCreate.mockResolvedValue(NOTION_RESULT)
  mockCheckDuplicate.mockResolvedValue({ found: false })
  mockWriteDedupKV.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runFlowC — happy path (place_id found)', () => {
  it('parses URL, gets details by place_id, extracts, writes Notion, replies', async () => {
    await runFlowC(MAPS_URL, 'reply-token', mockEnv)

    expect(mockParse).toHaveBeenCalledWith(MAPS_URL)
    expect(mockDetails).toHaveBeenCalledWith('ChIJabc', mockEnv)
    expect(mockSearch).not.toHaveBeenCalled()
    expect(mockExtract).toHaveBeenCalledOnce()
    expect(mockCreate).toHaveBeenCalledOnce()
    expect(mockReply).toHaveBeenCalledOnce()
  })

  it('sends a flex message in the reply', async () => {
    await runFlowC(MAPS_URL, 'reply-token', mockEnv)

    expect(mockReply.mock.calls[0][1][0].type).toBe('flex')
  })

  it('merges google_place_id, lat, lng from details', async () => {
    await runFlowC(MAPS_URL, 'reply-token', mockEnv)

    const placeArg = mockCreate.mock.calls[0][0]
    expect(placeArg.google_place_id).toBe('ChIJabc')
    expect(placeArg.latitude).toBe(25.09)
    expect(placeArg.longitude).toBe(121.52)
  })

  it('writes to KV with place:{id}:raw', async () => {
    await runFlowC(MAPS_URL, 'reply-token', mockEnv)

    const kvPut = (mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(
      expect.stringMatching(/^place:.+:raw$/),
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    )
  })

  it('writes user:last_place KV when userId and chatId are provided', async () => {
    await runFlowC(MAPS_URL, 'reply-token', mockEnv, 'U001', 'C001')

    const kvPut = (mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(
      'user:U001:last_place',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 24 * 60 * 60 }),
    )
  })
})

describe('runFlowC — fallback to name search (no place_id)', () => {
  it('falls back to textSearch when no place_id in URL', async () => {
    mockParse.mockResolvedValue(PARSED_NAME_ONLY)

    await runFlowC(MAPS_URL, 'reply-token', mockEnv)

    expect(mockSearch).toHaveBeenCalledWith('兒童新樂園', mockEnv)
    expect(mockDetails).toHaveBeenCalledWith('ChIJabc', mockEnv)
  })
})

describe('runFlowC — error handling', () => {
  it('throws PlacesError when parseGoogleMapsUrl fails', async () => {
    mockParse.mockRejectedValue(new Error('network error'))

    const err = await runFlowC(MAPS_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('解析 Google Maps 連結失敗')
  })

  it('throws PlacesError when no details can be resolved', async () => {
    mockParse.mockResolvedValue({})
    // No place_id and no name → details stays null

    const err = await runFlowC(MAPS_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('找不到')
  })

  it('throws PlacesError when getPlaceDetails fails', async () => {
    mockDetails.mockRejectedValue(new Error('API error'))

    const err = await runFlowC(MAPS_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('取得地點資訊失敗')
  })

  it('throws PlacesError when getPlaceDetails returns null', async () => {
    mockDetails.mockResolvedValue(null)

    const err = await runFlowC(MAPS_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('找不到')
  })

  it('throws PlacesError when extraction fails', async () => {
    mockExtract.mockRejectedValue(new Error('claude error'))

    const err = await runFlowC(MAPS_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('整理時遇到狀況')
  })

  it('throws PlacesError when Notion write fails', async () => {
    mockCreate.mockRejectedValue(new Error('Notion 503'))

    const err = await runFlowC(MAPS_URL, 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('寫入 Notion 失敗')
  })

  it('does not throw when KV write fails (best-effort)', async () => {
    ;(mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put.mockRejectedValueOnce(new Error('KV error'))

    await expect(runFlowC(MAPS_URL, 'reply-token', mockEnv)).resolves.toBeUndefined()
    expect(mockReply).toHaveBeenCalledOnce()
  })
})

describe('runFlowC — dedup check', () => {
  beforeEach(() => {
    mockParse.mockResolvedValue(PARSED_WITH_ID)
    mockDetails.mockResolvedValue(DETAILS)
    mockContext.mockReturnValue(CONTEXT)
    mockExtract.mockResolvedValue(SAMPLE_PLACE)
    mockCreate.mockResolvedValue(NOTION_RESULT)
  })

  it('sends dedup card and returns early when duplicate found', async () => {
    mockCheckDuplicate.mockResolvedValueOnce({ found: true, notion_page_id: 'page-xyz', internal_id: 'int-1', name: '兒童新樂園' })

    await runFlowC(MAPS_URL, 'reply-token', mockEnv)

    expect(mockExtract).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    const msg = mockReply.mock.calls[0][1][0]
    expect(msg.type).toBe('flex')
    const altText = (msg as { type: string; altText: string }).altText
    expect(altText).toContain('已經存過了')
  })

  it('writes dedup KV after successful Notion write', async () => {
    await runFlowC(MAPS_URL, 'reply-token', mockEnv)

    expect(mockWriteDedupKV).toHaveBeenCalledWith(
      mockEnv,
      'ChIJabc',
      'page-abc',
      expect.any(String),
      expect.any(String),
    )
  })
})
