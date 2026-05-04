import { findPlaceByGooglePlaceId } from '../../integrations/notion'
import type { Env } from '../../core/env'

export type DedupResult =
  | { found: true; notion_page_id: string; internal_id: string; name: string }
  | { found: false }

type DedupKVData = { notion_page_id: string; internal_id: string; name: string }

const DEDUP_TTL_SECONDS = 30 * 24 * 60 * 60

export async function checkDuplicate(googlePlaceId: string, env: Env): Promise<DedupResult> {
  // Fast path: KV
  try {
    const raw = await env.ALFRED_KV.get(`dedup:${googlePlaceId}`)
    if (raw) {
      const data = JSON.parse(raw) as DedupKVData
      if (data.notion_page_id && data.internal_id && data.name) {
        return { found: true, notion_page_id: data.notion_page_id, internal_id: data.internal_id, name: data.name }
      }
    }
  } catch {
    // KV unavailable or corrupted — fall through to Notion
  }

  // Slow path: Notion
  try {
    const place = await findPlaceByGooglePlaceId(googlePlaceId, env)
    if (place) {
      return {
        found: true,
        notion_page_id: place.notion_page_id ?? '',
        internal_id: place.internal_id,
        name: place.name,
      }
    }
  } catch {
    // Notion unavailable — treat as no duplicate so the flow can proceed
  }

  return { found: false }
}

export async function writeDedupKV(
  env: Env,
  googlePlaceId: string,
  notionPageId: string,
  internalId: string,
  name: string,
): Promise<void> {
  const data: DedupKVData = { notion_page_id: notionPageId, internal_id: internalId, name }
  await env.ALFRED_KV.put(`dedup:${googlePlaceId}`, JSON.stringify(data), {
    expirationTtl: DEDUP_TTL_SECONDS,
  })
}
