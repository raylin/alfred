import { sendReply } from '../../integrations/line'
import { getHomeLocation, setHomeLocation, setCurrentOrigin, consumeHomeUpdatePending } from './home-store'
import type { Env } from '../../core/env'

export type LocationInput = { lat: number; lng: number; address: string }

/**
 * Handles a LINE LocationMessage event.
 *
 * Decision rule (ADR-020 + ADR-021):
 *   1. home_update_pending flag set → update home (flag consumed)
 *   2. No home set yet            → first-time home setup
 *   3. Home exists, no flag       → current_origin override (2h)
 */
export async function runFlowSetup(
  location: LocationInput,
  replyToken: string,
  env: Env,
  userId: string,
): Promise<void> {
  // Branch 1: user triggered /setup while home existed → consume flag and update home
  const pendingUpdate = await consumeHomeUpdatePending(env, userId)
  if (pendingUpdate) {
    await setHomeLocation(env, userId, location.lat, location.lng, location.address)
    await sendReply(
      replyToken,
      [{ type: 'text', text: `✅ 家裡位置已更新為:${location.address}` }],
      env.LINE_CHANNEL_ACCESS_TOKEN,
    )
    return
  }

  const existingHome = await getHomeLocation(env, userId)

  if (!existingHome) {
    // Branch 2: first location ever → set as home (ADR-020)
    await setHomeLocation(env, userId, location.lat, location.lng, location.address)
    await sendReply(
      replyToken,
      [{
        type: 'text',
        text: `✅ 已記錄家裡位置:${location.address}\n\n之後查景點或新增地點時,阿福會自動附上距離。\n如果要暫時用其他位置算距離,分享當前位置給我就好。`,
      }],
      env.LINE_CHANNEL_ACCESS_TOKEN,
    )
    return
  }

  // Branch 3: home exists, no pending update → temporary current_origin override
  await setCurrentOrigin(env, userId, location.lat, location.lng)
  await sendReply(
    replyToken,
    [{ type: 'text', text: `📍 OK,這 2 小時用你目前的位置算距離。\n打 /home 可以切回家裡位置。` }],
    env.LINE_CHANNEL_ACCESS_TOKEN,
  )
}
