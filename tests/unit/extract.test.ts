import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/anthropic', () => ({
  MODELS: { extraction: 'claude-sonnet-4-6', search: 'claude-haiku-4-5-20251001' },
  createClient: vi.fn(() => ({})),
  chatJson: vi.fn(),
  chatJsonWithImage: vi.fn(),
}))

vi.mock('../../src/lib/uuid', () => ({
  generateUuid: vi.fn(() => 'fixed-uuid'),
}))

import { extractFromHtml, extractFromGooglePlaces, extractFromImage, NoPlaceDetectedError } from '../../src/capabilities/places/extract'
import { chatJson, chatJsonWithImage } from '../../src/integrations/anthropic'
import {
  RICH_RAW_RESPONSE,
  VAGUE_RAW_RESPONSE,
  FIXTURE_BLOG_URL,
  FIXTURE_BLOG_HTML,
  FIXTURE_GOOGLE_PLACES_CONTEXT,
} from '../fixtures/extraction'

const mockChatJson = vi.mocked(chatJson)
const mockChatJsonWithImage = vi.mocked(chatJsonWithImage)
const mockEnv = { ANTHROPIC_API_KEY: 'test-key' } as unknown as Env

beforeEach(() => {
  vi.clearAllMocks()
})

// --- extractFromHtml ---

describe('extractFromHtml', () => {
  it('returns a Place with correct fields from a rich article', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromHtml(FIXTURE_BLOG_URL, FIXTURE_BLOG_HTML, mockEnv)

    expect(place.name).toBe('兒童新樂園')
    expect(place.categories).toEqual(['遊樂園'])
    expect(place.indoor_outdoor).toBe('半室內')
    expect(place.region).toBe('台北')
    expect(place.age_min).toBe(3)
    expect(place.age_max).toBe(12)
    expect(place.fee_type).toBe('部分收費')
    expect(place.stroller_friendly).toBe(true)
    expect(place.crowded_on_weekends).toBe(true)
  })

  it('sets source_url and source_type to 部落格', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromHtml(FIXTURE_BLOG_URL, FIXTURE_BLOG_HTML, mockEnv)

    expect(place.source_url).toBe(FIXTURE_BLOG_URL)
    expect(place.source_type).toEqual(['部落格'])
  })

  it('assigns a uuid as internal_id', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromHtml(FIXTURE_BLOG_URL, FIXTURE_BLOG_HTML, mockEnv)

    expect(place.internal_id).toBe('fixed-uuid')
  })

  it('builds user prompt containing URL and HTML text', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    await extractFromHtml(FIXTURE_BLOG_URL, FIXTURE_BLOG_HTML, mockEnv)

    const userArg = mockChatJson.mock.calls[0][3] as string
    expect(userArg).toContain(FIXTURE_BLOG_URL)
    expect(userArg).toContain(FIXTURE_BLOG_HTML)
  })

  it('has empty ai_inferred_fields for a rich, detailed article', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromHtml(FIXTURE_BLOG_URL, FIXTURE_BLOG_HTML, mockEnv)

    expect(place.ai_inferred_fields).toEqual([])
  })

  it('has non-empty ai_inferred_fields for a vague article', async () => {
    mockChatJson.mockResolvedValueOnce(VAGUE_RAW_RESPONSE)

    const place = await extractFromHtml(FIXTURE_BLOG_URL, FIXTURE_BLOG_HTML, mockEnv)

    expect(place.ai_inferred_fields.length).toBeGreaterThan(0)
    expect(place.ai_inferred_fields).toContain('Age Min')
    expect(place.ai_inferred_fields).toContain('Age Max')
  })

  it('defaults seasons to [全年] when Claude returns empty array', async () => {
    mockChatJson.mockResolvedValueOnce({ ...RICH_RAW_RESPONSE, seasons: [] })

    const place = await extractFromHtml(FIXTURE_BLOG_URL, FIXTURE_BLOG_HTML, mockEnv)

    expect(place.seasons).toEqual(['全年'])
  })

  it('retries once on first failure and returns result from second call', async () => {
    mockChatJson
      .mockRejectedValueOnce(new SyntaxError('Unexpected token'))
      .mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromHtml(FIXTURE_BLOG_URL, FIXTURE_BLOG_HTML, mockEnv)

    expect(mockChatJson).toHaveBeenCalledTimes(2)
    expect(place.name).toBe('兒童新樂園')
  })

  it('throws after two consecutive failures', async () => {
    mockChatJson
      .mockRejectedValueOnce(new SyntaxError('bad json'))
      .mockRejectedValueOnce(new SyntaxError('bad json again'))

    await expect(extractFromHtml(FIXTURE_BLOG_URL, FIXTURE_BLOG_HTML, mockEnv)).rejects.toThrow(
      SyntaxError,
    )
    expect(mockChatJson).toHaveBeenCalledTimes(2)
  })
})

// --- extractFromGooglePlaces ---

describe('extractFromGooglePlaces', () => {
  it('returns a Place with correct fields from Google Places data', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromGooglePlaces(
      '兒童新樂園',
      FIXTURE_GOOGLE_PLACES_CONTEXT,
      ['Google Maps'],
      mockEnv,
    )

    expect(place.name).toBe('兒童新樂園')
    expect(place.region).toBe('台北')
    expect(place.age_min).toBe(3)
  })

  it('uses caller-supplied source_type', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromGooglePlaces(
      '兒童新樂園',
      FIXTURE_GOOGLE_PLACES_CONTEXT,
      ['Google Maps'],
      mockEnv,
    )

    expect(place.source_type).toEqual(['Google Maps'])
  })

  it('sets source_url to context website', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromGooglePlaces(
      '兒童新樂園',
      FIXTURE_GOOGLE_PLACES_CONTEXT,
      ['Google Maps'],
      mockEnv,
    )

    expect(place.source_url).toBe(FIXTURE_GOOGLE_PLACES_CONTEXT.website)
  })

  it('builds user prompt containing place name and address', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    await extractFromGooglePlaces(
      '兒童新樂園',
      FIXTURE_GOOGLE_PLACES_CONTEXT,
      ['Google Maps'],
      mockEnv,
    )

    const userArg = mockChatJson.mock.calls[0][3] as string
    expect(userArg).toContain(FIXTURE_GOOGLE_PLACES_CONTEXT.name)
    expect(userArg).toContain(FIXTURE_GOOGLE_PLACES_CONTEXT.address)
  })

  it('sets source_url to null when context has no website', async () => {
    mockChatJson.mockResolvedValueOnce(RICH_RAW_RESPONSE)
    const noWebsite = { ...FIXTURE_GOOGLE_PLACES_CONTEXT, website: null }

    const place = await extractFromGooglePlaces('某公園', noWebsite, ['朋友推薦'], mockEnv)

    expect(place.source_url).toBeNull()
  })
})

// --- extractFromImage ---

describe('extractFromImage', () => {
  it('returns a Place from successful image extraction', async () => {
    mockChatJsonWithImage.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromImage('aGVsbG8=', 'image/jpeg', mockEnv)

    expect(place.name).toBe('兒童新樂園')
    expect(place.categories).toEqual(['遊樂園'])
  })

  it('sets source_type to [] (empty — semantic source unknown for images)', async () => {
    mockChatJsonWithImage.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromImage('aGVsbG8=', 'image/jpeg', mockEnv)

    expect(place.source_type).toEqual([])
  })

  it('sets source_url to null', async () => {
    mockChatJsonWithImage.mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromImage('aGVsbG8=', 'image/jpeg', mockEnv)

    expect(place.source_url).toBeNull()
  })

  it('throws NoPlaceDetectedError when Claude returns { error: "no_place_detected" }', async () => {
    mockChatJsonWithImage.mockResolvedValueOnce({ error: 'no_place_detected' })

    await expect(extractFromImage('aGVsbG8=', 'image/jpeg', mockEnv)).rejects.toBeInstanceOf(NoPlaceDetectedError)
  })

  it('does not retry on NoPlaceDetectedError (semantic, not transient)', async () => {
    mockChatJsonWithImage.mockResolvedValue({ error: 'no_place_detected' })

    await expect(extractFromImage('aGVsbG8=', 'image/jpeg', mockEnv)).rejects.toBeInstanceOf(NoPlaceDetectedError)
    expect(mockChatJsonWithImage).toHaveBeenCalledTimes(1)
  })

  it('retries once on API failure', async () => {
    mockChatJsonWithImage
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce(RICH_RAW_RESPONSE)

    const place = await extractFromImage('aGVsbG8=', 'image/jpeg', mockEnv)

    expect(mockChatJsonWithImage).toHaveBeenCalledTimes(2)
    expect(place.name).toBe('兒童新樂園')
  })
})
