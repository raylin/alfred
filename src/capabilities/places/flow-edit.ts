import { parseEditIntent, parseEditTarget } from './edit-parser'
import { applyEdits, summarizeOp } from './apply-edit'
import { buildDisambiguateCard } from './disambiguate'
import { getPlaceByNotionPageId, findPlaceByInternalId, searchPlaces } from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import { writePendingEdit, readPendingEdit, clearPendingEdit } from './kv-store'
import { logEvent } from '../../lib/observability'
import type { LastPlaceData } from './kv-store'
import type { Place } from './schema'
import type { Env } from '../../core/env'

const ANCHOR_STRONG_MS = 5 * 60 * 1000  // 5 min

async function resolveEditAnchor(env: Env, userId: string): Promise<Place | null> {
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

async function performEdit(
  place: Place,
  editMessage: string,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  const t0 = Date.now()
  const edits = await parseEditIntent(editMessage, place, env)

  if (edits.length === 0) {
    await sendReply(replyToken, [{ type: 'text', text: '沒看出要改什麼，可以再具體一點嗎？(例如「改成 5-10 歲」)' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  const result = await applyEdits(place.notion_page_id!, edits, env)

  const isRenameAttempt = result.failed.some(f => f.error === 'rename_not_supported')

  if (result.applied.length === 0) {
    const errMsg = isRenameAttempt ? 'rename_not_supported' : (result.failed[0]?.error?.slice(0, 60) ?? '未知錯誤')
    await logEvent(env, { type: 'places.edit', user_id: userId, duration_ms: Date.now() - t0, outcome: 'error', error: errMsg })
    if (isRenameAttempt) {
      await sendReply(replyToken, [{ type: 'text', text: '想改名的話，請刪除這筆重新加入。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    } else {
      await sendReply(replyToken, [{ type: 'text', text: `更新失敗，請再試一次。(${errMsg})` }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    }
    return
  }

  const appliedSummary = result.applied.map(summarizeOp).join('、')
  let text = `✓ 已更新：${appliedSummary}`

  if (isRenameAttempt) {
    text += '\n(改名不支援，請刪除重新加入)'
  } else if (result.failed.length > 0) {
    const failedList = result.failed.map(f => f.op.property).join('、')
    text += `\n但 ${failedList} 沒改成功`
  }

  await sendReply(replyToken, [{ type: 'text', text }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
  await logEvent(env, {
    type: 'places.edit',
    user_id: userId,
    duration_ms: Date.now() - t0,
    outcome: 'success',
    meta: { applied_count: result.applied.length, failed_count: result.failed.length },
  })
}

export async function runFlowEdit(
  message: string,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  // 1. Try last_place anchor (Story I)
  let targetPlace: Place | null = null
  let editMessage = message

  if (userId) {
    targetPlace = await resolveEditAnchor(env, userId)
  }

  // 2. No anchor — extract place name from message (Story J)
  if (!targetPlace) {
    const target = await parseEditTarget(message, env)
    if (!target.target_place_name) {
      await sendReply(replyToken, [{ type: 'text', text: '不確定要改哪一筆，可以指名嗎？(例如「大湖公園 改成室內」)' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }

    editMessage = target.edit_message

    let candidates: Place[]
    try {
      candidates = await searchPlaces({ free_text_keywords: [target.target_place_name] }, env, 5)
    } catch (err) {
      console.error('[flow-edit] searchPlaces failed', err)
      await sendReply(replyToken, [{ type: 'text', text: '搜尋時遇到狀況，請再試一次。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }

    if (candidates.length === 0) {
      await sendReply(replyToken, [{ type: 'text', text: `沒找到「${target.target_place_name}」，可以講具體一點嗎？` }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }

    if (candidates.length === 1) {
      targetPlace = candidates[0]
    } else {
      if (userId) {
        try {
          await writePendingEdit(env, userId, { edit_message: editMessage })
        } catch (err) {
          console.warn('[flow-edit] writePendingEdit failed (non-fatal)', err)
        }
      }
      await sendReply(replyToken, [buildDisambiguateCard(candidates, 'edit')], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }
  }

  await performEdit(targetPlace, editMessage, replyToken, env, userId, chatId)
}

// Called when user taps a button in the edit disambiguation card
export async function runFlowEditSelect(
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

  let editMessage = ''
  if (userId) {
    try {
      const pending = await readPendingEdit(env, userId)
      if (pending) {
        editMessage = pending.edit_message
        await clearPendingEdit(env, userId)
      }
    } catch (err) {
      console.warn('[flow-edit-select] readPendingEdit failed (non-fatal)', err)
    }
  }

  if (!editMessage) {
    await sendReply(replyToken, [{ type: 'text', text: '找不到之前的編輯指令，請重新輸入。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    return
  }

  await performEdit(place, editMessage, replyToken, env, userId, chatId)
}
