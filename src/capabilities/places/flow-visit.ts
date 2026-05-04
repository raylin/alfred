import { parseVisitMessage } from './visit-parser'
import { recomputePlaceSummary } from './visit-summary'
import { buildDisambiguateCard } from './disambiguate'
import { buildVisitCard } from './flex-message'
import {
  createVisit,
  searchPlaces,
  getPlaceByNotionPageId,
  findPlaceByInternalId,
} from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import {
  writePendingRating,
  writePendingVisit,
  readPendingVisit,
  clearPendingVisit,
} from './kv-store'
import { logEvent } from '../../lib/observability'
import type { LastPlaceData } from './kv-store'
import type { Place } from './schema'
import type { Env } from '../../core/env'

const LAST_PLACE_MAX_AGE_MS = 24 * 60 * 60 * 1000  // 24h matches KV TTL

async function resolveLastPlace(env: Env, userId: string): Promise<Place | null> {
  try {
    const raw = await env.ALFRED_KV.get(`user:${userId}:last_place`)
    if (!raw) return null
    const lastPlace = JSON.parse(raw) as LastPlaceData
    if (Date.now() - new Date(lastPlace.sent_at).getTime() > LAST_PLACE_MAX_AGE_MS) return null
    return await findPlaceByInternalId(lastPlace.internal_id, env)
  } catch {
    return null
  }
}

async function recordVisitAndReply(
  place: Place,
  visited_on: string | null,
  rating_signal: 1 | 2 | 3 | 4 | 5 | null,
  notes: string | null,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  const t0 = Date.now()
  const date = visited_on ?? new Date().toISOString().slice(0, 10)
  const notionPageId = place.notion_page_id!

  let visitResult: { notion_page_id: string }
  try {
    visitResult = await createVisit({
      place_notion_page_id: notionPageId,
      place_name: place.name,
      visited_on: date,
      rating: rating_signal,
      notes,
      logged_by: userId ?? null,
    }, env)
  } catch (err) {
    console.error('[flow-visit] createVisit failed', err)
    const errorMsg = err instanceof Error ? err.message.slice(0, 150) : String(err).slice(0, 150)
    await logEvent(env, { type: 'places.visit.log', user_id: userId, duration_ms: Date.now() - t0, outcome: 'error', error: errorMsg })
    await sendReply(replyToken, [{ type: 'text', text: '記錄時遇到狀況，請再試一次。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  // Recompute Place summary (non-fatal)
  await recomputePlaceSummary(notionPageId, env)

  // Write pending_rating KV if no rating provided
  const askForRating = rating_signal == null
  if (askForRating && userId) {
    try {
      await writePendingRating(env, userId, {
        visit_notion_page_id: visitResult.notion_page_id,
        place_notion_page_id: notionPageId,
        place_name: place.name,
      })
    } catch (err) {
      console.warn('[flow-visit] writePendingRating failed (non-fatal)', err)
    }
  }

  const card = buildVisitCard(place.name, date, notes, rating_signal, askForRating)
  await sendReply(replyToken, [card], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
  await logEvent(env, { type: 'places.visit.log', user_id: userId, duration_ms: Date.now() - t0, outcome: 'success', meta: { has_rating: rating_signal !== null } })
}

export async function runFlowVisit(
  message: string,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  const parsed = await parseVisitMessage(message, env)

  if (parsed.place_query === null) {
    await sendReply(replyToken, [{ type: 'text', text: '你說的是哪個地方呢？可以告訴我地點名稱嗎？' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  let place: Place | null = null

  if (parsed.place_query === 'last') {
    if (userId) place = await resolveLastPlace(env, userId)
    if (!place) {
      await sendReply(replyToken, [{ type: 'text', text: '不太確定上次那個是哪個，可以告訴我地點名稱嗎？' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }
  } else {
    let candidates: Place[]
    try {
      candidates = await searchPlaces({ free_text_keywords: [parsed.place_query] }, env, 5)
    } catch (err) {
      console.error('[flow-visit] searchPlaces failed', err)
      await sendReply(replyToken, [{ type: 'text', text: '搜尋地點時遇到狀況，請再試一次。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }

    if (candidates.length === 0) {
      await sendReply(replyToken, [{ type: 'text', text: `找不到「${parsed.place_query}」的記錄。要先把地點加入嗎？` }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }

    if (candidates.length === 1) {
      place = candidates[0]
    } else {
      // Multiple candidates — save parse context, show disambiguation (ADR-025)
      if (userId) {
        try {
          await writePendingVisit(env, userId, {
            visited_on: parsed.visited_on,
            rating_signal: parsed.rating_signal,
            notes: parsed.notes,
          })
        } catch (err) {
          console.warn('[flow-visit] writePendingVisit failed (non-fatal)', err)
        }
      }
      await sendReply(replyToken, [buildDisambiguateCard(candidates, 'visit')], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }
  }

  await recordVisitAndReply(place, parsed.visited_on, parsed.rating_signal, parsed.notes, replyToken, env, userId, chatId)
}

// Called when user taps a button in the disambiguation card (ADR-026)
export async function runFlowVisitSelect(
  notionPageId: string,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  const place = await getPlaceByNotionPageId(notionPageId, env)
  if (!place) {
    await sendReply(replyToken, [{ type: 'text', text: '找不到那個地方的資料，請再試一次。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  let visited_on: string | null = null
  let rating_signal: 1 | 2 | 3 | 4 | 5 | null = null
  let notes: string | null = null

  if (userId) {
    try {
      const pending = await readPendingVisit(env, userId)
      if (pending) {
        visited_on = pending.visited_on
        rating_signal = pending.rating_signal
        notes = pending.notes
        await clearPendingVisit(env, userId)
      }
    } catch (err) {
      console.warn('[flow-visit-select] readPendingVisit failed (non-fatal)', err)
    }
  }

  await recordVisitAndReply(place, visited_on, rating_signal, notes, replyToken, env, userId, chatId)
}
