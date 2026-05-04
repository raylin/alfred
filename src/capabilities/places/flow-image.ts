import { extractFromImage, NoPlaceDetectedError } from './extract'
import { createPlace } from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import { buildDraftCard, buildDedupCard } from './flex-message'
import { writeRawExtraction, writeUserLastPlace } from './kv-store'
import { checkDuplicate, writeDedupKV } from './duplicate-check'
import { resolveGooglePlace } from './resolve-google-place'
import { PlacesError } from './errors'
import type { Env } from '../../core/env'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export type ImageInput = {
  contentBase64: string
  mimeType: string
  sizeBytes: number
  lineMessageId: string
}

export async function runFlowImage(
  image: ImageInput,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  // 1. Size check (Claude API limit: 5MB per image)
  if (image.sizeBytes > MAX_IMAGE_BYTES) {
    await sendReply(
      replyToken,
      [{ type: 'text', text: '圖片太大了，可以截小一點再傳嗎？或直接告訴我地點名稱。' }],
      env.LINE_CHANNEL_ACCESS_TOKEN,
      chatId,
    )
    return
  }

  // 2. Claude Vision extraction
  let place
  try {
    place = await extractFromImage(image.contentBase64, image.mimeType, env)
  } catch (err) {
    if (err instanceof NoPlaceDetectedError) {
      await sendReply(
        replyToken,
        [{ type: 'text', text: '看起來不是景點相關的圖，可以再試一次，或直接告訴我地點名稱。' }],
        env.LINE_CHANNEL_ACCESS_TOKEN,
        chatId,
      )
      return
    }
    console.error('[flow-image] extraction failed', err)
    throw new PlacesError('整理時遇到狀況，請再傳一次。如果一直失敗，可以直接告訴我地點名稱。')
  }

  // 3. Resolve Google Place ID (best-effort — enables dedup + precise coords)
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

  // 4. Duplicate check
  if (place.google_place_id) {
    const dedup = await checkDuplicate(place.google_place_id, env)
    if (dedup.found) {
      await sendReply(replyToken, [buildDedupCard(dedup.name)], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
      return
    }
  }

  // 5. Write to Notion
  let notionResult
  try {
    notionResult = await createPlace(place, env)
  } catch (err) {
    console.error('[flow-image] notion write failed', err)
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    throw new PlacesError(`已經整理好了，但寫入 Notion 失敗。錯誤：${msg}`)
  }

  // 6. Write to KV — best-effort; do NOT store base64 image body (ADR-013)
  try {
    await writeRawExtraction(env, place.internal_id, {
      raw_input: {
        type: 'image',
        line_message_id: image.lineMessageId,
        mime_type: image.mimeType,
        size_bytes: image.sizeBytes,
      },
      raw_claude_response: JSON.stringify(place),
      extracted_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[flow-image] KV writeRawExtraction failed (non-fatal)', err)
  }
  if (place.google_place_id) {
    try {
      await writeDedupKV(env, place.google_place_id, notionResult.notion_page_id, place.internal_id, place.name)
    } catch (err) {
      console.error('[flow-image] KV writeDedupKV failed (non-fatal)', err)
    }
  }
  if (userId !== undefined && chatId !== undefined) {
    try {
      await writeUserLastPlace(env, userId, place.internal_id, chatId)
    } catch (err) {
      console.error('[flow-image] KV writeUserLastPlace failed (non-fatal)', err)
    }
  }

  // 7. Send Flex Message reply
  const fullPlace = { ...place, notion_url: notionResult.url, notion_page_id: notionResult.notion_page_id }
  await sendReply(replyToken, [buildDraftCard(fullPlace)], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
}
