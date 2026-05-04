import { sendReply } from '../integrations/line'
import { capabilities } from '../capabilities/_registry'
import {
  getHomeLocation,
  clearCurrentOrigin,
  markHomeUpdatePending,
} from '../capabilities/places/home-store'
import type { Env } from './env'

const REVIEW_MAX_CHARS = 4500

export type SlashOutcome =
  | { type: 'replied' }
  | { type: 'route'; capability: string; input: string }

// Returns null if text is not a recognized slash command (fall through to LLM router)
export async function handleSlashCommand(
  text: string,
  replyToken: string,
  env: Env,
  userId?: string,
): Promise<SlashOutcome | null> {
  if (!text.startsWith('/')) return null

  const [rawCmd = '', ...rest] = text.slice(1).split(' ')
  const cmd = rawCmd.toLowerCase()
  const args = rest.join(' ').trim()

  switch (cmd) {
    case 'help':
      await replyHelp(replyToken, env)
      return { type: 'replied' }

    case 'place':
      return handlePlace(args, replyToken, env)

    case 'setup':
      await handleSetup(replyToken, env, userId)
      return { type: 'replied' }

    case 'home':
      await handleHome(replyToken, env, userId)
      return { type: 'replied' }

    case 'here':
      await replyHere(replyToken, env)
      return { type: 'replied' }

    case 'review':
      await handleReview(replyToken, env, userId)
      return { type: 'replied' }

    default:
      return null
  }
}

async function replyHelp(replyToken: string, env: Env): Promise<void> {
  const capLines = capabilities.map(c => `📍 ${c.description}`).join('\n')
  const text = [
    '阿福使用說明',
    '',
    '我可以幫你：',
    capLines,
    '',
    '怎麼傳給我：',
    '• 部落格或介紹文章的網址',
    '• 地點名稱（例如：大湖公園）',
    '• Google Maps 分享連結',
    '• 自然語言問題（例如：下雨天三歲適合的台北景點）',
    '',
    '指令：',
    '/help — 顯示此說明',
    '/place <地點名稱或網址> — 強制記錄景點',
  ].join('\n')
  await sendReply(replyToken, [{ type: 'text', text }], env.LINE_CHANNEL_ACCESS_TOKEN)
}

async function handlePlace(
  args: string,
  replyToken: string,
  env: Env,
): Promise<SlashOutcome> {
  if (!args) {
    await sendReply(
      replyToken,
      [{ type: 'text', text: '請在 /place 後面加上地點名稱或網址，例如：/place 大湖公園' }],
      env.LINE_CHANNEL_ACCESS_TOKEN,
    )
    return { type: 'replied' }
  }
  return { type: 'route', capability: 'places', input: args }
}

async function handleSetup(replyToken: string, env: Env, userId?: string): Promise<void> {
  if (!userId) {
    await sendReply(replyToken, [{ type: 'text', text: '/setup 只能在私訊中使用。' }], env.LINE_CHANNEL_ACCESS_TOKEN)
    return
  }
  const home = await getHomeLocation(env, userId)
  if (home) {
    await markHomeUpdatePending(env, userId)
    await sendReply(replyToken, [{
      type: 'text',
      text: `目前家裡位置:${home.address}\n\n要更新請在 5 分鐘內分享新位置給我。(LINE 點 + → 位置)`,
    }], env.LINE_CHANNEL_ACCESS_TOKEN)
  } else {
    await sendReply(replyToken, [{
      type: 'text',
      text: '你還沒有設定家裡位置。分享你的位置給我就可以設定。(LINE 點 + → 位置)',
    }], env.LINE_CHANNEL_ACCESS_TOKEN)
  }
}

async function handleHome(replyToken: string, env: Env, userId?: string): Promise<void> {
  if (!userId) {
    await sendReply(replyToken, [{ type: 'text', text: '/home 只能在私訊中使用。' }], env.LINE_CHANNEL_ACCESS_TOKEN)
    return
  }
  await clearCurrentOrigin(env, userId)
  await sendReply(
    replyToken,
    [{ type: 'text', text: '已切回家裡位置。' }],
    env.LINE_CHANNEL_ACCESS_TOKEN,
  )
}

async function replyHere(replyToken: string, env: Env): Promise<void> {
  await sendReply(
    replyToken,
    [{ type: 'text', text: '請分享你的當前位置:(LINE 點 + → 位置)\n分享後阿福會用這個位置算距離,有效 2 小時。\n打 /home 可以切回家裡位置。' }],
    env.LINE_CHANNEL_ACCESS_TOKEN,
  )
}

type StoredEvent = {
  ulid: string
  timestamp: string
  type: string
  outcome: 'success' | 'error' | 'unknown'
  duration_ms: number
  intent?: string
  error?: string
  meta?: { message_preview?: string; [key: string]: unknown }
}

async function handleReview(replyToken: string, env: Env, userId?: string): Promise<void> {
  if (!userId || userId !== env.PM_LINE_USER_ID) {
    await sendReply(replyToken, [{ type: 'text', text: '這指令僅限管理員。' }], env.LINE_CHANNEL_ACCESS_TOKEN)
    return
  }

  const raw = await env.ALFRED_KV.get('events:recent')
  const ulids: string[] = raw ? JSON.parse(raw) : []

  if (ulids.length === 0) {
    await sendReply(replyToken, [{ type: 'text', text: '目前還沒有事件記錄。' }], env.LINE_CHANNEL_ACCESS_TOKEN)
    return
  }

  const eventJsons = await Promise.all(ulids.map(u => env.ALFRED_KV.get(`event:${u}`)))
  const events: StoredEvent[] = eventJsons
    .filter((v): v is string => v !== null)
    .map(v => JSON.parse(v) as StoredEvent)

  if (events.length === 0) {
    await sendReply(replyToken, [{ type: 'text', text: '事件記錄已過期，沒有可顯示的資料。' }], env.LINE_CHANNEL_ACCESS_TOKEN)
    return
  }

  const total = events.length

  // Time range from first/last ULID timestamps
  const timestamps = events.map(e => e.timestamp).sort()
  const oldest = timestamps[0]!.slice(0, 16).replace('T', ' ')
  const newest = timestamps[timestamps.length - 1]!.slice(0, 16).replace('T', ' ')

  // Type counts (descending)
  const typeCounts = new Map<string, number>()
  for (const e of events) typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1)
  const typeLines = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `  ${t}: ${n}`)
    .join('\n')

  // Outcome %
  const outcomes = { success: 0, error: 0, unknown: 0 }
  for (const e of events) outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1
  const outcomeLines = Object.entries(outcomes)
    .filter(([, n]) => n > 0)
    .map(([o, n]) => `  ${o}: ${Math.round((n / total) * 100)}% (${n}/${total})`)
    .join('\n')

  // Duration stats
  const durations = events.map(e => e.duration_ms).sort((a, b) => a - b)
  const avgMs = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
  const p95Ms = durations[Math.floor(durations.length * 0.95)] ?? durations[durations.length - 1]!

  // Recent errors (last 10 unique error messages)
  const errorEvents = events.filter(e => e.outcome === 'error' && e.error)
  const recentErrors = errorEvents.slice(0, 10).map(e => `  • [${e.type}] ${e.error}`).join('\n')

  // Unknown intent sample (last 5)
  const unknownEvents = events.filter(e => e.type === 'places.intent_unknown')
  const unknownSample = unknownEvents
    .slice(0, 5)
    .map(e => `  • ${e.meta?.message_preview ?? '(no preview)'}`)
    .join('\n')

  const lines = [
    `📊 Alfred 最近 ${total} 筆事件`,
    `時間：${oldest} ～ ${newest}`,
    '',
    '【類型分佈】',
    typeLines,
    '',
    '【結果】',
    outcomeLines,
    '',
    `【耗時】avg: ${avgMs}ms | p95: ${p95Ms}ms`,
  ]

  if (recentErrors) {
    lines.push('', '【最近錯誤】', recentErrors)
  }

  if (unknownSample) {
    lines.push('', '【未知意圖 sample】', unknownSample)
  }

  let text = lines.join('\n')
  if (text.length > REVIEW_MAX_CHARS) {
    text = text.slice(0, REVIEW_MAX_CHARS) + '\n…（以下省略）'
  }

  await sendReply(replyToken, [{ type: 'text', text }], env.LINE_CHANNEL_ACCESS_TOKEN)
}
