import type { Env } from '../core/env'

const ROUTE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix'
const ROUTE_CACHE_TTL = 86400 // 24 hours
const FIELD_MASK = 'originIndex,destinationIndex,duration,distanceMeters,condition'

export type RouteMode = {
  duration_minutes: number
  distance_meters: number
}

export type RouteResult = {
  driving: RouteMode | null
  transit: RouteMode | null
}

export type LatLng = { lat: number; lng: number }

type RouteElement = {
  originIndex?: number
  destinationIndex?: number
  duration?: string
  distanceMeters?: number
  condition?: string
}

function coordHash(p: LatLng): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
}

function kvRouteKey(origin: LatLng, dest: LatLng): string {
  return `route:${coordHash(origin)}:${coordHash(dest)}`
}

function parseDurationMinutes(duration: string | undefined): number | null {
  if (!duration) return null
  const secs = parseInt(duration.replace('s', ''), 10)
  return isNaN(secs) ? null : Math.round(secs / 60)
}

function parseMatrixElements(text: string): RouteElement[] {
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return parsed as RouteElement[]
    return [parsed as RouteElement]
  } catch {
    return text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('{'))
      .flatMap(l => { try { return [JSON.parse(l) as RouteElement] } catch { return [] } })
  }
}

async function fetchRouteMatrixRaw(
  origin: LatLng,
  destinations: LatLng[],
  travelMode: 'DRIVE' | 'TRANSIT',
  apiKey: string,
): Promise<(RouteMode | null)[]> {
  const body = {
    origins: [{
      waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    }],
    destinations: destinations.map(d => ({
      waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    })),
    travelMode,
  }

  const res = await fetch(ROUTE_MATRIX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    console.warn('[routes-api] API error', { travelMode, status: res.status })
    return destinations.map(() => null)
  }

  const text = await res.text()
  const elements = parseMatrixElements(text)

  // Log observed condition values (per spec open question 2 — aids PM review of transit no-route handling)
  const conditions = [...new Set(elements.map(e => e.condition ?? 'undefined'))]
  console.log(JSON.stringify({ type: 'routes_api_conditions', travelMode, conditions }))

  const results: (RouteMode | null)[] = destinations.map(() => null)
  for (const el of elements) {
    const idx = el.destinationIndex ?? 0
    if (el.condition !== 'ROUTE_EXISTS') continue
    const mins = parseDurationMinutes(el.duration)
    if (mins === null || el.distanceMeters == null) continue
    results[idx] = { duration_minutes: mins, distance_meters: el.distanceMeters }
  }
  return results
}

async function getCachedRoute(env: Env, origin: LatLng, dest: LatLng): Promise<RouteResult | undefined> {
  try {
    const raw = await env.ALFRED_KV.get(kvRouteKey(origin, dest))
    if (!raw) return undefined
    return JSON.parse(raw) as RouteResult
  } catch {
    return undefined
  }
}

async function setCachedRoute(env: Env, origin: LatLng, dest: LatLng, result: RouteResult): Promise<void> {
  try {
    await env.ALFRED_KV.put(kvRouteKey(origin, dest), JSON.stringify(result), {
      expirationTtl: ROUTE_CACHE_TTL,
    })
  } catch { /* cache write failure is non-fatal */ }
}

export async function computeRouteMatrix(
  origin: LatLng,
  destinations: LatLng[],
  env: Env,
): Promise<(RouteResult | null)[]> {
  if (destinations.length === 0) return []

  // Check KV cache per destination
  const cacheResults: (RouteResult | undefined)[] = await Promise.all(
    destinations.map(d => getCachedRoute(env, origin, d)),
  )

  const uncachedIndices = cacheResults
    .map((c, i) => (c === undefined ? i : -1))
    .filter(i => i >= 0)

  if (uncachedIndices.length > 0) {
    const uncachedDests = uncachedIndices.map(i => destinations[i])

    let drivingResults: (RouteMode | null)[]
    let transitResults: (RouteMode | null)[]
    try {
      ;[drivingResults, transitResults] = await Promise.all([
        fetchRouteMatrixRaw(origin, uncachedDests, 'DRIVE', env.GOOGLE_PLACES_API_KEY),
        fetchRouteMatrixRaw(origin, uncachedDests, 'TRANSIT', env.GOOGLE_PLACES_API_KEY),
      ])
    } catch (err) {
      console.warn('[routes-api] computeRouteMatrix batch failed (non-fatal)', err)
      drivingResults = uncachedDests.map(() => null)
      transitResults = uncachedDests.map(() => null)
    }

    await Promise.all(
      uncachedIndices.map(async (origIdx, j) => {
        const result: RouteResult = {
          driving: drivingResults[j] ?? null,
          transit: transitResults[j] ?? null,
        }
        cacheResults[origIdx] = result
        await setCachedRoute(env, origin, destinations[origIdx], result)
      }),
    )
  }

  return cacheResults.map(c => c ?? null)
}

export async function computeSingleRoute(
  origin: LatLng,
  dest: LatLng,
  env: Env,
): Promise<RouteResult | null> {
  try {
    const results = await computeRouteMatrix(origin, [dest], env)
    const result = results[0] ?? null
    // Return null when no useful data (driving + transit both absent)
    if (!result || (result.driving === null && result.transit === null)) return null
    return result
  } catch {
    return null
  }
}
