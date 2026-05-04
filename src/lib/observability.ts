import { generateUlid } from './ulid'
import type { Env } from '../core/env'

export type LogEventInput = {
  type: string
  user_id?: string | undefined
  intent?: string | undefined
  confidence?: number | undefined
  filters?: object | undefined
  result_count?: number | undefined
  duration_ms: number
  outcome: 'success' | 'error' | 'unknown'
  error?: string | undefined
  meta?: object | undefined
}

const EVENT_TTL_SECONDS = 7 * 24 * 60 * 60
const RING_BUFFER_KEY = 'events:recent'
const MAX_RING_SIZE = 100

export async function logEvent(env: Env, event: LogEventInput): Promise<void> {
  try {
    const ulid = generateUlid()
    const stored = { ...event, ulid, timestamp: new Date().toISOString() }
    await env.ALFRED_KV.put(`event:${ulid}`, JSON.stringify(stored), { expirationTtl: EVENT_TTL_SECONDS })
    const raw = await env.ALFRED_KV.get(RING_BUFFER_KEY)
    const existing: string[] = raw ? JSON.parse(raw) : []
    await env.ALFRED_KV.put(RING_BUFFER_KEY, JSON.stringify([ulid, ...existing].slice(0, MAX_RING_SIZE)))
  } catch (err) {
    console.error('[observability] logEvent failed (non-fatal)', err)
  }
}
