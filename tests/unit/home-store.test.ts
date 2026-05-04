import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/notion', () => ({
  getSettingsByLineUserId: vi.fn(),
  upsertSettings: vi.fn(),
  discoverDbIds: vi.fn(),
}))

import {
  getHomeLocation,
  setHomeLocation,
  getCurrentOrigin,
  setCurrentOrigin,
  clearCurrentOrigin,
  getEffectiveOrigin,
  hasBeenPromptedRecently,
  markHomeprompted,
  markHomeUpdatePending,
  isHomeUpdatePending,
  consumeHomeUpdatePending,
} from '../../src/capabilities/places/home-store'
import { getSettingsByLineUserId, upsertSettings } from '../../src/integrations/notion'

const mockGetSettings = vi.mocked(getSettingsByLineUserId)
const mockUpsert = vi.mocked(upsertSettings)

function makeEnv(kvOverrides: Record<string, string | null> = {}): Env {
  const store = new Map(Object.entries(kvOverrides))
  return {
    ALFRED_KV: {
      get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      put: vi.fn((key: string, val: string) => { store.set(key, val); return Promise.resolve() }),
      delete: vi.fn((key: string) => { store.delete(key); return Promise.resolve() }),
    },
  } as unknown as Env
}

const USER = 'U001'
const HOME_KV = `user:${USER}:home`
const ORIGIN_KV = `user:${USER}:current_origin`
const PROMPTED_KV = `user:${USER}:home_prompted_at`

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getHomeLocation', () => {
  it('returns home from KV cache when present', async () => {
    const env = makeEnv({ [HOME_KV]: JSON.stringify({ lat: 25.05, lng: 121.52, address: '台北', configured_at: '2026-01-01' }) })
    const result = await getHomeLocation(env, USER)
    expect(result).toEqual({ lat: 25.05, lng: 121.52, address: '台北' })
    expect(mockGetSettings).not.toHaveBeenCalled()
  })

  it('falls back to Settings DB on KV miss, then backfills KV', async () => {
    const env = makeEnv()
    mockGetSettings.mockResolvedValueOnce({
      notion_page_id: 'pg1', line_user_id: USER,
      display_name: null, home_address: '新北', home_lat: 25.01, home_lng: 121.45,
      configured_at: '2026-01-01',
    })
    const result = await getHomeLocation(env, USER)
    expect(result).toEqual({ lat: 25.01, lng: 121.45, address: '新北' })
    const kvPut = (env.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(HOME_KV, expect.stringContaining('"lat":25.01'))
  })

  it('returns null when neither KV nor Settings DB has home', async () => {
    const env = makeEnv()
    mockGetSettings.mockResolvedValueOnce(null)
    expect(await getHomeLocation(env, USER)).toBeNull()
  })
})

describe('setHomeLocation', () => {
  it('writes to both KV and Settings DB', async () => {
    const env = makeEnv()
    mockUpsert.mockResolvedValueOnce({
      notion_page_id: 'pg1', line_user_id: USER,
      display_name: null, home_address: '台北', home_lat: 25.05, home_lng: 121.52,
      configured_at: '2026-01-01',
    })
    await setHomeLocation(env, USER, 25.05, 121.52, '台北')
    const kvPut = (env.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(HOME_KV, expect.stringContaining('"lat":25.05'))
    expect(mockUpsert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ home_lat: 25.05, home_address: '台北' }))
  })
})

describe('getCurrentOrigin / setCurrentOrigin / clearCurrentOrigin', () => {
  it('returns null when no current_origin in KV', async () => {
    const env = makeEnv()
    expect(await getCurrentOrigin(env, USER)).toBeNull()
  })

  it('returns origin from KV', async () => {
    const env = makeEnv({ [ORIGIN_KV]: JSON.stringify({ lat: 25.1, lng: 121.6, set_at: '2026-01-01T00:00:00Z' }) })
    expect(await getCurrentOrigin(env, USER)).toEqual({ lat: 25.1, lng: 121.6 })
  })

  it('setCurrentOrigin writes with 2h TTL', async () => {
    const env = makeEnv()
    await setCurrentOrigin(env, USER, 25.1, 121.6)
    const kvPut = (env.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(ORIGIN_KV, expect.any(String), { expirationTtl: 7200 })
  })

  it('clearCurrentOrigin deletes the KV key', async () => {
    const env = makeEnv({ [ORIGIN_KV]: '{"lat":25.1,"lng":121.6,"set_at":""}' })
    await clearCurrentOrigin(env, USER)
    const kvDel = (env.ALFRED_KV as unknown as { delete: ReturnType<typeof vi.fn> }).delete
    expect(kvDel).toHaveBeenCalledWith(ORIGIN_KV)
  })
})

describe('getEffectiveOrigin', () => {
  it('prefers current_origin over home', async () => {
    const env = makeEnv({
      [ORIGIN_KV]: JSON.stringify({ lat: 25.1, lng: 121.6, set_at: '' }),
      [HOME_KV]:   JSON.stringify({ lat: 25.05, lng: 121.52, address: '台北', configured_at: '' }),
    })
    mockGetSettings.mockResolvedValue(null)
    const origin = await getEffectiveOrigin(env, USER)
    expect(origin).toEqual({ lat: 25.1, lng: 121.6, source: 'current' })
  })

  it('falls back to home when no current_origin', async () => {
    const env = makeEnv({ [HOME_KV]: JSON.stringify({ lat: 25.05, lng: 121.52, address: '台北', configured_at: '' }) })
    mockGetSettings.mockResolvedValue(null)
    const origin = await getEffectiveOrigin(env, USER)
    expect(origin).toEqual({ lat: 25.05, lng: 121.52, source: 'home' })
  })

  it('returns source: null when nothing is set', async () => {
    const env = makeEnv()
    mockGetSettings.mockResolvedValueOnce(null)
    const origin = await getEffectiveOrigin(env, USER)
    expect(origin).toEqual({ source: null })
  })
})

describe('hasBeenPromptedRecently / markHomeprompted', () => {
  it('returns false when not yet prompted', async () => {
    const env = makeEnv()
    expect(await hasBeenPromptedRecently(env, USER)).toBe(false)
  })

  it('returns true after markHomeprompted', async () => {
    const env = makeEnv({ [PROMPTED_KV]: '1' })
    expect(await hasBeenPromptedRecently(env, USER)).toBe(true)
  })

  it('markHomeprompted writes with 7-day TTL', async () => {
    const env = makeEnv()
    await markHomeprompted(env, USER)
    const kvPut = (env.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(PROMPTED_KV, '1', { expirationTtl: 604800 })
  })
})

const PENDING_KV = `user:${USER}:home_update_pending`

describe('markHomeUpdatePending / isHomeUpdatePending / consumeHomeUpdatePending', () => {
  it('markHomeUpdatePending writes with 5-min TTL', async () => {
    const env = makeEnv()
    await markHomeUpdatePending(env, USER)
    const kvPut = (env.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(PENDING_KV, '1', { expirationTtl: 300 })
  })

  it('isHomeUpdatePending returns false when not set', async () => {
    const env = makeEnv()
    expect(await isHomeUpdatePending(env, USER)).toBe(false)
  })

  it('isHomeUpdatePending returns true when flag set', async () => {
    const env = makeEnv({ [PENDING_KV]: '1' })
    expect(await isHomeUpdatePending(env, USER)).toBe(true)
  })

  it('consumeHomeUpdatePending returns false and does not delete when not set', async () => {
    const env = makeEnv()
    const result = await consumeHomeUpdatePending(env, USER)
    expect(result).toBe(false)
    const kvDel = (env.ALFRED_KV as unknown as { delete: ReturnType<typeof vi.fn> }).delete
    expect(kvDel).not.toHaveBeenCalled()
  })

  it('consumeHomeUpdatePending returns true and deletes key when flag set', async () => {
    const env = makeEnv({ [PENDING_KV]: '1' })
    const result = await consumeHomeUpdatePending(env, USER)
    expect(result).toBe(true)
    const kvDel = (env.ALFRED_KV as unknown as { delete: ReturnType<typeof vi.fn> }).delete
    expect(kvDel).toHaveBeenCalledWith(PENDING_KV)
  })
})
