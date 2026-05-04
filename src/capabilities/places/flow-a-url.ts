import { fetchWithTimeout } from '../../lib/url-utils'
import { stripHtml } from '../../lib/html-extract'
import { extractFromHtml } from './extract'
import { createPlace } from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import { buildDraftCard } from './flex-message'
import { writeRawExtraction, writeUserLastPlace } from './kv-store'
import { PlacesError } from './errors'
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

  // 4. Write to Notion
  let notionResult
  try {
    notionResult = await createPlace(place, env)
  } catch (err) {
    console.error('[flow-a] notion write failed', { url, err })
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    throw new PlacesError(`已經整理好了，但寫入 Notion 失敗。錯誤：${msg}`)
  }

  // 5. Write to KV — best-effort, each write independent so one failure can't block the other
  try {
    await writeRawExtraction(env, place.internal_id, {
      raw_input: url,
      raw_html: text,
      extracted_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[flow-a] KV writeRawExtraction failed (non-fatal)', err)
  }
  if (userId !== undefined && chatId !== undefined) {
    try {
      await writeUserLastPlace(env, userId, place.internal_id, chatId)
    } catch (err) {
      console.error('[flow-a] KV writeUserLastPlace failed (non-fatal)', err)
    }
  }

  // 6. Send Flex Message reply (chatId enables push fallback if reply token expired)
  const fullPlace = { ...place, notion_url: notionResult.url, notion_page_id: notionResult.notion_page_id }
  await sendReply(replyToken, [buildDraftCard(fullPlace)], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
}
