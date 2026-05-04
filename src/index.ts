import { Hono } from 'hono'
import type { Env } from './core/env'
import type { Variables } from './core/variables'
import { lineSignatureMiddleware } from './core/line-signature'
import {
  type LineWebhookBody,
  type LineSource,
  getChatId,
  isTextMessage,
  startLoadingIndicator,
  sendReply,
  WELCOME_MESSAGE,
} from './integrations/line'
import { handleSlashCommand } from './core/slash-commands'
import { routeIntent } from './core/intent-router'
import { handleUnknown } from './core/unknown-handler'
import { placesHandler } from './capabilities/places/handler'

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

      if (event.type === 'message') {
        const message = event.message
        if (!isTextMessage(message)) continue

        const chatId = getChatId(event.source)
        await startLoadingIndicator(chatId, env.LINE_CHANNEL_ACCESS_TOKEN)

        // Priority 1: slash commands (deterministic, no LLM needed)
        const slashOutcome = await handleSlashCommand(message.text, event.replyToken, env)
        if (slashOutcome !== null) {
          if (slashOutcome.type === 'route') {
            await dispatchCapability(slashOutcome.capability, slashOutcome.input, event.replyToken, env, event.source)
          }
          continue
        }

        // Priority 2: LLM intent routing
        const capability = await routeIntent(message.text, env)
        if (!capability) {
          await handleUnknown(event.replyToken, env.LINE_CHANNEL_ACCESS_TOKEN)
          continue
        }

        await dispatchCapability(capability, message.text, event.replyToken, env, event.source)
      }
    } catch (err) {
      console.error('[webhook] event handler failed', { type: event.type, err })
    }
  }
}

async function dispatchCapability(
  capability: string,
  input: string,
  replyToken: string,
  env: Env,
  source?: LineSource,
): Promise<void> {
  if (capability === 'places') {
    await placesHandler(input, replyToken, env, source)
    return
  }
  await handleUnknown(replyToken, env.LINE_CHANNEL_ACCESS_TOKEN)
}

export default app
