import { parseGoogleMapsUrl, getPlaceDetails, textSearch, toGooglePlacesContext } from '../../integrations/google-places'
import { extractFromGooglePlaces } from './extract'
import { createPlace } from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import { buildDraftCard, buildDedupCard } from './flex-message'
import { writeRawExtraction, writeUserLastPlace } from './kv-store'
import { checkDuplicate, writeDedupKV } from './duplicate-check'
import { getEffectiveOrigin } from './home-store'
import { computeSingleRoute } from '../../integrations/routes-api'
import type { RouteResult } from '../../integrations/routes-api'
import { PlacesError } from './errors'
import { logEvent } from '../../lib/observability'
import type { Env } from '../../core/env'

export async function runFlowC(
  url: string,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  const t0 = Date.now()
  try {
  // 1. Parse Google Maps URL → place_id / name / coords
  let parsed
  try {
    parsed = await parseGoogleMapsUrl(url)
  } catch (err) {
    console.error('[flow-c] parseGoogleMapsUrl failed', { url, err })
    throw new PlacesError('解析 Google Maps 連結失敗，請試試直接傳地點名稱。')
  }

  // 2. Get PlaceDetails — prefer place_id, fall back to name search
  let details = null
  try {
    if (parsed.place_id) {
      details = await getPlaceDetails(parsed.place_id, env)
    } else if (parsed.name) {
      const candidates = await textSearch(parsed.name, env)
      if (candidates.length > 0) {
        details = await getPlaceDetails(candidates[0].place_id, env)
      }
    }
  } catch (err) {
    console.error('[flow-c] place lookup failed', { url, err })
    throw new PlacesError('取得地點資訊失敗，請再試一次。')
  }

  if (!details) {
    throw new PlacesError('找不到這個地點的詳細資訊，請試試直接傳地點名稱。')
  }

  // 3. Duplicate check
  const dedup = await checkDuplicate(details.place_id, env)
  if (dedup.found) {
    await logEvent(env, { type: 'places.dedup_hit', user_id: userId, duration_ms: Date.now() - t0, outcome: 'success', meta: { flow: 'maps' } })
    await sendReply(replyToken, [buildDedupCard(dedup.name)], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  // 4. Claude extraction (ai_inferred_fields will be few — most data comes from Google)
  let place
  try {
    const context = toGooglePlacesContext(details)
    const rawPlace = await extractFromGooglePlaces(url, context, ['Google Maps'], env)
    place = {
      ...rawPlace,
      google_place_id: details.place_id,
      latitude: details.lat,
      longitude: details.lng,
    }
  } catch (err) {
    console.error('[flow-c] extraction failed', { url, err })
    throw new PlacesError('整理時遇到狀況，請再傳一次。如果一直失敗，可以直接在 Notion 手動建立。')
  }

  // 5. Write to Notion
  let notionResult
  try {
    notionResult = await createPlace(place, env)
  } catch (err) {
    console.error('[flow-c] notion write failed', { url, err })
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    throw new PlacesError(`已經整理好了，但寫入 Notion 失敗。錯誤：${msg}`)
  }

  // 6. Write to KV — best-effort, each write independent
  try {
    await writeRawExtraction(env, place.internal_id, {
      raw_input: url,
      raw_google_places: JSON.stringify(details),
      extracted_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[flow-c] KV writeRawExtraction failed (non-fatal)', err)
  }
  try {
    await writeDedupKV(env, details.place_id, notionResult.notion_page_id, place.internal_id, place.name)
  } catch (err) {
    console.error('[flow-c] KV writeDedupKV failed (non-fatal)', err)
  }
  if (userId !== undefined && chatId !== undefined) {
    try {
      await writeUserLastPlace(env, userId, place.internal_id, chatId)
    } catch (err) {
      console.error('[flow-c] KV writeUserLastPlace failed (non-fatal)', err)
    }
  }

  // 7. Compute distance post-Notion-write (non-blocking — ADR-022)
  const fullPlace = { ...place, notion_url: notionResult.url, notion_page_id: notionResult.notion_page_id }
  let distance: RouteResult | null = null
  if (userId) {
    try {
      const origin = await getEffectiveOrigin(env, userId)
      if (origin.source !== null && fullPlace.latitude != null && fullPlace.longitude != null) {
        distance = await computeSingleRoute({ lat: origin.lat, lng: origin.lng }, { lat: fullPlace.latitude, lng: fullPlace.longitude }, env)
      }
    } catch (err) {
      console.warn('[flow-c] distance computation failed (non-fatal)', err)
    }
  }

  // 8. Send Flex Message reply
  await sendReply(replyToken, [buildDraftCard(fullPlace, undefined, distance)], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
  await logEvent(env, { type: 'places.add.url', user_id: userId, duration_ms: Date.now() - t0, outcome: 'success', meta: { flow: 'maps' } })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message.slice(0, 100) : String(err).slice(0, 100)
    await logEvent(env, { type: 'places.add.url', user_id: userId, duration_ms: Date.now() - t0, outcome: 'error', error: errorMsg, meta: { flow: 'maps' } })
    throw err
  }
}
