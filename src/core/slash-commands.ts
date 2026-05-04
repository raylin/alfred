import { sendReply } from '../integrations/line'
import { capabilities } from '../capabilities/_registry'
import type { Env } from './env'

export type SlashOutcome =
  | { type: 'replied' }
  | { type: 'route'; capability: string; input: string }

// Returns null if text is not a recognized slash command (fall through to LLM router)
export async function handleSlashCommand(
  text: string,
  replyToken: string,
  env: Env,
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
