import { fetchWithTimeout } from '../../lib/url-utils'
import { extractFromHtml } from './extract'
import { createPlace } from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import { buildDraftCard, buildDedupCard } from './flex-message'
import { writeRawExtraction, writeUserLastPlace } from './kv-store'
import { checkDuplicate, writeDedupKV } from './duplicate-check'
import { resolveGooglePlace } from './resolve-google-place'
import { getEffectiveOrigin } from './home-store'
import { computeSingleRoute } from '../../integrations/routes-api'
import type { RouteResult } from '../../integrations/routes-api'
import { PlacesError } from './errors'
import { logEvent } from '../../lib/observability'
import type { Env } from '../../core/env'

const FETCH_TIMEOUT_MS = 12_000
const IG_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
const MIN_DESCRIPTION_LENGTH = 30
const IG_FALLBACK = 'IG 連結我目前還沒辦法直接讀，可以截圖傳給我，或直接告訴我地點名稱。'

function extractOgDescription(html: string): string {
  const m =
    html.match(/<meta\s[^>]*property="og:description"\s[^>]*content="([^"]*)"/) ??
    html.match(/<meta\s[^>]*content="([^"]*)"\s[^>]*property="og:description"/)
  return m?.[1] ?? ''
}

export async function runFlowD(
  url: string,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  const t0 = Date.now()
  try {
  // 1. Fetch IG page with facebookexternalhit UA to get OG tags
  let ogDescription = ''
  let rawHtml = ''
  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, {
      headers: { 'User-Agent': IG_UA },
    })
    if (res.ok) {
      rawHtml = await res.text()
      ogDescription = extractOgDescription(rawHtml)
    }
  } catch (err) {
    console.error('[flow-d] IG fetch failed', { url, err })
  }

  // 2. If og:description too sparse, send fallback and return
  if (ogDescription.length < MIN_DESCRIPTION_LENGTH) {
    await logEvent(env, { type: 'places.add.instagram', user_id: userId, duration_ms: Date.now() - t0, outcome: 'unknown', error: 'ig_description_too_short' })
    await sendReply(replyToken, [{ type: 'text', text: IG_FALLBACK }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  // 3. Claude extraction (using og:description as the "text" input)
  let place
  try {
    place = await extractFromHtml(url, ogDescription, env)
  } catch (err) {
    console.error('[flow-d] extraction failed', { url, err })
    await logEvent(env, { type: 'places.add.instagram', user_id: userId, duration_ms: Date.now() - t0, outcome: 'error', error: 'ig_extraction_failed' })
    await sendReply(replyToken, [{ type: 'text', text: IG_FALLBACK }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  // 4. Resolve Google Place ID (best-effort — enables dedup + precise coords)
  const resolved = await resolveGooglePlace(place, env)
  if (resolved) {
    place = {
      ...place,
      google_place_id: resolved.google_place_id,
      latitude: resolved.lat,
      longitude: resolved.lng,
      address: resolved.address ?? place.address,
    }
  }

  // 5. Duplicate check
  if (place.google_place_id) {
    const dedup = await checkDuplicate(place.google_place_id, env)
    if (dedup.found) {
      await logEvent(env, { type: 'places.dedup_hit', user_id: userId, duration_ms: Date.now() - t0, outcome: 'success', meta: { flow: 'instagram' } })
      await sendReply(replyToken, [buildDedupCard(dedup.name)], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }
  }

  // 6. Write to Notion
  let notionResult
  try {
    notionResult = await createPlace(place, env)
  } catch (err) {
    console.error('[flow-d] notion write failed', { url, err })
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    throw new PlacesError(`已經整理好了，但寫入 Notion 失敗。錯誤：${msg}`)
  }

  // 7. Write to KV — best-effort, each write independent
  try {
    await writeRawExtraction(env, place.internal_id, {
      raw_input: url,
      raw_html: ogDescription,
      extracted_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[flow-d] KV writeRawExtraction failed (non-fatal)', err)
  }
  if (place.google_place_id) {
    try {
      await writeDedupKV(env, place.google_place_id, notionResult.notion_page_id, place.internal_id, place.name)
    } catch (err) {
      console.error('[flow-d] KV writeDedupKV failed (non-fatal)', err)
    }
  }
  if (userId !== undefined && chatId !== undefined) {
    try {
      await writeUserLastPlace(env, userId, place.internal_id, chatId)
    } catch (err) {
      console.error('[flow-d] KV writeUserLastPlace failed (non-fatal)', err)
    }
  }

  // 8. Compute distance post-Notion-write (non-blocking — ADR-022)
  const fullPlace = { ...place, notion_url: notionResult.url, notion_page_id: notionResult.notion_page_id }
  let distance: RouteResult | null = null
  if (userId) {
    try {
      const origin = await getEffectiveOrigin(env, userId)
      if (origin.source !== null && fullPlace.latitude != null && fullPlace.longitude != null) {
        distance = await computeSingleRoute({ lat: origin.lat, lng: origin.lng }, { lat: fullPlace.latitude, lng: fullPlace.longitude }, env)
      }
    } catch (err) {
      console.warn('[flow-d] distance computation failed (non-fatal)', err)
    }
  }

  // 9. Send Flex Message reply
  await sendReply(replyToken, [buildDraftCard(fullPlace, undefined, distance)], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
  await logEvent(env, { type: 'places.add.instagram', user_id: userId, duration_ms: Date.now() - t0, outcome: 'success' })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message.slice(0, 100) : String(err).slice(0, 100)
    await logEvent(env, { type: 'places.add.instagram', user_id: userId, duration_ms: Date.now() - t0, outcome: 'error', error: errorMsg })
    throw err
  }
}
