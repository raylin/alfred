import type { Env } from '../core/env'
import type { GooglePlacesContext } from '../capabilities/places/extract'

const PLACES_API = 'https://places.googleapis.com/v1'

// Field masks for the Places API (New)
const SEARCH_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.types',
].join(',')

const DETAIL_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'types',
  'rating',
  'regularOpeningHours',
  'websiteUri',
  'editorialSummary',
  'location',
].join(',')

// --- Public types ---

export type PlaceCandidate = {
  place_id: string
  name: string
  formatted_address: string
  types: string[]
}

export type PlaceDetails = {
  place_id: string
  name: string
  formatted_address: string
  types: string[]
  rating: number | null
  opening_hours: string | null
  website: string | null
  editorial_summary: string | null
  lat: number | null
  lng: number | null
}

export type ParsedMapsUrl = {
  place_id?: string
  name?: string
  lat?: number
  lng?: number
}

// --- Internal API response shapes ---

type RawPlace = {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  types?: string[]
  rating?: number
  regularOpeningHours?: { weekdayDescriptions?: string[] }
  websiteUri?: string
  editorialSummary?: { text: string }
  location?: { latitude: number; longitude: number }
}

// --- Mappers ---

function toCandidate(p: RawPlace): PlaceCandidate {
  return {
    place_id: p.id,
    name: p.displayName?.text ?? '',
    formatted_address: p.formattedAddress ?? '',
    types: p.types ?? [],
  }
}

function toDetails(p: RawPlace): PlaceDetails {
  const hours = p.regularOpeningHours?.weekdayDescriptions?.join('；') ?? null
  return {
    place_id: p.id,
    name: p.displayName?.text ?? '',
    formatted_address: p.formattedAddress ?? '',
    types: p.types ?? [],
    rating: p.rating ?? null,
    opening_hours: hours,
    website: p.websiteUri ?? null,
    editorial_summary: p.editorialSummary?.text ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
  }
}

// Convert PlaceDetails to the shape extract.ts expects
export function toGooglePlacesContext(details: PlaceDetails): GooglePlacesContext {
  return {
    name: details.name,
    address: details.formatted_address,
    types: details.types.join(', '),
    rating: details.rating,
    hours: details.opening_hours,
    website: details.website,
    editorialSummary: details.editorial_summary,
  }
}

// Default location bias: Taipei Main Station (ADR-015 — Phase 0+1 hardcode; Phase 2 to be user-configurable)
const DEFAULT_LAT = 25.0478
const DEFAULT_LNG = 121.5170
const LOCATION_BIAS_RADIUS_M = 50_000 // 50km covers greater Taipei area

const TW_CITY_PREFIXES = ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '苗栗縣',
  '台中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣', '台南市', '高雄市',
  '屏東縣', '宜蘭縣', '花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣']

function isTaiwanAddress(candidate: PlaceCandidate): boolean {
  const addr = candidate.formatted_address
  if (addr.includes('台灣') || addr.includes('Taiwan') || addr.includes('TW')) return true
  if (/^\d{3,5}/.test(addr)) return true // Taiwanese postal codes are 3 or 5 digits
  return TW_CITY_PREFIXES.some(city => addr.startsWith(city))
}

// --- API calls ---

export async function textSearch(query: string, env: Env): Promise<PlaceCandidate[]> {
  const res = await fetch(`${PLACES_API}/places:searchText?key=${env.GOOGLE_PLACES_API_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-FieldMask': SEARCH_FIELDS,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'zh-TW',
      maxResultCount: 5,
      locationBias: {
        circle: {
          center: { latitude: DEFAULT_LAT, longitude: DEFAULT_LNG },
          radius: LOCATION_BIAS_RADIUS_M,
        },
      },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Places textSearch ${res.status}: ${text}`)
  }
  const data = await res.json() as { places?: RawPlace[] }
  const candidates = (data.places ?? []).map(toCandidate)

  // Safety net: filter out non-Taiwan results (ADR-015)
  const twCandidates = candidates.filter(isTaiwanAddress)
  if (twCandidates.length < candidates.length) {
    console.warn('[google-places] filtered non-TW results', {
      query,
      filtered: candidates.filter(c => !isTaiwanAddress(c)).map(c => c.formatted_address),
    })
  }
  return twCandidates
}

export async function getPlaceDetails(placeId: string, env: Env): Promise<PlaceDetails | null> {
  const res = await fetch(
    `${PLACES_API}/places/${encodeURIComponent(placeId)}?key=${env.GOOGLE_PLACES_API_KEY}`,
    { headers: { 'X-Goog-FieldMask': DETAIL_FIELDS } },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Places getPlaceDetails ${res.status}: ${text}`)
  }
  const data = await res.json() as RawPlace
  return toDetails(data)
}

// --- URL parsing ---

const SHORT_URL_HOSTS = ['goo.gl', 'maps.app.goo.gl']

function isShortUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return SHORT_URL_HOSTS.some(h => host === h || host.endsWith('.' + h))
  } catch {
    return false
  }
}

// Follow redirects and return the final URL via res.url
async function expandShortUrl(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' })
  return res.url
}

function parseFullMapsUrl(url: string): ParsedMapsUrl {
  const result: ParsedMapsUrl = {}

  // Extract lat/lng from @{lat},{lng},{zoom}z
  const coordMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (coordMatch) {
    result.lat = parseFloat(coordMatch[1])
    result.lng = parseFloat(coordMatch[2])
  }

  // Extract lat/lng from ?q={lat},{lng} format
  if (!result.lat) {
    const qMatch = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/)
    if (qMatch) {
      result.lat = parseFloat(qMatch[1])
      result.lng = parseFloat(qMatch[2])
    }
  }

  // Extract place name from /place/{name}/ path segment
  const placeMatch = url.match(/\/place\/([^/@?]+)/)
  if (placeMatch) {
    try {
      result.name = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '))
    } catch {
      result.name = placeMatch[1]
    }
  }

  // Extract place_id from data parameter: !1s{place_id}
  // Only capture ChIJ-style IDs (Google Place IDs start with ChIJ)
  const placeIdMatch = url.match(/!1s(ChIJ[^!&]+)/)
  if (placeIdMatch) {
    result.place_id = placeIdMatch[1]
  }

  return result
}

export async function parseGoogleMapsUrl(url: string): Promise<ParsedMapsUrl> {
  const expanded = isShortUrl(url) ? await expandShortUrl(url) : url
  return parseFullMapsUrl(expanded)
}
