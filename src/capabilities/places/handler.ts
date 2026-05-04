import { detectInputType } from './input-detect'
import { runFlowA } from './flow-a-url'
import { runFlowB } from './flow-b-text'
import { runFlowC } from './flow-c-maps'
import { runFlowD } from './flow-d-instagram'
import { runFlowE } from './flow-e-search'
import { runFlowVisit } from './flow-visit'
import { runFlowEdit } from './flow-edit'
import { runFlowDelete } from './flow-delete'
import { runFlowImage, type ImageInput } from './flow-image'
import { PlacesError } from './errors'
import { sendReply, getChatId, type LineSource } from '../../integrations/line'
import { classifyPlacesIntent } from '../../core/places-intent-classifier'
import type { PlacesIntentContext } from '../../core/places-intent-classifier'
import { readPendingRating, clearPendingRating } from './kv-store'
import type { LastPlaceData } from './kv-store'
import { patchVisitRating } from '../../integrations/notion'
import { recomputePlaceSummary } from './visit-summary'
import { handleUnknown } from '../../core/unknown-handler'
import type { Env } from '../../core/env'

const CONTEXT_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

async function readPlacesContext(env: Env, userId: string | undefined): Promise<PlacesIntentContext> {
  if (!userId) return {}
  try {
    const raw = await env.ALFRED_KV.get(`user:${userId}:last_place`)
    if (!raw) return {}
    const lastPlace = JSON.parse(raw) as LastPlaceData
    const ageMs = Date.now() - new Date(lastPlace.sent_at).getTime()
    if (ageMs > CONTEXT_WINDOW_MS) return {}
    return {
      just_replied_card_at: lastPlace.sent_at,
      last_place_internal_id: lastPlace.internal_id,
    }
  } catch {
    return {}
  }
}

export async function placesHandler(
  input: string,
  replyToken: string,
  env: Env,
  source?: LineSource,
): Promise<void> {
  const inputType = detectInputType(input)
  const userId = source?.userId
  const chatId = source !== undefined ? getChatId(source) : undefined

  try {
    if (inputType === 'url') {
      await runFlowA(input, replyToken, env, userId, chatId)
      return
    }

    if (inputType === 'google-maps-url') {
      await runFlowC(input, replyToken, env, userId, chatId)
      return
    }

    if (inputType === 'instagram-url') {
      await runFlowD(input, replyToken, env, userId, chatId)
      return
    }

    // Check pending_rating before intent classifier (spec §D)
    if (userId) {
      const pendingRating = await readPendingRating(env, userId)
      if (pendingRating) {
        const trimmed = input.trim()
        if (/^[1-5]$/.test(trimmed)) {
          const rating = parseInt(trimmed, 10)
          try {
            await patchVisitRating(pendingRating.visit_notion_page_id, rating, env)
            await clearPendingRating(env, userId)
            await recomputePlaceSummary(pendingRating.place_notion_page_id, env)
            await sendReply(replyToken, [{ type: 'text', text: `好，${pendingRating.place_name} 評了 ${rating} 顆星！` }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
          } catch (err) {
            console.error('[places-handler] patchVisitRating failed', err)
            await sendReply(replyToken, [{ type: 'text', text: '評分時遇到狀況，請再試一次。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
          }
          return
        } else if (trimmed === '跳過') {
          await clearPendingRating(env, userId)
          await sendReply(replyToken, [{ type: 'text', text: '好，下次再評！' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
          return
        }
        // Otherwise fall through — user said something else while rating pending
      }
    }

    // Plain text: LLM classifies intent within places capability (ADR-024)
    const context = await readPlacesContext(env, userId)
    const { intent } = await classifyPlacesIntent(input, context, env)

    switch (intent) {
      case 'search':
        await runFlowE(input, replyToken, env, userId)
        return
      case 'add':
        await runFlowB(input, replyToken, env, userId, chatId)
        return
      case 'edit':
        await runFlowEdit(input, replyToken, env, userId, chatId)
        return
      case 'delete':
        await runFlowDelete(input, replyToken, env, userId, chatId)
        return
      case 'visit':
        await runFlowVisit(input, replyToken, env, userId, chatId)
        return
      case 'setup':
        await sendReply(replyToken, [{ type: 'text', text: '要設定家裡位置，打 /setup 或直接分享位置給我。' }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
        return
      default:
        await handleUnknown(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN)
    }
  } catch (err) {
    console.error('[places-handler] flow failed', { inputType, err: String(err) })
    const msg = err instanceof PlacesError ? err.userMessage : '整理時遇到狀況，請再傳一次。'
    try {
      await sendReply(replyToken, [{ type: 'text', text: msg }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    } catch (replyErr) {
      console.error('[places-handler] error reply also failed', String(replyErr))
    }
  }
}

export async function placesImageHandler(
  image: ImageInput,
  replyToken: string,
  env: Env,
  source?: LineSource,
): Promise<void> {
  const userId = source?.userId
  const chatId = source !== undefined ? getChatId(source) : undefined
  try {
    await runFlowImage(image, replyToken, env, userId, chatId)
  } catch (err) {
    console.error('[places-handler] image flow failed', String(err))
    const msg = err instanceof PlacesError ? err.userMessage : '整理時遇到狀況，請再傳一次。'
    try {
      await sendReply(replyToken, [{ type: 'text', text: msg }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    } catch (replyErr) {
      console.error('[places-handler] image error reply also failed', String(replyErr))
    }
  }
}
