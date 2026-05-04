import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeEnv(kvData: Record<string, string | null> = {}): Env {
  const store = new Map(Object.entries(kvData))
  return {
    GOOGLE_PLACES_API_KEY: 'test-key',
    ALFRED_KV: {
      get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      put: vi.fn((key: string, val: string) => { store.set(key, val); return Promise.resolve() }),
      delete: vi.fn(),
    },
  } as unknown as Env
}

import { computeRouteMatrix, computeSingleRoute } from '../../src/integrations/routes-api'

const ORIGIN = { lat: 25.0478, lng: 121.5170 }
const DEST   = { lat: 25.0800, lng: 121.5654 }
const CACHE_KEY = `route:25.0478,121.5170:25.0800,121.5654`

function mockApiOk(elements: object[]) {
  return { ok: true, text: async () => JSON.stringify(elements), status: 200 }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('computeRouteMatrix', () => {
  it('returns driving + transit from API', async () => {
    const env = makeEnv()
    mockFetch
      .mockResolvedValueOnce(mockApiOk([{ originIndex: 0, destinationIndex: 0, duration: '1320s', distanceMeters: 5430, condition: 'ROUTE_EXISTS' }]))
      .mockResolvedValueOnce(mockApiOk([{ originIndex: 0, destinationIndex: 0, duration: '2100s', distanceMeters: 5800, condition: 'ROUTE_EXISTS' }]))

    const results = await computeRouteMatrix(ORIGIN, [DEST], env)
    expect(results[0]).toEqual({
      driving: { duration_minutes: 22, distance_meters: 5430 },
      transit: { duration_minutes: 35, distance_meters: 5800 },
    })
  })

  it('sets transit to null when condition is not ROUTE_EXISTS', async () => {
    const env = makeEnv()
    mockFetch
      .mockResolvedValueOnce(mockApiOk([{ originIndex: 0, destinationIndex: 0, duration: '1320s', distanceMeters: 5430, condition: 'ROUTE_EXISTS' }]))
      .mockResolvedValueOnce(mockApiOk([{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' }]))

    const results = await computeRouteMatrix(ORIGIN, [DEST], env)
    expect(results[0]).toEqual({
      driving: { duration_minutes: 22, distance_meters: 5430 },
      transit: null,
    })
  })

  it('returns cached result without calling API', async () => {
    const cached = { driving: { duration_minutes: 15, distance_meters: 3000 }, transit: null }
    const env = makeEnv({ [CACHE_KEY]: JSON.stringify(cached) })

    const results = await computeRouteMatrix(ORIGIN, [DEST], env)
    expect(results[0]).toEqual(cached)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('writes result to KV after API call', async () => {
    const env = makeEnv()
    mockFetch
      .mockResolvedValueOnce(mockApiOk([{ originIndex: 0, destinationIndex: 0, duration: '600s', distanceMeters: 2000, condition: 'ROUTE_EXISTS' }]))
      .mockResolvedValueOnce(mockApiOk([{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' }]))

    await computeRouteMatrix(ORIGIN, [DEST], env)
    const kvPut = (env.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(CACHE_KEY, expect.stringContaining('"driving"'), { expirationTtl: 86400 })
  })

  it('returns null for destination when API returns non-ok', async () => {
    const env = makeEnv()
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' })

    const results = await computeRouteMatrix(ORIGIN, [DEST], env)
    expect(results[0]).toEqual({ driving: null, transit: null })
  })

  it('returns route with both modes null when fetch throws', async () => {
    const env = makeEnv()
    mockFetch.mockRejectedValue(new Error('network error'))

    const results = await computeRouteMatrix(ORIGIN, [DEST], env)
    expect(results[0]).toEqual({ driving: null, transit: null })
  })

  it('returns empty array for zero destinations', async () => {
    const env = makeEnv()
    const results = await computeRouteMatrix(ORIGIN, [], env)
    expect(results).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('handles multiple destinations in one call', async () => {
    const dest2 = { lat: 25.1000, lng: 121.6000 }
    const env = makeEnv()
    mockFetch
      .mockResolvedValueOnce(mockApiOk([
        { originIndex: 0, destinationIndex: 0, duration: '600s', distanceMeters: 2000, condition: 'ROUTE_EXISTS' },
        { originIndex: 0, destinationIndex: 1, duration: '1200s', distanceMeters: 4000, condition: 'ROUTE_EXISTS' },
      ]))
      .mockResolvedValueOnce(mockApiOk([
        { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' },
        { originIndex: 0, destinationIndex: 1, duration: '1500s', distanceMeters: 4500, condition: 'ROUTE_EXISTS' },
      ]))

    const results = await computeRouteMatrix(ORIGIN, [DEST, dest2], env)
    expect(results[0]?.driving?.duration_minutes).toBe(10)
    expect(results[0]?.transit).toBeNull()
    expect(results[1]?.driving?.duration_minutes).toBe(20)
    expect(results[1]?.transit?.duration_minutes).toBe(25)
  })

  it('handles newline-delimited JSON response format', async () => {
    const env = makeEnv()
    const ndjson = '{"originIndex":0,"destinationIndex":0,"duration":"900s","distanceMeters":3000,"condition":"ROUTE_EXISTS"}\n'
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: async () => ndjson, status: 200 })
      .mockResolvedValueOnce(mockApiOk([{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' }]))

    const results = await computeRouteMatrix(ORIGIN, [DEST], env)
    expect(results[0]?.driving?.duration_minutes).toBe(15)
  })
})

describe('computeSingleRoute', () => {
  it('returns RouteResult for single destination', async () => {
    const env = makeEnv()
    mockFetch
      .mockResolvedValueOnce(mockApiOk([{ originIndex: 0, destinationIndex: 0, duration: '600s', distanceMeters: 2000, condition: 'ROUTE_EXISTS' }]))
      .mockResolvedValueOnce(mockApiOk([{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' }]))

    const result = await computeSingleRoute(ORIGIN, DEST, env)
    expect(result?.driving?.duration_minutes).toBe(10)
  })

  it('returns null on any error', async () => {
    const env = makeEnv()
    mockFetch.mockRejectedValue(new Error('network'))

    const result = await computeSingleRoute(ORIGIN, DEST, env)
    expect(result).toBeNull()
  })
})
