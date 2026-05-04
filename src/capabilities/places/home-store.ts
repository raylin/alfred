import type { Env } from '../../core/env'
import { getSettingsByLineUserId, upsertSettings } from '../../integrations/notion'

// KV key helpers
const kvHome = (userId: string) => `user:${userId}:home`
const kvOrigin = (userId: string) => `user:${userId}:current_origin`
const kvPrompted = (userId: string) => `user:${userId}:home_prompted_at`
const kvUpdatePending = (userId: string) => `user:${userId}:home_update_pending`

const CURRENT_ORIGIN_TTL   = 2 * 60 * 60     // 2 hours
const HOME_PROMPTED_TTL    = 7 * 24 * 60 * 60 // 7 days
const HOME_UPDATE_PENDING_TTL = 5 * 60        // 5 minutes

export type HomeLocation = { lat: number; lng: number; address: string }

type HomeKVData = { lat: number; lng: number; address: string; configured_at: string }
type OriginKVData = { lat: number; lng: number; set_at: string }

export type EffectiveOrigin =
  | { lat: number; lng: number; source: 'current' | 'home' }
  | { source: null }

// --- Home location ---

export async function getHomeLocation(env: Env, userId: string): Promise<HomeLocation | null> {
  // Fast path: KV
  try {
    const raw = await env.ALFRED_KV.get(kvHome(userId))
    if (raw) {
      const d = JSON.parse(raw) as HomeKVData
      if (d.lat && d.lng) return { lat: d.lat, lng: d.lng, address: d.address }
    }
  } catch { /* KV miss or corrupt → fall through */ }

  // Slow path: Settings DB
  try {
    const row = await getSettingsByLineUserId(env, userId)
    if (row?.home_lat != null && row.home_lng != null) {
      const loc: HomeLocation = {
        lat: row.home_lat,
        lng: row.home_lng,
        address: row.home_address ?? '',
      }
      // Backfill KV cache (no TTL — home persists)
      await env.ALFRED_KV.put(kvHome(userId), JSON.stringify({
        lat: loc.lat, lng: loc.lng, address: loc.address,
        configured_at: row.configured_at ?? new Date().toISOString(),
      }))
      return loc
    }
  } catch { /* Notion unavailable */ }

  return null
}

export async function setHomeLocation(
  env: Env,
  userId: string,
  lat: number,
  lng: number,
  address: string,
): Promise<void> {
  const configuredAt = new Date().toISOString().split('T')[0]

  // Write KV (no TTL — home persists)
  const kvData: HomeKVData = { lat, lng, address, configured_at: configuredAt }
  await env.ALFRED_KV.put(kvHome(userId), JSON.stringify(kvData))

  // Write Settings DB (source of truth)
  await upsertSettings(env, {
    line_user_id: userId,
    display_name: null,
    home_address: address,
    home_lat: lat,
    home_lng: lng,
    configured_at: configuredAt,
  })
}

// --- Current origin (temporary 2h override) ---

export async function getCurrentOrigin(env: Env, userId: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const raw = await env.ALFRED_KV.get(kvOrigin(userId))
    if (!raw) return null
    const d = JSON.parse(raw) as OriginKVData
    return { lat: d.lat, lng: d.lng }
  } catch {
    return null
  }
}

export async function setCurrentOrigin(env: Env, userId: string, lat: number, lng: number): Promise<void> {
  const data: OriginKVData = { lat, lng, set_at: new Date().toISOString() }
  await env.ALFRED_KV.put(kvOrigin(userId), JSON.stringify(data), {
    expirationTtl: CURRENT_ORIGIN_TTL,
  })
}

export async function clearCurrentOrigin(env: Env, userId: string): Promise<void> {
  await env.ALFRED_KV.delete(kvOrigin(userId))
}

// --- Effective origin for distance calculation ---

export async function getEffectiveOrigin(env: Env, userId: string): Promise<EffectiveOrigin> {
  const current = await getCurrentOrigin(env, userId)
  if (current) return { ...current, source: 'current' }

  const home = await getHomeLocation(env, userId)
  if (home) return { lat: home.lat, lng: home.lng, source: 'home' }

  return { source: null }
}

// --- First-time home prompt ---

export async function hasBeenPromptedRecently(env: Env, userId: string): Promise<boolean> {
  const v = await env.ALFRED_KV.get(kvPrompted(userId))
  return v !== null
}

export async function markHomeprompted(env: Env, userId: string): Promise<void> {
  await env.ALFRED_KV.put(kvPrompted(userId), '1', { expirationTtl: HOME_PROMPTED_TTL })
}

// --- Home update pending flag (set by /setup, consumed by next location message) ---

export async function markHomeUpdatePending(env: Env, userId: string): Promise<void> {
  await env.ALFRED_KV.put(kvUpdatePending(userId), '1', { expirationTtl: HOME_UPDATE_PENDING_TTL })
}

export async function isHomeUpdatePending(env: Env, userId: string): Promise<boolean> {
  const v = await env.ALFRED_KV.get(kvUpdatePending(userId))
  return v !== null
}

export async function consumeHomeUpdatePending(env: Env, userId: string): Promise<boolean> {
  const pending = await isHomeUpdatePending(env, userId)
  if (!pending) return false
  try {
    await env.ALFRED_KV.delete(kvUpdatePending(userId))
  } catch { /* deletion failure is non-fatal — TTL will expire it */ }
  return true
}
