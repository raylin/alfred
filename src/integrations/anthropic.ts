import Anthropic from '@anthropic-ai/sdk'
import type { Env } from '../core/env'

// §7.1: Sonnet for extraction, Haiku for search intent parsing
export const MODELS = {
  extraction: 'claude-sonnet-4-6',
  search:     'claude-haiku-4-5-20251001',
} as const

export function createClient(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
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
  // Strip markdown code fence if Claude ignores the instruction
  let text = block.text.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  return JSON.parse(text) as T
}
