import { Hono } from 'hono'
import type { Env } from './core/env'
import type { Variables } from './core/variables'
import { lineSignatureMiddleware } from './core/line-signature'
import {
  type LineWebhookBody,
  type LineSource,
  getChatId,
  isTextMessage,
  isImageMessage,
  isLocationMessage,
  fetchMessageContent,
  startLoadingIndicator,
  sendReply,
  sendPush,
  WELCOME_MESSAGE,
} from './integrations/line'
import { handleSlashCommand } from './core/slash-commands'
import { getHomeLocation, hasBeenPromptedRecently, markHomeprompted } from './capabilities/places/home-store'
import { runFlowSetup } from './capabilities/places/flow-setup'
import { routeIntent } from './core/intent-router'
import { handleUnknown } from './core/unknown-handler'
import { placesHandler, placesImageHandler } from './capabilities/places/handler'
import { runFlowVisitSelect } from './capabilities/places/flow-visit'
import { runFlowEditSelect } from './capabilities/places/flow-edit'
import { runFlowDeleteSelect, runFlowDeleteConfirm, runFlowDeleteCancel } from './capabilities/places/flow-delete'
import { capabilities } from './capabilities/_registry'
import { isHttpUrl } from './lib/url-utils'

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

      if (event.type === 'postback') {
        const data = event.postback.data
        const chatId = getChatId(event.source)
        if (data === 'dedup:update') {
          await sendPush(chatId, [{ type: 'text', text: '好，你可以到 Notion 手動更新，或等阿福之後支援自動更新。' }], env.LINE_CHANNEL_ACCESS_TOKEN)
        } else if (data === 'dedup:skip') {
          await sendPush(chatId, [{ type: 'text', text: '好，跳過，不重複存。' }], env.LINE_CHANNEL_ACCESS_TOKEN)
        } else if (data.startsWith('visit:select:')) {
          const notionPageId = data.slice('visit:select:'.length)
          const userId = event.source.type === 'user' ? event.source.userId : undefined
          await runFlowVisitSelect(notionPageId, event.replyToken, env, userId, chatId)
        } else if (data.startsWith('edit:select:')) {
          const notionPageId = data.slice('edit:select:'.length)
          const userId = event.source.type === 'user' ? event.source.userId : undefined
          await runFlowEditSelect(notionPageId, event.replyToken, env, userId, chatId)
        } else if (data.startsWith('delete:select:')) {
          const notionPageId = data.slice('delete:select:'.length)
          const userId = event.source.type === 'user' ? event.source.userId : undefined
          await runFlowDeleteSelect(notionPageId, event.replyToken, env, userId, chatId)
        } else if (data.startsWith('delete:confirm:')) {
          const notionPageId = data.slice('delete:confirm:'.length)
          const userId = event.source.type === 'user' ? event.source.userId : undefined
          await runFlowDeleteConfirm(notionPageId, event.replyToken, env, userId, chatId)
        } else if (data.startsWith('delete:cancel:')) {
          const notionPageId = data.slice('delete:cancel:'.length)
          const userId = event.source.type === 'user' ? event.source.userId : undefined
          await runFlowDeleteCancel(notionPageId, event.replyToken, env, userId, chatId)
        }
        continue
      }

      if (event.type === 'message') {
        const message = event.message

        // First-time home setup prompt: check before processing any message (spec §5.1)
        const userId = event.source.type === 'user' ? event.source.userId : undefined
        if (userId) {
          try {
            const [alreadyPrompted, homeSet] = await Promise.all([
              hasBeenPromptedRecently(env, userId),
              getHomeLocation(env, userId),
            ])
            if (!alreadyPrompted && !homeSet) {
              await sendPush(userId, [{
                type: 'text',
                text: '我還不知道你住哪 😊 要算距離得知道你家位置。\n可以分享一下嗎?(LINE 點 + → 位置)',
              }], env.LINE_CHANNEL_ACCESS_TOKEN)
              await markHomeprompted(env, userId)
            }
          } catch (err) {
            console.error('[webhook] home prompt check failed', err)
          }
        }

        // Location messages → home / current_origin setup (spec §5.2)
        if (isLocationMessage(message)) {
          if (userId) {
            await runFlowSetup(
              { lat: message.latitude, lng: message.longitude, address: message.address },
              event.replyToken,
              env,
              userId,
            )
          }
          continue
        }

        // Image messages bypass LLM intent router — route directly to places (ADR-012)
        if (isImageMessage(message)) {
          const chatId = getChatId(event.source)
          await startLoadingIndicator(chatId, env.LINE_CHANNEL_ACCESS_TOKEN)
          try {
            const imageData = await fetchMessageContent(message.id, env.LINE_CHANNEL_ACCESS_TOKEN)
            await placesImageHandler(
              { ...imageData, lineMessageId: message.id },
              event.replyToken,
              env,
              event.source,
            )
          } catch (err) {
            console.error('[webhook] image fetch/dispatch failed', err)
            await sendReply(event.replyToken, [{ type: 'text', text: '圖片讀取失敗，請再傳一次。' }], env.LINE_CHANNEL_ACCESS_TOKEN)
          }
          continue
        }

        if (!isTextMessage(message)) continue

        const chatId = getChatId(event.source)
        await startLoadingIndicator(chatId, env.LINE_CHANNEL_ACCESS_TOKEN)

        // Priority 1: slash commands (deterministic, no LLM needed)
        const slashOutcome = await handleSlashCommand(message.text, event.replyToken, env, userId)
        if (slashOutcome !== null) {
          if (slashOutcome.type === 'route') {
            await dispatchCapability(slashOutcome.capability, slashOutcome.input, event.replyToken, env, event.source)
          }
          continue
        }

        // Priority 2: pure URL messages bypass LLM intent router — structural input, not natural language (ADR-014)
        const trimmedText = message.text.trim()
        if (isHttpUrl(trimmedText) && !trimmedText.includes(' ')) {
          const urlCapability = capabilities.find(cap => cap.accepts_urls)
          if (urlCapability) {
            await dispatchCapability(urlCapability.id, trimmedText, event.replyToken, env, event.source)
            continue
          }
        }

        // Priority 3: LLM intent routing
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
