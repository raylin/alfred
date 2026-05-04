export function isHttpUrl(text: string): boolean {
  const t = text.trim()
  return t.startsWith('http://') || t.startsWith('https://')
}

export function isGoogleMapsUrl(text: string): boolean {
  return /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.com\/maps|maps\.google\.com)/i.test(
    text.trim(),
  )
}

export async function fetchWithTimeout(url: string, timeoutMs = 10_000, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
