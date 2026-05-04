import { fetchWithTimeout } from '../../lib/url-utils'
import { stripHtml } from '../../lib/html-extract'
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
const MAX_HTML_CHARS = 4_000

export async function runFlowA(
  url: string,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  const t0 = Date.now()
  try {
    // 1. Fetch the URL
    let html: string
    try {
      const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.includes('html')) throw new Error(`non-HTML content-type: ${contentType}`)
      html = await res.text()
    } catch (err) {
      console.error('[flow-a] fetch failed', { url, err })
      throw new PlacesError('這個網址我打不開耶，可以試試直接告訴我地點名稱嗎？')
    }

    // 2. Strip HTML → readable text
    const text = stripHtml(html, MAX_HTML_CHARS)

    // 3. Claude extraction (extract.ts already retries once)
    let place
    try {
      place = await extractFromHtml(url, text, env)
    } catch (err) {
      console.error('[flow-a] extraction failed', { url, err })
      throw new PlacesError('整理時遇到狀況，請再傳一次。如果一直失敗，可以直接在 Notion 手動建立。')
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

    // 5. Duplicate check (only possible if we have a google_place_id)
    if (place.google_place_id) {
      const dedup = await checkDuplicate(place.google_place_id, env)
      if (dedup.found) {
        await logEvent(env, { type: 'places.dedup_hit', user_id: userId, duration_ms: Date.now() - t0, outcome: 'success', meta: { flow: 'url' } })
        await sendReply(replyToken, [buildDedupCard(dedup.name)], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
        return
      }
    }

    // 6. Write to Notion
    let notionResult
    try {
      notionResult = await createPlace(place, env)
    } catch (err) {
      console.error('[flow-a] notion write failed', { url, err })
      const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
      throw new PlacesError(`已經整理好了，但寫入 Notion 失敗。錯誤：${msg}`)
    }

    // 7. Write to KV — best-effort, each write independent so one failure can't block the other
    try {
      await writeRawExtraction(env, place.internal_id, {
        raw_input: url,
        raw_html: text,
        extracted_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[flow-a] KV writeRawExtraction failed (non-fatal)', err)
    }
    if (place.google_place_id) {
      try {
        await writeDedupKV(env, place.google_place_id, notionResult.notion_page_id, place.internal_id, place.name)
      } catch (err) {
        console.error('[flow-a] KV writeDedupKV failed (non-fatal)', err)
      }
    }
    if (userId !== undefined && chatId !== undefined) {
      try {
        await writeUserLastPlace(env, userId, place.internal_id, chatId)
      } catch (err) {
        console.error('[flow-a] KV writeUserLastPlace failed (non-fatal)', err)
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
        console.warn('[flow-a] distance computation failed (non-fatal)', err)
      }
    }

    // 9. Send Flex Message reply (chatId enables push fallback if reply token expired)
    await sendReply(replyToken, [buildDraftCard(fullPlace, undefined, distance)], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    await logEvent(env, { type: 'places.add.url', user_id: userId, duration_ms: Date.now() - t0, outcome: 'success' })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message.slice(0, 100) : String(err).slice(0, 100)
    await logEvent(env, { type: 'places.add.url', user_id: userId, duration_ms: Date.now() - t0, outcome: 'error', error: errorMsg })
    throw err
  }
}
