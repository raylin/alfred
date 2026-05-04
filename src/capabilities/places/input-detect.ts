import { isHttpUrl, isGoogleMapsUrl } from '../../lib/url-utils'

export type InputType = 'url' | 'google-maps-url' | 'text'

export function detectInputType(text: string): InputType {
  const t = text.trim()
  if (isGoogleMapsUrl(t)) return 'google-maps-url'
  if (isHttpUrl(t)) return 'url'
  return 'text'
}

const QUESTION_WORDS = ['嗎', '哪', '哪裡', '哪邊', '哪個', '怎麼', '什麼', '推薦', '有沒有']

export function isSearchQuery(text: string): boolean {
  if (text.includes('?') || text.includes('？')) return true
  return QUESTION_WORDS.some(w => text.includes(w))
}
