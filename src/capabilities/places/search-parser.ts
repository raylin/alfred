import { createClient, chatJson, MODELS } from '../../integrations/anthropic'
import type { Env } from '../../core/env'
import type { SearchFilters, VisitState } from './schema'

const SYSTEM_PROMPT = `你把使用者問題轉成 Notion 篩選條件。輸出 JSON，schema：

{
  "filters": {
    "indoor_outdoor": "室內" | "半室內" | "室外" | null,
    "age": number | null,
    "region": string | null,
    "categories": string[] | null,
    "seasons": string[] | null,
    "fee_type": string | null,
    "energy_level": string | null,
    "free_text_keywords": string[],
    "visit_state": "never_visited" | "visited_recently" | "visited_long_ago" | "highly_rated" | "loved_recently" | null
  },
  "query_intent_summary": string
}

規則：
- 推不出來的就 null。
- categories 從 [公園, 餐廳, 步道, 動物園, 遊樂園, 博物館, 圖書館, 親子館, 觀光工廠, 沙灘, 露營地, 室內遊戲場] 選。
- 「下雨天」推測為 indoor_outdoor = "室內"。
- 「三歲」推測為 age = 3。
- free_text_keywords 只放真正描述地點特徵的詞，例如「落羽松」「沙坑」「滑梯」「恐龍」「日式」「複合式」等具體設施或風格詞。
  不要把「附近」「推薦」「幫我」「找」「有什麼」「適合」「帶小孩去」「好的」這類查詢動詞或 meta 詞放進去。
- visit_state：根據造訪相關措辭判斷，推不出來填 null
  * 「沒去過的」「還沒去過的」「我沒去過的」→ "never_visited"
  * 「最近去過的」「上週去過」「這個月去過」→ "visited_recently"
  * 「很久沒去」「半年沒去」「常勝軍」→ "visited_long_ago"
  * 「上次很愛的」「最近很愛的」→ "loved_recently"
  * 「最愛的」「評分高的」→ "highly_rated"
  * 模糊 / 沒提 → null
- 注意：visit-related 措辭優先使用 visit_state，不要把「沒去過」「去過」「喜歡」等造訪語氣詞放進 free_text_keywords。
- 只回 JSON。`

export type ParsedSearchIntent = {
  filters: SearchFilters
  query_intent_summary: string
}

type RawParsed = {
  filters: {
    indoor_outdoor: string | null
    age: number | null
    region: string | null
    categories: string[] | null
    seasons: string[] | null
    fee_type: string | null
    energy_level: string | null
    free_text_keywords: string[]
    visit_state: string | null
  }
  query_intent_summary: string
}

const VALID_VISIT_STATES = new Set<string>([
  'never_visited', 'visited_recently', 'visited_long_ago', 'highly_rated', 'loved_recently',
])

function sanitizeVisitState(raw: string | null | undefined): VisitState | null {
  if (typeof raw === 'string' && VALID_VISIT_STATES.has(raw)) return raw as VisitState
  return null
}

export async function parseSearchIntent(userMessage: string, env: Env): Promise<ParsedSearchIntent> {
  const client = createClient(env)
  let raw: RawParsed
  try {
    raw = await chatJson<RawParsed>(client, MODELS.search, SYSTEM_PROMPT, userMessage)
  } catch {
    raw = await chatJson<RawParsed>(client, MODELS.search, SYSTEM_PROMPT, userMessage)
  }

  return {
    filters: {
      indoor_outdoor: raw.filters.indoor_outdoor ?? null,
      age: raw.filters.age ?? null,
      region: raw.filters.region ?? null,
      categories: raw.filters.categories ?? null,
      seasons: raw.filters.seasons ?? null,
      fee_type: raw.filters.fee_type ?? null,
      energy_level: raw.filters.energy_level ?? null,
      free_text_keywords: raw.filters.free_text_keywords ?? [],
      visit_state: sanitizeVisitState(raw.filters.visit_state),
    },
    query_intent_summary: raw.query_intent_summary,
  }
}
