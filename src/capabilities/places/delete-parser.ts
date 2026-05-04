import { createClient, chatJson, MODELS } from '../../integrations/anthropic'
import type { Env } from '../../core/env'

export type DeleteTarget = {
  target: 'last' | string | null
}

const SYSTEM_PROMPT = `你是助手，判斷用戶想刪除哪個景點。

回傳 JSON：{ "target": "last" | "<place_name>" | null }

規則：
- "last"：用戶指剛才那筆（「刪掉剛剛那筆」「重做」「不要這筆」「刪掉那個」「不對」「取消上一筆」）
- "<place_name>"：用戶指名特定景點（「刪掉大湖公園」→ "大湖公園"）
- null：訊息不像刪除意圖

只回傳 JSON。`

function sanitize(raw: unknown): DeleteTarget {
  if (typeof raw !== 'object' || raw === null) return { target: null }
  const r = raw as Record<string, unknown>
  const t = r['target']
  if (t === 'last') return { target: 'last' }
  if (typeof t === 'string' && t.length > 0) return { target: t }
  return { target: null }
}

export async function parseDeleteIntent(message: string, env: Env): Promise<DeleteTarget> {
  const client = createClient(env)
  const attempt = async () => sanitize(await chatJson<unknown>(client, MODELS.extraction, SYSTEM_PROMPT, message))

  try {
    return await attempt()
  } catch {
    try {
      return await attempt()
    } catch {
      return { target: null }
    }
  }
}
