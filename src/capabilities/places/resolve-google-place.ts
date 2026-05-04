import { textSearch, getPlaceDetails } from '../../integrations/google-places'
import type { Env } from '../../core/env'
import type { Place } from './schema'

export type GoogleResolution = {
  google_place_id: string
  lat: number | null
  lng: number | null
  address: string | null
}

// Fuzzy name match: Google result name contains or is contained by extracted name (case-insensitive)
function nameMatches(extractedName: string, googleName: string): boolean {
  const a = extractedName.toLowerCase()
  const b = googleName.toLowerCase()
  return a.includes(b) || b.includes(a)
}

export async function resolveGooglePlace(
  place: Pick<Place, 'name' | 'region'>,
  env: Env,
): Promise<GoogleResolution | null> {
  if (!place.name) return null

  const query = place.region ? `${place.name} ${place.region}` : place.name

  try {
    const candidates = await textSearch(query, env)
    if (candidates.length === 0) return null

    const top = candidates[0]
    if (!nameMatches(place.name, top.name)) {
      console.log('[resolve-google-place] name mismatch, skipping', { extracted: place.name, google: top.name })
      return null
    }

    const details = await getPlaceDetails(top.place_id, env)
    if (!details) return null

    return {
      google_place_id: details.place_id,
      lat: details.lat,
      lng: details.lng,
      address: details.formatted_address || null,
    }
  } catch (err) {
    console.warn('[resolve-google-place] failed (non-fatal)', { query, err })
    return null
  }
}
