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

