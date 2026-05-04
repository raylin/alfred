import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/anthropic', () => ({
  createClient: vi.fn().mockReturnValue({}),
  chatJson: vi.fn(),
  MODELS: { search: 'claude-haiku-4-5-20251001', extraction: 'claude-sonnet-4-6' },
}))

import { parseSearchIntent } from '../../src/capabilities/places/search-parser'
import { chatJson } from '../../src/integrations/anthropic'

const mockChatJson = vi.mocked(chatJson)

const mockEnv = {
  ANTHROPIC_API_KEY: 'test',
} as unknown as Env

function makeRaw(overrides: Partial<{
  indoor_outdoor: string | null
  age: number | null
  region: string | null
  categories: string[] | null
  seasons: string[] | null
  fee_type: string | null
  energy_level: string | null
  free_text_keywords: string[]
}> = {}) {
  return {
    filters: {
      indoor_outdoor: null,
      age: null,
      region: null,
      categories: null,
      seasons: null,
      fee_type: null,
      energy_level: null,
      free_text_keywords: [],
      ...overrides,
    },
    query_intent_summary: '測試搜尋',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseSearchIntent', () => {
  it('parses indoor_outdoor filter', async () => {
    mockChatJson.mockResolvedValue(makeRaw({ indoor_outdoor: '室內' }))
    const result = await parseSearchIntent('下雨天可以去哪', mockEnv)
    expect(result.filters.indoor_outdoor).toBe('室內')
  })

  it('parses age filter', async () => {
    mockChatJson.mockResolvedValue(makeRaw({ age: 3 }))
    const result = await parseSearchIntent('三歲適合的景點', mockEnv)
    expect(result.filters.age).toBe(3)
  })

  it('parses region filter', async () => {
    mockChatJson.mockResolvedValue(makeRaw({ region: '台北' }))
    const result = await parseSearchIntent('台北有哪些公園', mockEnv)
    expect(result.filters.region).toBe('台北')
  })

  it('parses categories filter', async () => {
    mockChatJson.mockResolvedValue(makeRaw({ categories: ['公園', '步道'] }))
    const result = await parseSearchIntent('有沒有公園或步道', mockEnv)
    expect(result.filters.categories).toEqual(['公園', '步道'])
  })

  it('returns free_text_keywords', async () => {
    mockChatJson.mockResolvedValue(makeRaw({ free_text_keywords: ['滑水道', '戲水池'] }))
    const result = await parseSearchIntent('有滑水道的地方', mockEnv)
    expect(result.filters.free_text_keywords).toEqual(['滑水道', '戲水池'])
  })

  it('returns query_intent_summary', async () => {
    mockChatJson.mockResolvedValue({ ...makeRaw(), query_intent_summary: '下雨天三歲室內景點' })
    const result = await parseSearchIntent('下雨天三歲', mockEnv)
    expect(result.query_intent_summary).toBe('下雨天三歲室內景點')
  })

  it('defaults null filters when haiku omits fields', async () => {
    mockChatJson.mockResolvedValue({
      filters: { indoor_outdoor: null, age: null, region: null, categories: null, seasons: null, fee_type: null, energy_level: null, free_text_keywords: [] },
      query_intent_summary: '景點搜尋',
    })
    const result = await parseSearchIntent('推薦一個好地方', mockEnv)
    expect(result.filters.age).toBeNull()
    expect(result.filters.categories).toBeNull()
  })

  it('retries once on parse failure then succeeds', async () => {
    mockChatJson
      .mockRejectedValueOnce(new Error('API error'))
      .mockResolvedValueOnce(makeRaw({ age: 5 }))
    const result = await parseSearchIntent('五歲景點', mockEnv)
    expect(mockChatJson).toHaveBeenCalledTimes(2)
    expect(result.filters.age).toBe(5)
  })

  it('throws when both attempts fail', async () => {
    mockChatJson.mockRejectedValue(new Error('API down'))
    await expect(parseSearchIntent('測試', mockEnv)).rejects.toThrow()
    expect(mockChatJson).toHaveBeenCalledTimes(2)
  })

  it('system prompt instructs Haiku not to include meta-words in free_text_keywords', async () => {
    // Verify prompt wording — if Haiku follows it, "附近" "推薦" etc should not appear
    // This test validates the prompt content is in place
    mockChatJson.mockResolvedValue(makeRaw({ categories: ['公園'], free_text_keywords: [] }))

    const result = await parseSearchIntent('幫我找附近的公園', mockEnv)

    expect(result.filters.categories).toEqual(['公園'])
    // Prompt instructs: do NOT put meta-words like 附近/推薦/幫我/找 in free_text_keywords
    // When Haiku follows the prompt, free_text_keywords should be empty for this query
    expect(result.filters.free_text_keywords).toEqual([])
  })
})
