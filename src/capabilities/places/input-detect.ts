import { isHttpUrl, isGoogleMapsUrl } from '../../lib/url-utils'

export type InputType = 'url' | 'google-maps-url' | 'instagram-url' | 'text'

export function isInstagramUrl(text: string): boolean {
  return /https?:\/\/(www\.)?instagram\.com\//i.test(text.trim())
}

export function detectInputType(text: string): InputType {
  const t = text.trim()
  if (isGoogleMapsUrl(t)) return 'google-maps-url'
  if (isInstagramUrl(t)) return 'instagram-url'
  if (isHttpUrl(t)) return 'url'
  return 'text'
}

const QUESTION_WORDS = [
  '嗎', '哪', '哪裡', '哪邊', '哪個', '怎麼', '什麼', '推薦', '有沒有',
  '幫我', '找', '找個', '找一個', '有什麼', '給我', '我想去', '我要去',
]

export function isSearchQuery(text: string): boolean {
  if (text.includes('?') || text.includes('？')) return true
  return QUESTION_WORDS.some(w => text.includes(w))
}
