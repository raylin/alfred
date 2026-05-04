import { detectInputType } from './input-detect'
import { runFlowA } from './flow-a-url'
import { PlacesError } from './errors'
import { sendReply } from '../../integrations/line'
import type { Env } from '../../core/env'

export async function placesHandler(input: string, replyToken: string, env: Env): Promise<void> {
  const inputType = detectInputType(input)

  try {
    if (inputType === 'url') {
      await runFlowA(input, replyToken, env)
      return
    }
    if (inputType === 'google-maps-url') {
      // TODO Task 8: Story C
      await sendReply(
        replyToken,
        [{ type: 'text', text: '收到 Google Maps 連結！（整合功能建置中，請稍候）' }],
        env.LINE_CHANNEL_ACCESS_TOKEN,
      )
      return
    }
    // Plain text → TODO Task 7 (Story B) / Task 9 (Story E)
    await sendReply(
      replyToken,
      [{ type: 'text', text: '收到！（文字輸入功能建置中，請稍候）' }],
      env.LINE_CHANNEL_ACCESS_TOKEN,
    )
  } catch (err) {
    console.error('[places-handler] flow failed', { inputType, err: String(err) })
    const msg = err instanceof PlacesError ? err.userMessage : '整理時遇到狀況，請再傳一次。'
    try {
      await sendReply(replyToken, [{ type: 'text', text: msg }], env.LINE_CHANNEL_ACCESS_TOKEN)
    } catch (replyErr) {
      console.error('[places-handler] error reply also failed', String(replyErr))
    }
  }
}
