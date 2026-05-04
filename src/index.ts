import { Hono } from 'hono'
import type { Env } from './core/env'
import type { Variables } from './core/variables'
import { lineSignatureMiddleware } from './core/line-signature'
import {
  type LineWebhookBody,
  type LineTextMessage,
  getChatId,
  isTextMessage,
  startLoadingIndicator,
  sendReply,
  WELCOME_MESSAGE,
} from './integrations/line'

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.get('/health', (c) => c.json({ ok: true }))

app.post('/line/webhook', lineSignatureMiddleware, async (c) => {
  const body = JSON.parse(c.get('rawBody')) as LineWebhookBody
  c.executionCtx.waitUntil(handleEvents(body, c.env))
  return c.json({ ok: true })
})

async function handleEvents(body: LineWebhookBody, env: Env): Promise<void> {
  for (const event of body.events) {
    try {
      if (event.type === 'follow' || event.type === 'join') {
        await sendReply(event.replyToken, [WELCOME_MESSAGE], env.LINE_CHANNEL_ACCESS_TOKEN)
        continue
      }

      // TODO Task 7+: replace echo with capability router
      if (event.type === 'message') {
        const message = event.message
        if (isTextMessage(message)) {
          const chatId = getChatId(event.source)
          await startLoadingIndicator(chatId, env.LINE_CHANNEL_ACCESS_TOKEN)
          const echo: LineTextMessage = { type: 'text', text: message.text }
          await sendReply(event.replyToken, [echo], env.LINE_CHANNEL_ACCESS_TOKEN)
        }
      }
    } catch (err) {
      console.error('[webhook] event handler failed', { type: event.type, err })
    }
  }
}

export default app
