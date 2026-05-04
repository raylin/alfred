import { parseSearchIntent } from './search-parser'
import { searchPlaces } from '../../integrations/notion'
import { sendReply } from '../../integrations/line'
import { buildSearchCarousel } from './flex-message'
import { getEffectiveOrigin } from './home-store'
import { computeRouteMatrix } from '../../integrations/routes-api'
import type { RouteResult } from '../../integrations/routes-api'
import { PlacesError } from './errors'
import { logEvent } from '../../lib/observability'
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

function drivingMinutes(r: RouteResult | null): number {
  if (r?.driving) return r.driving.duration_minutes
  if (r?.transit) return r.transit.duration_minutes
  return Infinity
}

export async function runFlowE(
  input: string,
  replyToken: string,
  env: Env,
  userId?: string,
): Promise<void> {
  const t0 = Date.now()

  // 1. Parse intent with Claude Haiku
  let intent
  try {
    intent = await parseSearchIntent(input, env)
  } catch (err) {
    console.error('[flow-e] search-parser failed', { input, err })
    throw new PlacesError('解析搜尋條件時遇到問題，請換個方式描述看看。')
  }

  // 2. Query Notion (fetch up to FETCH_LIMIT to detect ">10 candidates")
  let candidates: Place[]
  try {
    candidates = await searchPlaces(intent.filters, env, FETCH_LIMIT)
  } catch (err) {
    console.error('[flow-e] searchPlaces failed', { err })
    throw new PlacesError('搜尋時遇到狀況，請再試一次。')
  }

  await logEvent(env, {
    type: 'places.search',
    user_id: userId,
    filters: intent.filters as object,
    result_count: candidates.length,
    duration_ms: Date.now() - t0,
    outcome: 'success',
    meta: { query_intent_summary: intent.query_intent_summary },
  })

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

  // 5. Take top candidates and compute distances for tie-breaking + display (ADR-022, ADR-023)
  const tooMany = ranked.length > NARROW_THRESHOLD
  const top = ranked.slice(0, DISPLAY_LIMIT)

  let distances: (RouteResult | null)[] = top.map(() => null)
  if (userId) {
    try {
      const origin = await getEffectiveOrigin(env, userId)
      if (origin.source !== null) {
        const destinations = top.map(p =>
          p.latitude != null && p.longitude != null
            ? { lat: p.latitude, lng: p.longitude }
            : null,
        )
        const validEntries = destinations
          .map((d, i) => ({ d, i }))
          .filter((x): x is { d: { lat: number; lng: number }; i: number } => x.d !== null)

        if (validEntries.length > 0) {
          const results = await computeRouteMatrix(
            { lat: origin.lat, lng: origin.lng },
            validEntries.map(x => x.d),
            env,
          )
          validEntries.forEach(({ i }, j) => { distances[i] = results[j] ?? null })
        }
      }
    } catch (err) {
      console.warn('[flow-e] distance computation failed (non-fatal)', err)
    }
  }

  // 6. Re-sort top 5: primary = keyword score, secondary = driving distance (ADR-023)
  const topWithMeta = top.map((p, i) => ({
    place: p,
    distance: distances[i],
    score: scorePlace(p, keywords),
  }))
  topWithMeta.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return drivingMinutes(a.distance) - drivingMinutes(b.distance)
  })
  const finalTop = topWithMeta.map(x => x.place)
  const finalDistances = topWithMeta.map(x => x.distance)

  // 7. Build reply messages
  const headerText = tooMany
    ? `找到很多筆，以下是最相關的 ${finalTop.length} 個，可以加條件縮小範圍。`
    : `找到 ${ranked.length} 個符合「${intent.query_intent_summary}」的地點：`

  await sendReply(
    replyToken,
    [
      { type: 'text', text: headerText },
      buildSearchCarousel(finalTop, finalDistances),
    ],
    env.LINE_CHANNEL_ACCESS_TOKEN,
  )
}
