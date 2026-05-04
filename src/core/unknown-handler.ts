import { sendReply } from '../integrations/line'
import { capabilities } from '../capabilities/_registry'

export function buildUnknownMessage(): string {
  const capLines = capabilities.map(c => `• ${c.description}`).join('\n')
  return [
    '不太確定你想做什麼，我目前可以幫你：',
    '',
    capLines,
    '',
    '可以傳網址、地點名稱或 Google Maps 連結給我，或是問「下雨天三歲適合的景點」這類問題。',
    '輸入 /help 可以看完整說明。',
  ].join('\n')
}

export async function handleUnknown(replyToken: string, accessToken: string): Promise<void> {
  await sendReply(replyToken, [{ type: 'text', text: buildUnknownMessage() }], accessToken)
}
