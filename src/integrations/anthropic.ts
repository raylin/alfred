import Anthropic from '@anthropic-ai/sdk'
import type { Env } from '../core/env'

// §7.1: Sonnet for extraction, Haiku for search intent parsing
export const MODELS = {
  extraction: 'claude-sonnet-4-6',
  search:     'claude-haiku-4-5-20251001',
} as const

type SupportedImageMimeType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
const SUPPORTED_IMAGE_MIME_TYPES: SupportedImageMimeType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export function toSafeMimeType(mimeType: string): SupportedImageMimeType {
  return SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType as SupportedImageMimeType)
    ? (mimeType as SupportedImageMimeType)
    : 'image/jpeg'
}

export function createClient(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
}

function parseJsonResponse<T>(rawText: string): T {
  let text = rawText.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  return JSON.parse(text) as T
}

export async function chatJson<T>(
  client: Anthropic,
  model: string,
  system: string,
  user: string,
): Promise<T> {
  const msg = await client.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: user }],
  })
  const block = msg.content[0]
  if (!block || block.type !== 'text') throw new Error('Unexpected non-text response from Claude')
  return parseJsonResponse<T>(block.text)
}

export async function chatJsonWithImage<T>(
  client: Anthropic,
  model: string,
  system: string,
  imageBase64: string,
  mimeType: string,
): Promise<T> {
  const safeMimeType = toSafeMimeType(mimeType)
  const msg = await client.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{
      role: 'user',
      content: [{
        type: 'image',
        source: { type: 'base64', media_type: safeMimeType, data: imageBase64 },
      }],
    }],
  })
  const block = msg.content[0]
  if (!block || block.type !== 'text') throw new Error('Unexpected non-text response from Claude')
  return parseJsonResponse<T>(block.text)
}
