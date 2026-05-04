import { parseSearchIntent } from './search-parser'
import { searchPlaces } from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import { buildSearchCarousel } from './flex-message'
import { PlacesError } from './errors'
import type { Place } from './schema'
import type { Env } from '../../core/env'

const FETCH_LIMIT = 20
const DISPLAY_LIMIT = 5
const NARROW_THRESHOLD = 10

function scorePlace(place: Place, keywords: string[]): number {
  const corpus = [
    place.name,
    place.summary,
    place.address ?? '',
    place.categories.join(' '),
    place.fee_details ?? '',
  ].join(' ')
  return keywords.filter(kw => corpus.includes(kw)).length
}

function sortByKeywords(places: Place[], keywords: string[]): Place[] {
  if (keywords.length === 0) return places
  return [...places].sort((a, b) => scorePlace(b, keywords) - scorePlace(a, keywords))
}

export async function runFlowE(
  input: string,
  replyToken: string,
  env: Env,
): Promise<void> {
  // 1. Parse intent with Claude Haiku
  let intent
  try {
    intent = await parseSearchIntent(input, env)
  } catch (err) {
    console.error('[flow-e] search-parser failed', { input, err })
    throw new PlacesError('解析搜尋條件時遇到問題，請換個方式描述看看。')
  }

  console.log(JSON.stringify({
    type: 'search_query',
    raw_input: input,
    parsed_filters: intent.filters,
    query_intent_summary: intent.query_intent_summary,
  }))

  // 2. Query Notion (fetch up to FETCH_LIMIT to detect ">10 candidates")
  let candidates: Place[]
  try {
    candidates = await searchPlaces(intent.filters, env, FETCH_LIMIT)
  } catch (err) {
    console.error('[flow-e] searchPlaces failed', { err })
    throw new PlacesError('搜尋時遇到狀況，請再試一次。')
  }

  console.log(JSON.stringify({
    type: 'search_result',
    candidate_count: candidates.length,
    query_intent_summary: intent.query_intent_summary,
  }))

  // 3. In-memory keyword re-ranking
  const keywords = intent.filters.free_text_keywords ?? []
  const ranked = sortByKeywords(candidates, keywords)

  // 4. Handle 0 results
  if (ranked.length === 0) {
    await sendReply(
      replyToken,
      [{ type: 'text', text: '沒有完全符合的耶，要不要放寬條件？例如不限室內外。' }],
      env.LINE_CHANNEL_ACCESS_TOKEN,
    )
    return
  }

  // 5. Build reply messages
  const tooMany = ranked.length > NARROW_THRESHOLD
  const top = ranked.slice(0, DISPLAY_LIMIT)

  const headerText = tooMany
    ? `找到很多筆，以下是最相關的 ${top.length} 個，可以加條件縮小範圍。`
    : `找到 ${ranked.length} 個符合「${intent.query_intent_summary}」的地點：`

  await sendReply(
    replyToken,
    [
      { type: 'text', text: headerText },
      buildSearchCarousel(top),
    ],
    env.LINE_CHANNEL_ACCESS_TOKEN,
  )
}
