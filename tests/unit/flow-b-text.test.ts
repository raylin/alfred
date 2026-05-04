import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/google-places', () => ({
  textSearch: vi.fn(),
  getPlaceDetails: vi.fn(),
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

import { runFlowB } from '../../src/capabilities/places/flow-b-text'
import { PlacesError } from '../../src/capabilities/places/errors'
import { textSearch, getPlaceDetails, toGooglePlacesContext } from '../../src/integrations/google-places'
import { extractFromGooglePlaces } from '../../src/capabilities/places/extract'
import { createPlace } from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'
import { SAMPLE_PLACE } from '../fixtures/places'

const mockSearch = vi.mocked(textSearch)
const mockDetails = vi.mocked(getPlaceDetails)
const mockContext = vi.mocked(toGooglePlacesContext)
const mockExtract = vi.mocked(extractFromGooglePlaces)
const mockCreate = vi.mocked(createPlace)
const mockReply = vi.mocked(sendReply)

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

const CANDIDATE = { place_id: 'ChIJabc', name: '兒童新樂園', formatted_address: '台北市士林區承德路55號', types: ['amusement_park'] }
const DETAILS = {
  place_id: 'ChIJabc',
  name: '兒童新樂園',
  formatted_address: '台北市士林區承德路55號',
  types: ['amusement_park'],
  rating: 4.5,
  opening_hours: '每日09:00-17:00',
  website: null,
  editorial_summary: null,
  lat: 25.09,
  lng: 121.52,
}
const NOTION_RESULT = { notion_page_id: 'page-abc', url: 'https://www.notion.so/page-abc' }
const CONTEXT = { name: '兒童新樂園', address: '台北市士林區', types: 'amusement_park', rating: 4.5, hours: null, website: null, editorialSummary: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockSearch.mockResolvedValue([CANDIDATE])
  mockDetails.mockResolvedValue(DETAILS)
  mockContext.mockReturnValue(CONTEXT)
  mockExtract.mockResolvedValue(SAMPLE_PLACE)
  mockCreate.mockResolvedValue(NOTION_RESULT)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runFlowB — happy path', () => {
  it('searches, gets details, extracts, writes to Notion, and replies', async () => {
    await runFlowB('兒童新樂園', 'reply-token', mockEnv)

    expect(mockSearch).toHaveBeenCalledWith('兒童新樂園', mockEnv)
    expect(mockDetails).toHaveBeenCalledWith('ChIJabc', mockEnv)
    expect(mockExtract).toHaveBeenCalledOnce()
    expect(mockCreate).toHaveBeenCalledOnce()
    expect(mockReply).toHaveBeenCalledOnce()
  })

  it('sends a flex message in the reply', async () => {
    await runFlowB('兒童新樂園', 'reply-token', mockEnv)

    expect(mockReply.mock.calls[0][1][0].type).toBe('flex')
  })

  it('passes empty source_type to extractFromGooglePlaces (semantic source unknown)', async () => {
    await runFlowB('兒童新樂園', 'reply-token', mockEnv)

    expect(mockExtract).toHaveBeenCalledWith(
      '兒童新樂園',
      expect.anything(),
      [],
      mockEnv,
    )
  })

  it('writes to KV with place:{id}:raw key', async () => {
    await runFlowB('兒童新樂園', 'reply-token', mockEnv)

    const kvPut = (mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(
      expect.stringMatching(/^place:.+:raw$/),
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    )
  })

  it('writes user:last_place KV when userId and chatId are provided', async () => {
    await runFlowB('兒童新樂園', 'reply-token', mockEnv, 'U001', 'C001')

    const kvPut = (mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(
      'user:U001:last_place',
      expect.any(String),
      expect.objectContaining({ expirationTtl: 24 * 60 * 60 }),
    )
  })

  it('does not include note in flex when only one candidate', async () => {
    await runFlowB('兒童新樂園', 'reply-token', mockEnv)

    const flex = mockReply.mock.calls[0][1][0] as unknown as { contents: { body: { contents: unknown[] } } }
    const bodyTexts = JSON.stringify(flex.contents.body.contents)
    expect(bodyTexts).not.toContain('找到的是')
  })

  it('includes disambiguation note when multiple candidates found', async () => {
    const secondCandidate = { ...CANDIDATE, place_id: 'ChIJxyz', name: '兒童新樂園 2' }
    mockSearch.mockResolvedValue([CANDIDATE, secondCandidate])

    await runFlowB('兒童新樂園', 'reply-token', mockEnv)

    const flex = mockReply.mock.calls[0][1][0] as unknown as { contents: { body: { contents: unknown[] } } }
    const bodyTexts = JSON.stringify(flex.contents.body.contents)
    expect(bodyTexts).toContain('找到的是')
    expect(bodyTexts).toContain('台北市士林區承德路55號')
  })

  it('merges google_place_id, lat, lng from details into place', async () => {
    await runFlowB('兒童新樂園', 'reply-token', mockEnv)

    const placeArg = mockCreate.mock.calls[0][0]
    expect(placeArg.google_place_id).toBe('ChIJabc')
    expect(placeArg.latitude).toBe(25.09)
    expect(placeArg.longitude).toBe(121.52)
  })
})

describe('runFlowB — error handling', () => {
  it('throws PlacesError when textSearch fails', async () => {
    mockSearch.mockRejectedValue(new Error('network error'))

    const err = await runFlowB('兒童新樂園', 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('搜尋時遇到狀況')
  })

  it('throws PlacesError when no candidates found', async () => {
    mockSearch.mockResolvedValue([])

    const err = await runFlowB('不存在的地點', 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('找不到')
  })

  it('throws PlacesError when getPlaceDetails fails', async () => {
    mockDetails.mockRejectedValue(new Error('API error'))

    const err = await runFlowB('兒童新樂園', 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('搜尋時遇到狀況')
  })

  it('throws PlacesError when getPlaceDetails returns null', async () => {
    mockDetails.mockResolvedValue(null)

    const err = await runFlowB('兒童新樂園', 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('找不到')
  })

  it('throws PlacesError when extraction fails', async () => {
    mockExtract.mockRejectedValue(new Error('claude error'))

    const err = await runFlowB('兒童新樂園', 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('整理時遇到狀況')
  })

  it('throws PlacesError when Notion write fails', async () => {
    mockCreate.mockRejectedValue(new Error('Notion 503'))

    const err = await runFlowB('兒童新樂園', 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('寫入 Notion 失敗')
  })

  it('does not throw when KV write fails (best-effort)', async () => {
    ;(mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put.mockRejectedValueOnce(new Error('KV error'))

    await expect(runFlowB('兒童新樂園', 'reply-token', mockEnv)).resolves.toBeUndefined()
    expect(mockReply).toHaveBeenCalledOnce()
  })
})
