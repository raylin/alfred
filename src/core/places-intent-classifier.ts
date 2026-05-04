import { createClient, chatJson, MODELS } from '../integrations/anthropic'
import { logEvent } from '../lib/observability'
import type { Env } from './env'

export type PlacesIntent =
  | 'add' | 'search' | 'edit' | 'delete' | 'visit' | 'setup' | 'unknown'

export type PlacesIntentContext = {
  just_replied_card_at?: string   // ISO timestamp of last card sent to user
  last_place_internal_id?: string
}

type ClassifierOutput = {
  intent: PlacesIntent
  confidence: number
  reasoning: string
}

const CONFIDENCE_THRESHOLD = 0.6
const VALID_INTENTS = new Set<PlacesIntent>(['add', 'search', 'edit', 'delete', 'visit', 'setup', 'unknown'])
const SAFE_DEFAULT: ClassifierOutput = { intent: 'unknown', confidence: 0, reasoning: 'safe default' }

function buildSystemPrompt(context: PlacesIntentContext): string {
  const contextSection = context.just_replied_card_at
    ? `【Context】阿福剛傳了一張景點卡片（id: ${context.last_place_internal_id ?? 'unknown'}）。如果訊息像是針對上一張卡片修改或刪除，edit 或 delete 的可能性較高。\n\n`
    : ''

  return `你是阿福的訊息分類器，負責判斷使用者在親子景點助手中的意圖。

意圖定義：
- add: 使用者想新增或記錄一個景點（傳名稱、描述、說要存起來）
- search: 使用者想搜尋或查詢既有景點（想找、推薦、有什麼、哪裡好玩）
- edit: 使用者想修改某個景點的資料（改成、更新、修正某欄位）
- delete: 使用者想刪掉或重做上一筆（刪掉、重做、取消、不要了）
- visit: 使用者記錄造訪過某個地方（今天去了、剛去過、我們去了）
- setup: 使用者想設定或詢問家裡位置或目前位置
- unknown: 其他（閒聊、感謝、不相關、意圖不明確）

${contextSection}輸出格式（只回 JSON，不加任何說明）：
{"intent": "<intent>", "confidence": 0.0-1.0, "reasoning": "<一句話說明為何這樣判斷>"}

confidence 說明：
- 0.9+: 非常確定（明確動詞句型）
- 0.7-0.9: 相當確定
- 0.5-0.7: 不太確定
- <0.5: 幾乎不確定
遇到模糊或無法確定時，選 unknown 並降低 confidence`
}

export async function classifyPlacesIntent(
  message: string,
  context: PlacesIntentContext,
  env: Env,
): Promise<ClassifierOutput> {
  const t0 = Date.now()
  const client = createClient(env)
  let result: ClassifierOutput

  try {
    const raw = await chatJson<ClassifierOutput>(
      client,
      MODELS.search,
      buildSystemPrompt(context),
      message,
    )
    result = (raw && VALID_INTENTS.has(raw.intent) && typeof raw.confidence === 'number')
      ? raw
      : SAFE_DEFAULT
  } catch (err) {
    console.error('[places-intent] classifier failed (safe default: unknown)', String(err))
    result = SAFE_DEFAULT
  }

  if (result.confidence < CONFIDENCE_THRESHOLD) {
    result = { ...result, intent: 'unknown' }
  }

  await logEvent(env, {
    type: result.intent === 'unknown' ? 'places.intent_unknown' : 'places.intent_classify',
    intent: result.intent,
    confidence: result.confidence,
    duration_ms: Date.now() - t0,
    outcome: 'success',
    meta: { has_context: !!context.just_replied_card_at, message_preview: message.slice(0, 50) },
  })

  return result
}
