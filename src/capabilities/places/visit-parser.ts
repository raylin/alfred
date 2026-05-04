import { createClient, chatJson, MODELS } from '../../integrations/anthropic'
import type { Env } from '../../core/env'

export type VisitParseResult = {
  place_query: string | 'last' | null
  visited_on: string | null  // YYYY-MM-DD
  rating_signal: 1 | 2 | 3 | 4 | 5 | null
  notes: string | null
}

const VALID_RATINGS = new Set([1, 2, 3, 4, 5])

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10)
  return `你是解析造訪記錄的助手。用戶用中文描述去了哪個地方、什麼時候去的、有什麼備註。

請回傳 JSON：
{
  "place_query": string | "last" | null,
  "visited_on": "YYYY-MM-DD" | null,
  "rating_signal": 1~5整數 | null,
  "notes": string | null
}

規則：
- place_query: 具體地名 → 回傳地名; 「上次那個」「剛剛那個」「那個地方」→ "last"; 無法判斷 → null
- visited_on: 今天="${today}", 昨天=前一天日期, 具體日期轉換 YYYY-MM-DD; 無法判斷 → null
- rating_signal: 明確的幾顆星/幾分(1-5整數) → 回傳數字; 只有好壞評語 → null
- notes: 去掉地名、日期後的描述性文字; 無 → null
只回傳 JSON。`
}

function sanitize(raw: unknown): VisitParseResult {
  if (typeof raw !== 'object' || raw === null) {
    return { place_query: null, visited_on: null, rating_signal: null, notes: null }
  }
  const r = raw as Record<string, unknown>
  const placeQuery = typeof r['place_query'] === 'string' ? r['place_query'] : null
  const visitedOn =
    typeof r['visited_on'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r['visited_on'] as string)
      ? (r['visited_on'] as string)
      : null
  const ratingRaw = r['rating_signal']
  const ratingSignal =
    typeof ratingRaw === 'number' && VALID_RATINGS.has(ratingRaw)
      ? (ratingRaw as 1 | 2 | 3 | 4 | 5)
      : null
  const notes =
    typeof r['notes'] === 'string' && (r['notes'] as string).length > 0
      ? (r['notes'] as string)
      : null
  return { place_query: placeQuery, visited_on: visitedOn, rating_signal: ratingSignal, notes }
}

export async function parseVisitMessage(message: string, env: Env): Promise<VisitParseResult> {
  const client = createClient(env)
  const system = buildSystemPrompt()
  const attempt = async () => sanitize(await chatJson<unknown>(client, MODELS.extraction, system, message))

  try {
    return await attempt()
  } catch {
    try {
      return await attempt()
    } catch {
      return { place_query: null, visited_on: null, rating_signal: null, notes: null }
    }
  }
}
