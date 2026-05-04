const LINE_API = 'https://api.line.me/v2/bot'

// --- Event types ---

export type LineSource =
  | { type: 'user'; userId: string }
  | { type: 'group'; groupId: string; userId: string }
  | { type: 'room'; roomId: string; userId: string }

export type LineTextMessageContent = { type: 'text'; id: string; text: string }
export type LineImageMessageContent = { type: 'image'; id: string }
type LineOtherMessageContent = { type: string; id: string }
type LineMessageContent = LineTextMessageContent | LineImageMessageContent | LineOtherMessageContent

export function isTextMessage(msg: LineMessageContent): msg is LineTextMessageContent {
  return msg.type === 'text'
}

export function isImageMessage(msg: LineMessageContent): msg is LineImageMessageContent {
  return msg.type === 'image'
}

export type LineMessageEvent = {
  type: 'message'
  replyToken: string
  source: LineSource
  timestamp: number
  mode: 'active' | 'standby'
  message: LineMessageContent
}

export type LineFollowEvent = {
  type: 'follow'
  replyToken: string
  source: LineSource
  timestamp: number
  mode: 'active' | 'standby'
}

export type LineJoinEvent = {
  type: 'join'
  replyToken: string
  source: LineSource
  timestamp: number
  mode: 'active' | 'standby'
}

export type LinePostbackEvent = {
  type: 'postback'
  replyToken: string
  source: LineSource
  timestamp: number
  mode: 'active' | 'standby'
  postback: { data: string }
}

export type LineEvent = LineMessageEvent | LineFollowEvent | LineJoinEvent | LinePostbackEvent

export type LineWebhookBody = {
  destination: string
  events: LineEvent[]
}

// --- Message types ---

export type LineTextMessage = { type: 'text'; text: string }

export type LineFlexMessage = {
  type: 'flex'
  altText: string
  contents: Record<string, unknown>
}

export type LineMessage = LineTextMessage | LineFlexMessage

// --- Helpers ---

export function getChatId(source: LineSource): string {
  if (source.type === 'group') return source.groupId
  if (source.type === 'room') return source.roomId
  return source.userId
}

export const WELCOME_MESSAGE: LineTextMessage = {
  type: 'text',
  text: '阿福已加入這個對話。\n\n可以丟以下任何一種給我,我會幫忙整理:\n- 部落格或介紹文章的網址\n- 地點名稱(例如:大湖公園)\n- Google Maps 分享連結\n\n要找之前存過的地方,直接問我就好,例如:\n「下雨天三歲適合的景點」\n\n整理結果都會存進共享的 Notion,可以隨時編輯。',
}

// --- API calls ---

const LINE_CONTENT_API = 'https://api-data.line.me/v2/bot'

export async function fetchMessageContent(
  messageId: string,
  accessToken: string,
): Promise<{ contentBase64: string; mimeType: string; sizeBytes: number }> {
  const res = await fetch(`${LINE_CONTENT_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`LINE content API failed: ${res.status}`)
  }
  const mimeType = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()
  const buffer = await res.arrayBuffer()
  const sizeBytes = buffer.byteLength
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const contentBase64 = btoa(binary)
  return { contentBase64, mimeType, sizeBytes }
}

export async function startLoadingIndicator(chatId: string, accessToken: string): Promise<void> {
  const res = await fetch(`${LINE_API}/chat/loading/start`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chatId }),
  })
  if (!res.ok) {
    console.error('[line] loading indicator failed', { chatId, status: res.status })
  }
}

export async function sendPush(
  chatId: string,
  messages: LineMessage[],
  accessToken: string,
): Promise<void> {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to: chatId, messages }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error('[line] push failed', { chatId, status: res.status, body: text })
  }
}

export async function sendReply(
  replyToken: string,
  messages: LineMessage[],
  accessToken: string,
  chatId?: string,
): Promise<void> {
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ replyToken, messages }),
  })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 400 && text.includes('Invalid reply token') && chatId !== undefined) {
      console.warn('[line] reply token expired, falling back to push', { chatId })
      await sendPush(chatId, messages, accessToken)
      return
    }
    console.error('[line] reply failed', { status: res.status, body: text })
  }
}
