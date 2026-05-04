import { isHttpUrl, isGoogleMapsUrl } from '../../lib/url-utils'

export type InputType = 'url' | 'google-maps-url' | 'text'

export function detectInputType(text: string): InputType {
  const t = text.trim()
  if (isGoogleMapsUrl(t)) return 'google-maps-url'
  if (isHttpUrl(t)) return 'url'
  return 'text'
}
