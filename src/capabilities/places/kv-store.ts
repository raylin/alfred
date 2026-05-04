import type { Env } from '../../core/env'

const RAW_TTL_SECONDS = 90 * 24 * 60 * 60
const LAST_PLACE_TTL_SECONDS = 24 * 60 * 60

export type ImageRawInput = {
  type: 'image'
  line_message_id: string
  mime_type: string
  size_bytes: number
}

export type RawExtractionData = {
  raw_input: string | ImageRawInput
  raw_html?: string
  raw_google_places?: string
  raw_claude_response?: string
  extracted_at: string
}

export async function writeRawExtraction(
  env: Env,
  internalId: string,
  data: RawExtractionData,
): Promise<void> {
  await env.ALFRED_KV.put(
    `place:${internalId}:raw`,
    JSON.stringify(data),
    { expirationTtl: RAW_TTL_SECONDS },
  )
}

export type LastPlaceData = {
  internal_id: string
  sent_at: string
  chat_id: string
}

export async function writeUserLastPlace(
  env: Env,
  userId: string,
  internalId: string,
  chatId: string,
): Promise<void> {
  const data: LastPlaceData = {
    internal_id: internalId,
    sent_at: new Date().toISOString(),
    chat_id: chatId,
  }
  await env.ALFRED_KV.put(
    `user:${userId}:last_place`,
    JSON.stringify(data),
    { expirationTtl: LAST_PLACE_TTL_SECONDS },
  )
}
