import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Env } from '../../src/core/env'

import {
  parseGoogleMapsUrl,
  textSearch,
  getPlaceDetails,
  toGooglePlacesContext,
} from '../../src/integrations/google-places'

const mockEnv = { GOOGLE_PLACES_API_KEY: 'test-api-key' } as unknown as Env

function makeFetchResponse(body: unknown, options: { ok?: boolean; status?: number; url?: string } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    url: options.url ?? '',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// --- parseGoogleMapsUrl ---

describe('parseGoogleMapsUrl — full URLs (no redirect)', () => {
  it('extracts name and coordinates from standard /place/ URL', async () => {
    const url = 'https://www.google.com/maps/place/兒童新樂園/@25.0845,121.4987,17z'
    const result = await parseGoogleMapsUrl(url)

    expect(result.name).toBe('兒童新樂園')
    expect(result.lat).toBeCloseTo(25.0845)
    expect(result.lng).toBeCloseTo(121.4987)
  })

  it('extracts place_id from ChIJ data parameter', async () => {
    const url =
      'https://www.google.com/maps/place/兒童新樂園/@25.0845,121.4987,17z/' +
      'data=!4m6!3m5!1sChIJabc123XYZ!8m2!3d25.0845!4d121.4987'
    const result = await parseGoogleMapsUrl(url)

    expect(result.place_id).toBe('ChIJabc123XYZ')
    expect(result.name).toBe('兒童新樂園')
    expect(result.lat).toBeCloseTo(25.0845)
  })

  it('handles URL-encoded Chinese place names', async () => {
    const url =
      'https://www.google.com/maps/place/%E5%85%92%E7%AB%A5%E6%96%B0%E6%A8%82%E5%9C%92/@25.0845,121.4987,17z'
    const result = await parseGoogleMapsUrl(url)

    expect(result.name).toBe('兒童新樂園')
  })

  it('extracts coordinates from ?q= format', async () => {
    const url = 'https://maps.google.com/maps?q=25.0845,121.4987'
    const result = await parseGoogleMapsUrl(url)

    expect(result.lat).toBeCloseTo(25.0845)
    expect(result.lng).toBeCloseTo(121.4987)
    expect(result.name).toBeUndefined()
    expect(result.place_id).toBeUndefined()
  })

  it('returns empty object for unrecognized URL format', async () => {
    const result = await parseGoogleMapsUrl('https://maps.google.com/')
    expect(result).toEqual({})
  })
})

describe('parseGoogleMapsUrl — short URLs (redirect)', () => {
  it('follows maps.app.goo.gl redirect and parses expanded URL', async () => {
    const expandedUrl =
      'https://www.google.com/maps/place/大湖公園/@25.0789,121.5821,17z'
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({}, { url: expandedUrl }) as unknown as Response,
    )

    const result = await parseGoogleMapsUrl('https://maps.app.goo.gl/abc123')

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://maps.app.goo.gl/abc123',
      { redirect: 'follow' },
    )
    expect(result.name).toBe('大湖公園')
    expect(result.lat).toBeCloseTo(25.0789)
  })

  it('follows goo.gl/maps redirect and parses expanded URL', async () => {
    const expandedUrl =
      'https://www.google.com/maps/place/大湖公園/@25.0789,121.5821,15z'
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({}, { url: expandedUrl }) as unknown as Response,
    )

    const result = await parseGoogleMapsUrl('https://goo.gl/maps/XXXXX')

    expect(result.name).toBe('大湖公園')
  })
})

// --- textSearch ---

describe('textSearch', () => {
  it('returns mapped PlaceCandidate array', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({
        places: [
          {
            id: 'ChIJtest1',
            displayName: { text: '兒童新樂園' },
            formattedAddress: '台北市士林區承德路五段55號',
            types: ['amusement_park'],
          },
        ],
      }) as unknown as Response,
    )

    const results = await textSearch('兒童新樂園', mockEnv)

    expect(results).toHaveLength(1)
    expect(results[0].place_id).toBe('ChIJtest1')
    expect(results[0].name).toBe('兒童新樂園')
    expect(results[0].formatted_address).toBe('台北市士林區承德路五段55號')
    expect(results[0].types).toEqual(['amusement_park'])
  })

  it('returns empty array when no places found', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({}) as unknown as Response,
    )
    const results = await textSearch('不存在的地方', mockEnv)
    expect(results).toEqual([])
  })

  it('sends correct API key and field mask', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({ places: [] }) as unknown as Response,
    )
    await textSearch('test', mockEnv)

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('key=test-api-key')
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('places.id')
  })

  it('throws on API error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({ error: 'bad' }, { ok: false, status: 400 }) as unknown as Response,
    )
    await expect(textSearch('test', mockEnv)).rejects.toThrow('400')
  })

  it('sends locationBias centered on Taipei in request body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({ places: [] }) as unknown as Response,
    )
    await textSearch('兒童新樂園', mockEnv)

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.locationBias).toBeDefined()
    expect(body.locationBias.circle.center.latitude).toBeCloseTo(25.0478)
    expect(body.locationBias.circle.radius).toBe(50_000)
  })

  it('filters out non-Taiwan results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({
        places: [
          {
            id: 'ChIJtokyo',
            displayName: { text: '東京ディズニーランド' },
            formattedAddress: 'Japan, Urayasu, Chiba',
            types: ['amusement_park'],
          },
          {
            id: 'ChIJtw',
            displayName: { text: '台灣樂園' },
            formattedAddress: '桃園市中壢區 Taiwan',
            types: ['amusement_park'],
          },
        ],
      }) as unknown as Response,
    )

    const results = await textSearch('樂園', mockEnv)

    expect(results).toHaveLength(1)
    expect(results[0].place_id).toBe('ChIJtw')
  })
})

// --- getPlaceDetails ---

describe('getPlaceDetails', () => {
  const rawPlace = {
    id: 'ChIJtest1',
    displayName: { text: '兒童新樂園' },
    formattedAddress: '台北市士林區承德路五段55號',
    types: ['amusement_park'],
    rating: 4.2,
    regularOpeningHours: { weekdayDescriptions: ['週一: 09:00–17:00'] },
    websiteUri: 'https://tcap.taipei/',
    editorialSummary: { text: '大型遊樂場' },
    location: { latitude: 25.0845, longitude: 121.4987 },
  }

  it('returns mapped PlaceDetails for a valid place', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse(rawPlace) as unknown as Response,
    )

    const details = await getPlaceDetails('ChIJtest1', mockEnv)

    expect(details).not.toBeNull()
    expect(details!.place_id).toBe('ChIJtest1')
    expect(details!.name).toBe('兒童新樂園')
    expect(details!.rating).toBe(4.2)
    expect(details!.opening_hours).toBe('週一: 09:00–17:00')
    expect(details!.website).toBe('https://tcap.taipei/')
    expect(details!.editorial_summary).toBe('大型遊樂場')
    expect(details!.lat).toBeCloseTo(25.0845)
    expect(details!.lng).toBeCloseTo(121.4987)
  })

  it('returns null for 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({}, { ok: false, status: 404 }) as unknown as Response,
    )
    const details = await getPlaceDetails('ChIJnotfound', mockEnv)
    expect(details).toBeNull()
  })

  it('throws on non-404 API error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({}, { ok: false, status: 500 }) as unknown as Response,
    )
    await expect(getPlaceDetails('ChIJtest1', mockEnv)).rejects.toThrow('500')
  })

  it('handles missing optional fields gracefully', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      makeFetchResponse({ id: 'ChIJtest1' }) as unknown as Response,
    )
    const details = await getPlaceDetails('ChIJtest1', mockEnv)
    expect(details!.name).toBe('')
    expect(details!.rating).toBeNull()
    expect(details!.opening_hours).toBeNull()
    expect(details!.website).toBeNull()
    expect(details!.lat).toBeNull()
  })
})

// --- toGooglePlacesContext ---

describe('toGooglePlacesContext', () => {
  it('converts PlaceDetails to GooglePlacesContext', () => {
    const details = {
      place_id: 'ChIJtest1',
      name: '兒童新樂園',
      formatted_address: '台北市士林區',
      types: ['amusement_park', 'point_of_interest'],
      rating: 4.2,
      opening_hours: '週一: 09:00–17:00',
      website: 'https://tcap.taipei/',
      editorial_summary: '大型遊樂場',
      lat: 25.0845,
      lng: 121.4987,
    }

    const ctx = toGooglePlacesContext(details)

    expect(ctx.name).toBe('兒童新樂園')
    expect(ctx.address).toBe('台北市士林區')
    expect(ctx.types).toBe('amusement_park, point_of_interest')
    expect(ctx.rating).toBe(4.2)
    expect(ctx.hours).toBe('週一: 09:00–17:00')
    expect(ctx.website).toBe('https://tcap.taipei/')
    expect(ctx.editorialSummary).toBe('大型遊樂場')
  })
})
