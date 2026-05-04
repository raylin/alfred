import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/anthropic', () => ({
  MODELS: { extraction: 'claude-sonnet-4-6', search: 'claude-haiku-4-5-20251001' },
  createClient: vi.fn(() => ({})),
  chatJson: vi.fn(),
}))

import { routeIntent, CONFIDENCE_THRESHOLD } from '../../src/core/intent-router'
import { chatJson } from '../../src/integrations/anthropic'

const mockChatJson = vi.mocked(chatJson)
const mockEnv = { ANTHROPIC_API_KEY: 'test-key' } as unknown as Env

beforeEach(() => {
  vi.clearAllMocks()
})

describe('routeIntent', () => {
  it('returns capability id when confidence meets threshold', async () => {
    mockChatJson.mockResolvedValueOnce({ capability: 'places', confidence: 0.9 })
    const result = await routeIntent('大湖公園划船', mockEnv)
    expect(result).toBe('places')
  })

  it('returns null when confidence is below threshold', async () => {
    mockChatJson.mockResolvedValueOnce({ capability: 'places', confidence: CONFIDENCE_THRESHOLD - 0.01 })
    const result = await routeIntent('你好', mockEnv)
    expect(result).toBeNull()
  })

  it('returns null when capability is null (unrecognized intent)', async () => {
    mockChatJson.mockResolvedValueOnce({ capability: null, confidence: 0 })
    const result = await routeIntent('今天天氣怎麼樣', mockEnv)
    expect(result).toBeNull()
  })

  it('returns null on API failure without throwing', async () => {
    mockChatJson.mockRejectedValueOnce(new Error('network timeout'))
    await expect(routeIntent('大湖公園', mockEnv)).resolves.toBeNull()
  })

  it('returns null on JSON parse failure without throwing', async () => {
    mockChatJson.mockRejectedValueOnce(new SyntaxError('Unexpected token'))
    await expect(routeIntent('大湖公園', mockEnv)).resolves.toBeNull()
  })

  it('accepts capability at exactly the confidence threshold', async () => {
    mockChatJson.mockResolvedValueOnce({ capability: 'places', confidence: CONFIDENCE_THRESHOLD })
    const result = await routeIntent('親子景點推薦', mockEnv)
    expect(result).toBe('places')
  })

  it('passes message text to chatJson as user prompt', async () => {
    mockChatJson.mockResolvedValueOnce({ capability: 'places', confidence: 0.8 })
    const message = '台北室內親子餐廳'
    await routeIntent(message, mockEnv)
    expect(mockChatJson.mock.calls[0][3]).toBe(message)
  })
})
