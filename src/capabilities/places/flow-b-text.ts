import { textSearch, getPlaceDetails, toGooglePlacesContext } from '../../integrations/google-places'
import { extractFromGooglePlaces } from './extract'
import { createPlace } from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import { buildDraftCard } from './flex-message'
import { writeRawExtraction, writeUserLastPlace } from './kv-store'
import { PlacesError } from './errors'
import type { Env } from '../../core/env'

export async function runFlowB(
  input: string,
  replyToken: string,
  env: Env,
  userId?: string,
  chatId?: string,
): Promise<void> {
  // 1. Search Google Places
  let candidates
  try {
    candidates = await textSearch(input, env)
  } catch (err) {
    console.error('[flow-b] textSearch failed', { input, err })
    throw new PlacesError('搜尋時遇到狀況，請再試一次。')
  }

  if (candidates.length === 0) {
    throw new PlacesError('找不到這個地點，可以試著用更具體的名稱或地址嗎？')
  }

  // 2. Get full details for top candidate
  const top = candidates[0]
  let details
  try {
    details = await getPlaceDetails(top.place_id, env)
  } catch (err) {
    console.error('[flow-b] getPlaceDetails failed', { placeId: top.place_id, err })
    throw new PlacesError('搜尋時遇到狀況，請再試一次。')
  }

  if (!details) {
    throw new PlacesError('找不到這個地點的詳細資訊，請再試一次。')
  }

  // 3. Claude extraction
  let place
  try {
    const context = toGooglePlacesContext(details)
    const rawPlace = await extractFromGooglePlaces(input, context, [], env)
    place = {
      ...rawPlace,
      google_place_id: details.place_id,
      latitude: details.lat,
      longitude: details.lng,
    }
  } catch (err) {
    console.error('[flow-b] extraction failed', { input, err })
    throw new PlacesError('整理時遇到狀況，請再傳一次。如果一直失敗，可以直接在 Notion 手動建立。')
  }

  // 4. Write to Notion
  let notionResult
  try {
    notionResult = await createPlace(place, env)
  } catch (err) {
    console.error('[flow-b] notion write failed', { input, err })
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    throw new PlacesError(`已經整理好了，但寫入 Notion 失敗。錯誤：${msg}`)
  }

  // 5. Write to KV — best-effort
  try {
    await writeRawExtraction(env, place.internal_id, {
      raw_input: input,
      raw_google_places: JSON.stringify(details),
      extracted_at: new Date().toISOString(),
    })
    if (userId !== undefined && chatId !== undefined) {
      await writeUserLastPlace(env, userId, place.internal_id, chatId)
    }
  } catch (err) {
    console.error('[flow-b] KV write failed (non-fatal)', err)
  }

  // 6. Send Flex Message reply (with disambiguation note if multiple candidates)
  const note = candidates.length > 1
    ? `找到的是：${details.formatted_address}，不是的話告訴我正確的地點。`
    : undefined
  const fullPlace = { ...place, notion_url: notionResult.url, notion_page_id: notionResult.notion_page_id }
  await sendReply(replyToken, [buildDraftCard(fullPlace, note)], env.LINE_CHANNEL_ACCESS_TOKEN)
}
