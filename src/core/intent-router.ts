import { createClient, chatJson, MODELS } from '../integrations/anthropic'
import { capabilities } from '../capabilities/_registry'
import type { Env } from './env'

export const CONFIDENCE_THRESHOLD = 0.6

type RouterOutput = {
  capability: string | null
  confidence: number
}

function buildSystemPrompt(): string {
  const capList = capabilities
    .map(c => [
      `- id: "${c.id}"`,
      `  描述: ${c.description}`,
      `  正例: ${c.examples_positive.slice(0, 3).join(' / ')}`,
      `  負例: ${c.examples_negative.slice(0, 2).join(' / ')}`,
      `  關鍵詞: ${c.keywords.slice(0, 8).join(', ')}`,
    ].join('\n'))
    .join('\n\n')

  return `你是阿福的訊息分類器。根據使用者訊息，判斷最符合的 capability 並給出信心值。

可用 capabilities：
${capList}

輸出格式（只回 JSON，不加其他文字）：
{"capability": "<id>", "confidence": 0.0-1.0}

若訊息不符合任何 capability（例如閒聊、問好、感謝、不相關話題）：
{"capability": null, "confidence": 0.0}

confidence 說明：
- 0.9+ : 非常確定（明確的地點名稱、URL、搜尋問句）
- 0.7-0.9: 相當確定
- 0.5-0.7: 不太確定
- <0.5 : 幾乎不確定`
}

// §5.5: Route incoming message to a capability id, or null for unknown handler
export async function routeIntent(message: string, env: Env): Promise<string | null> {
  const client = createClient(env)
  try {
    const result = await chatJson<RouterOutput>(client, MODELS.search, buildSystemPrompt(), message)
    const capId = result.capability ?? null
    const confidence = typeof result.confidence === 'number' ? result.confidence : 0

    console.log(
      JSON.stringify({
        type: 'intent_routing',
        capability: capId,
        confidence,
        message_preview: message.slice(0, 50),
      }),
    )

    if (!capId || confidence < CONFIDENCE_THRESHOLD) return null
    return capId
  } catch (err) {
    console.error('[intent-router] routing failed, falling through to unknown handler', String(err))
    return null
  }
}
