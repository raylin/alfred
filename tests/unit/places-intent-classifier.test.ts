import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/anthropic', () => ({
  MODELS: { extraction: 'claude-sonnet-4-6', search: 'claude-haiku-4-5-20251001' },
  createClient: vi.fn(() => ({})),
  chatJson: vi.fn(),
}))

import { classifyPlacesIntent } from '../../src/core/places-intent-classifier'
import { chatJson } from '../../src/integrations/anthropic'

const mockChatJson = vi.mocked(chatJson)
const mockEnv = { ANTHROPIC_API_KEY: 'test-key' } as unknown as Env
const NO_CONTEXT = {}

beforeEach(() => vi.clearAllMocks())

function mockIntent(intent: string, confidence: number, reasoning = '測試') {
  mockChatJson.mockResolvedValueOnce({ intent, confidence, reasoning })
}

describe('classifyPlacesIntent — intent routing', () => {
  it('returns search for search queries', async () => {
    mockIntent('search', 0.9)
    const result = await classifyPlacesIntent('幫我找附近的公園', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('search')
    expect(result.confidence).toBe(0.9)
  })

  it('returns add for place name input', async () => {
    mockIntent('add', 0.85)
    const result = await classifyPlacesIntent('大湖公園', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('add')
  })

  it('returns visit for visit record', async () => {
    mockIntent('visit', 0.92)
    const result = await classifyPlacesIntent('我們今天去了大湖公園', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('visit')
  })

  it('returns delete for delete request', async () => {
    mockIntent('delete', 0.88)
    const result = await classifyPlacesIntent('刪掉剛剛那筆', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('delete')
  })

  it('returns delete for 重做', async () => {
    mockIntent('delete', 0.82)
    const result = await classifyPlacesIntent('重做', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('delete')
  })

  it('returns edit for edit request with context', async () => {
    mockIntent('edit', 0.87)
    const result = await classifyPlacesIntent('改成 5-10 歲', {
      just_replied_card_at: new Date().toISOString(),
      last_place_internal_id: 'place-abc',
    }, mockEnv)
    expect(result.intent).toBe('edit')
  })

  it('returns setup for home setup queries', async () => {
    mockIntent('setup', 0.8)
    const result = await classifyPlacesIntent('我家在大安區', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('setup')
  })

  it('returns unknown for chitchat', async () => {
    mockIntent('unknown', 0.95)
    const result = await classifyPlacesIntent('謝謝', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('unknown')
  })
})

describe('classifyPlacesIntent — confidence threshold', () => {
  it('forces unknown when confidence < 0.6', async () => {
    mockIntent('search', 0.55)
    const result = await classifyPlacesIntent('好的', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('unknown')
    expect(result.confidence).toBe(0.55)
  })

  it('accepts intent at exactly 0.6', async () => {
    mockIntent('add', 0.6)
    const result = await classifyPlacesIntent('大湖公園', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('add')
  })

  it('forces unknown when confidence is 0.59', async () => {
    mockIntent('edit', 0.59)
    const result = await classifyPlacesIntent('改一下', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('unknown')
  })
})

describe('classifyPlacesIntent — failure handling', () => {
  it('returns unknown on API failure', async () => {
    mockChatJson.mockRejectedValueOnce(new Error('Haiku down'))
    const result = await classifyPlacesIntent('大湖公園', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('unknown')
    expect(result.confidence).toBe(0)
  })

  it('returns unknown on JSON parse failure', async () => {
    mockChatJson.mockRejectedValueOnce(new SyntaxError('Unexpected token'))
    const result = await classifyPlacesIntent('大湖公園', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('unknown')
  })

  it('returns unknown when response has invalid intent value', async () => {
    mockChatJson.mockResolvedValueOnce({ intent: 'fly_to_moon', confidence: 0.9, reasoning: '?' })
    const result = await classifyPlacesIntent('大湖公園', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('unknown')
  })

  it('returns unknown when response missing confidence', async () => {
    mockChatJson.mockResolvedValueOnce({ intent: 'add', reasoning: '?' })
    const result = await classifyPlacesIntent('大湖公園', NO_CONTEXT, mockEnv)
    expect(result.intent).toBe('unknown')
  })
})

describe('classifyPlacesIntent — context', () => {
  it('includes context in prompt when just_replied_card_at is set', async () => {
    mockIntent('edit', 0.8)
    await classifyPlacesIntent('改成 5-10 歲', {
      just_replied_card_at: new Date().toISOString(),
      last_place_internal_id: 'place-xyz',
    }, mockEnv)
    const systemPrompt = mockChatJson.mock.calls[0][2] as string
    expect(systemPrompt).toContain('Context')
    expect(systemPrompt).toContain('place-xyz')
  })

  it('does not include context section when context is empty', async () => {
    mockIntent('add', 0.8)
    await classifyPlacesIntent('大湖公園', {}, mockEnv)
    const systemPrompt = mockChatJson.mock.calls[0][2] as string
    expect(systemPrompt).not.toContain('Context')
  })

  it('passes message as user prompt to chatJson', async () => {
    mockIntent('search', 0.8)
    const msg = '台北親子景點'
    await classifyPlacesIntent(msg, NO_CONTEXT, mockEnv)
    expect(mockChatJson.mock.calls[0][3]).toBe(msg)
  })
})
