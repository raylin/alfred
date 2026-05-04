import { detectInputType, isSearchQuery } from './input-detect'
import { runFlowA } from './flow-a-url'
import { runFlowB } from './flow-b-text'
import { runFlowC } from './flow-c-maps'
import { runFlowD } from './flow-d-instagram'
import { runFlowE } from './flow-e-search'
import { runFlowImage, type ImageInput } from './flow-image'
import { PlacesError } from './errors'
import { sendReply, getChatId, type LineSource } from '../../integrations/line'
import type { Env } from '../../core/env'

export async function placesHandler(
  input: string,
  replyToken: string,
  env: Env,
  source?: LineSource,
): Promise<void> {
  const inputType = detectInputType(input)
  const userId = source?.userId
  const chatId = source !== undefined ? getChatId(source) : undefined

  try {
    if (inputType === 'url') {
      await runFlowA(input, replyToken, env, userId, chatId)
      return
    }

    if (inputType === 'google-maps-url') {
      await runFlowC(input, replyToken, env, userId, chatId)
      return
    }

    if (inputType === 'instagram-url') {
      await runFlowD(input, replyToken, env, userId, chatId)
      return
    }

    // Plain text: route to Story E (search) or Story B (add new place)
    if (isSearchQuery(input)) {
      await runFlowE(input, replyToken, env)
      return
    }

    await runFlowB(input, replyToken, env, userId, chatId)
  } catch (err) {
    console.error('[places-handler] flow failed', { inputType, err: String(err) })
    const msg = err instanceof PlacesError ? err.userMessage : '整理時遇到狀況，請再傳一次。'
    try {
      await sendReply(replyToken, [{ type: 'text', text: msg }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    } catch (replyErr) {
      console.error('[places-handler] error reply also failed', String(replyErr))
    }
  }
}

export async function placesImageHandler(
  image: ImageInput,
  replyToken: string,
  env: Env,
  source?: LineSource,
): Promise<void> {
  const userId = source?.userId
  const chatId = source !== undefined ? getChatId(source) : undefined
  try {
    await runFlowImage(image, replyToken, env, userId, chatId)
  } catch (err) {
    console.error('[places-handler] image flow failed', String(err))
    const msg = err instanceof PlacesError ? err.userMessage : '整理時遇到狀況，請再傳一次。'
    try {
      await sendReply(replyToken, [{ type: 'text', text: msg }], env.LINE_CHANNEL_ACCESS_TOKEN, chatId)
    } catch (replyErr) {
      console.error('[places-handler] image error reply also failed', String(replyErr))
    }
  }
}
