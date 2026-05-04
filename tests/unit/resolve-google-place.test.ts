import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/google-places', () => ({
  textSearch: vi.fn(),
  getPlaceDetails: vi.fn(),
}))

import { resolveGooglePlace } from '../../src/capabilities/places/resolve-google-place'
import { textSearch, getPlaceDetails } from '../../src/integrations/google-places'

const mockTextSearch = vi.mocked(textSearch)
const mockGetPlaceDetails = vi.mocked(getPlaceDetails)

const mockEnv = { GOOGLE_PLACES_API_KEY: 'test' } as unknown as Env

const CANDIDATE = { place_id: 'ChIJresolved', name: '兒童新樂園', formatted_address: '台北市士林區', types: [] }
const DETAILS = {
  place_id: 'ChIJresolved',
  name: '兒童新樂園',
  formatted_address: '台北市士林區承德路五段55號',
  types: [],
  rating: null,
  opening_hours: null,
  website: null,
  editorial_summary: null,
  lat: 25.0845,
  lng: 121.4987,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveGooglePlace — happy path', () => {
  it('returns google_place_id and coords when name matches', async () => {
    mockTextSearch.mockResolvedValue([CANDIDATE])
    mockGetPlaceDetails.mockResolvedValue(DETAILS)

    const result = await resolveGooglePlace({ name: '兒童新樂園', region: '台北' }, mockEnv)

    expect(result).not.toBeNull()
    expect(result!.google_place_id).toBe('ChIJresolved')
    expect(result!.lat).toBeCloseTo(25.0845)
    expect(result!.lng).toBeCloseTo(121.4987)
  })

  it('includes region in query for better results', async () => {
    mockTextSearch.mockResolvedValue([CANDIDATE])
    mockGetPlaceDetails.mockResolvedValue(DETAILS)

    await resolveGooglePlace({ name: '兒童新樂園', region: '台北' }, mockEnv)

    expect(mockTextSearch).toHaveBeenCalledWith('兒童新樂園 台北', mockEnv)
  })

  it('queries by name only when region is null', async () => {
    mockTextSearch.mockResolvedValue([CANDIDATE])
    mockGetPlaceDetails.mockResolvedValue(DETAILS)

    await resolveGooglePlace({ name: '兒童新樂園', region: null }, mockEnv)

    expect(mockTextSearch).toHaveBeenCalledWith('兒童新樂園', mockEnv)
  })
})

describe('resolveGooglePlace — no match', () => {
  it('returns null when textSearch returns empty', async () => {
    mockTextSearch.mockResolvedValue([])

    const result = await resolveGooglePlace({ name: '某地方', region: null }, mockEnv)

    expect(result).toBeNull()
    expect(mockGetPlaceDetails).not.toHaveBeenCalled()
  })

  it('returns null when name does not fuzzy-match Google result', async () => {
    mockTextSearch.mockResolvedValue([{ ...CANDIDATE, name: '完全不同的地方ABC' }])

    const result = await resolveGooglePlace({ name: '兒童新樂園', region: null }, mockEnv)

    expect(result).toBeNull()
    expect(mockGetPlaceDetails).not.toHaveBeenCalled()
  })

  it('returns null when getPlaceDetails returns null', async () => {
    mockTextSearch.mockResolvedValue([CANDIDATE])
    mockGetPlaceDetails.mockResolvedValue(null)

    const result = await resolveGooglePlace({ name: '兒童新樂園', region: null }, mockEnv)

    expect(result).toBeNull()
  })

  it('returns null when name is empty', async () => {
    const result = await resolveGooglePlace({ name: '', region: null }, mockEnv)

    expect(result).toBeNull()
    expect(mockTextSearch).not.toHaveBeenCalled()
  })
})

describe('resolveGooglePlace — error handling', () => {
  it('returns null (non-fatal) when textSearch throws', async () => {
    mockTextSearch.mockRejectedValue(new Error('network error'))

    const result = await resolveGooglePlace({ name: '兒童新樂園', region: '台北' }, mockEnv)

    expect(result).toBeNull()
  })

  it('returns null (non-fatal) when getPlaceDetails throws', async () => {
    mockTextSearch.mockResolvedValue([CANDIDATE])
    mockGetPlaceDetails.mockRejectedValue(new Error('API error'))

    const result = await resolveGooglePlace({ name: '兒童新樂園', region: null }, mockEnv)

    expect(result).toBeNull()
  })
})
