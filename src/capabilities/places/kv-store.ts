import type { Env } from '../../core/env'

const RAW_TTL_SECONDS = 90 * 24 * 60 * 60
const LAST_PLACE_TTL_SECONDS = 24 * 60 * 60
const PENDING_RATING_TTL_SECONDS = 10 * 60
const PENDING_VISIT_TTL_SECONDS = 10 * 60

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

// --- Pending rating (post-visit rating prompt) ---

export type PendingRatingData = {
  visit_notion_page_id: string
  place_notion_page_id: string
  place_name: string
}

export async function writePendingRating(
  env: Env,
  userId: string,
  data: PendingRatingData,
): Promise<void> {
  await env.ALFRED_KV.put(
    `user:${userId}:pending_rating`,
    JSON.stringify(data),
    { expirationTtl: PENDING_RATING_TTL_SECONDS },
  )
}

export async function readPendingRating(
  env: Env,
  userId: string,
): Promise<PendingRatingData | null> {
  const raw = await env.ALFRED_KV.get(`user:${userId}:pending_rating`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingRatingData
  } catch {
    return null
  }
}

export async function clearPendingRating(env: Env, userId: string): Promise<void> {
  try {
    await env.ALFRED_KV.delete(`user:${userId}:pending_rating`)
  } catch { /* non-fatal — TTL expires it */ }
}

// --- Pending visit (disambiguation context, ADR-025) ---

export type PendingVisitData = {
  visited_on: string | null
  rating_signal: 1 | 2 | 3 | 4 | 5 | null
  notes: string | null
}

export async function writePendingVisit(
  env: Env,
  userId: string,
  data: PendingVisitData,
): Promise<void> {
  await env.ALFRED_KV.put(
    `user:${userId}:pending_visit`,
    JSON.stringify(data),
    { expirationTtl: PENDING_VISIT_TTL_SECONDS },
  )
}

export async function readPendingVisit(
  env: Env,
  userId: string,
): Promise<PendingVisitData | null> {
  const raw = await env.ALFRED_KV.get(`user:${userId}:pending_visit`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingVisitData
  } catch {
    return null
  }
}

export async function clearPendingVisit(env: Env, userId: string): Promise<void> {
  try {
    await env.ALFRED_KV.delete(`user:${userId}:pending_visit`)
  } catch { /* non-fatal — TTL expires it */ }
}

// --- Pending edit (disambiguation context for edit flow) ---

const PENDING_EDIT_TTL_SECONDS = 10 * 60

export type PendingEditData = {
  edit_message: string
}

export async function writePendingEdit(
  env: Env,
  userId: string,
  data: PendingEditData,
): Promise<void> {
  await env.ALFRED_KV.put(
    `user:${userId}:pending_edit`,
    JSON.stringify(data),
    { expirationTtl: PENDING_EDIT_TTL_SECONDS },
  )
}

export async function readPendingEdit(
  env: Env,
  userId: string,
): Promise<PendingEditData | null> {
  const raw = await env.ALFRED_KV.get(`user:${userId}:pending_edit`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingEditData
  } catch {
    return null
  }
}

export async function clearPendingEdit(env: Env, userId: string): Promise<void> {
  try {
    await env.ALFRED_KV.delete(`user:${userId}:pending_edit`)
  } catch { /* non-fatal — TTL expires it */ }
}
