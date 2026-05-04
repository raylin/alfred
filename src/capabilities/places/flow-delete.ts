import { parseDeleteIntent } from './delete-parser'
import { buildDisambiguateCard } from './disambiguate'
import { buildDeleteConfirmCard } from './flex-message'
import {
  archivePlace,
  getPlaceByNotionPageId,
  findPlaceByInternalId,
  searchPlaces,
  queryVisitsForPlace,
} from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import { logEvent } from '../../lib/observability'
import type { LastPlaceData } from './kv-store'
import type { Place } from './schema'
import type { Env } from '../../core/env'

const ANCHOR_STRONG_MS = 5 * 60 * 1000  // 5 min

async function resolveDeleteAnchor(env: Env, userId: string): Promise<Place | null> {
  try {
    const raw = await env.ALFRED_KV.get(`user:${userId}:last_place`)
    if (!raw) return null
    const lastPlace = JSON.parse(raw) as LastPlaceData
    if (Date.now() - new Date(lastPlace.sent_at).getTime() > ANCHOR_STRONG_MS) return null
    return await findPlaceByInternalId(lastPlace.internal_id, env)
  } catch {
    return null
  }
}

async function showConfirmCard(
  place: Place,
  replyToken: string,
  env: Env,
  chatId?: string,
): Promise<void> {
  let visitCount = 0
  try {
    const summary = await queryVisitsForPlace(place.notion_page_id!, env)
    visitCount = summary.visit_count
  } catch { /* non-fatal — show 0 */ }

  await sendReply(
    replyToken,
    [buildDeleteConfirmCard(place.name, place.notion_page_id!, visitCount)],
    env.LINE_CHANNEL_ACCESS_TOKEN,
    chatId,
  )
}

async function doDelete(
  place: Place,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  const t0 = Date.now()
  try {
    await archivePlace(place.notion_page_id!, env)
  } catch (err) {
    console.error('[flow-delete] archivePlace failed', err)
    await logEvent(env, { type: 'places.delete', user_id: userId, duration_ms: Date.now() - t0, outcome: 'error', error: 'archive_failed' })
    await sendReply(replyToken, [{ type: 'text', text: '刪除時遇到狀況，請再試一次。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  // Cleanup 1: dedup KV (prevents false-positive duplicate detection on re-add)
  if (place.google_place_id) {
    try {
      await env.ALFRED_KV.delete(`dedup:${place.google_place_id}`)
    } catch { /* non-fatal */ }
  }

  // Cleanup 2: last_place KV if it points to the deleted place
  if (userId) {
    try {
      const raw = await env.ALFRED_KV.get(`user:${userId}:last_place`)
      if (raw) {
        const lastPlace = JSON.parse(raw) as LastPlaceData
        if (lastPlace.internal_id === place.internal_id) {
          await env.ALFRED_KV.delete(`user:${userId}:last_place`)
        }
      }
    } catch { /* non-fatal */ }
  }

  await sendReply(replyToken, [{ type: 'text', text: `✓ 已刪除「${place.name}」` }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
  await logEvent(env, { type: 'places.delete', user_id: userId, duration_ms: Date.now() - t0, outcome: 'success' })
}

export async function runFlowDelete(
  message: string,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  const { target } = await parseDeleteIntent(message, env)

  if (target === null) {
    await sendReply(replyToken, [{ type: 'text', text: '不確定要刪哪一筆，可以指名嗎？(例如「刪掉大湖公園」)' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  if (target === 'last') {
    if (!userId) {
      await sendReply(replyToken, [{ type: 'text', text: '找不到剛剛的記錄，可以告訴我要刪哪個嗎？' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }
    const place = await resolveDeleteAnchor(env, userId)
    if (!place) {
      await sendReply(replyToken, [{ type: 'text', text: '找不到剛剛的記錄，可以告訴我要刪哪個嗎？' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }
    await doDelete(place, replyToken, env, userId, chatId)
    return
  }

  // Named target — requires confirmation
  let candidates: Place[]
  try {
    candidates = await searchPlaces({ free_text_keywords: [target] }, env, 5)
  } catch (err) {
    console.error('[flow-delete] searchPlaces failed', err)
    await sendReply(replyToken, [{ type: 'text', text: '搜尋時遇到狀況，請再試一次。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  if (candidates.length === 0) {
    await sendReply(replyToken, [{ type: 'text', text: `沒找到「${target}」，確認一下名稱？` }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  if (candidates.length === 1) {
    await showConfirmCard(candidates[0], replyToken, env, chatId)
    return
  }

  await sendReply(replyToken, [buildDisambiguateCard(candidates, 'delete')], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
}

// Called when user taps a button in the delete disambiguation card
export async function runFlowDeleteSelect(
  notionPageId: string,
  replyToken: string,
  env: Env,
  _userId?: string,
  chatId?: string,
): Promise<void> {
  const place = await getPlaceByNotionPageId(notionPageId, env)
  if (!place) {
    await sendReply(replyToken, [{ type: 'text', text: '找不到那個地方的資料，請再試一次。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }
  await showConfirmCard(place, replyToken, env, chatId)
}

// Called when user taps 「確認刪除」
export async function runFlowDeleteConfirm(
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
  await doDelete(place, replyToken, env, userId, chatId)
}

// Called when user taps 「取消」
export async function runFlowDeleteCancel(
  _notionPageId: string,
  replyToken: string,
  env: Env,
  _userId?: string,
  chatId?: string,
): Promise<void> {
  await sendReply(replyToken, [{ type: 'text', text: '好，沒刪。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
}
