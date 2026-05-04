import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'
import type { Place } from '../../src/capabilities/places/schema'

vi.mock('../../src/integrations/anthropic', () => ({
  MODELS: { extraction: 'claude-sonnet-4-6', search: 'claude-haiku-4-5-20251001' },
  createClient: vi.fn(() => ({})),
  chatJson: vi.fn(),
}))

import { parseEditIntent, parseEditTarget } from '../../src/capabilities/places/edit-parser'
import { chatJson } from '../../src/integrations/anthropic'

const mockChatJson = vi.mocked(chatJson)
const mockEnv = { ANTHROPIC_API_KEY: 'test-key' } as unknown as Env

beforeEach(() => vi.clearAllMocks())

const SAMPLE_PLACE: Place = {
  name: '大湖公園', summary: '', categories: ['公園'],
  seasons: ['全年'], ai_inferred_fields: [], source_type: [],
  indoor_outdoor: '室外' as const, address: null, region: '台北' as const,
  longitude: null, latitude: null, google_place_id: null,
  age_min: 3, age_max: 6, stroller_friendly: null, parking_friendly: null,
  has_restroom: null, has_nursing_room: null, energy_level: null,
  stay_minutes: null, reservation_needed: null, crowded_on_weekends: null,
  fee_type: null, fee_details: null, source_url: null, internal_id: 'int-001',
  created_by: null, notion_page_id: 'page-aaa', status: 'draft' as const,
}

describe('parseEditIntent — happy paths', () => {
  it('parses age range edit', async () => {
    mockChatJson.mockResolvedValueOnce([
      { property: 'Age Min', value: 5 },
      { property: 'Age Max', value: 10 },
    ])
    const result = await parseEditIntent('改成 5-10 歲', SAMPLE_PLACE, mockEnv)
    expect(result).toEqual([
      { property: 'Age Min', value: 5 },
      { property: 'Age Max', value: 10 },
    ])
  })

  it('parses indoor/outdoor edit', async () => {
    mockChatJson.mockResolvedValueOnce([{ property: 'Indoor/Outdoor', value: '室內' }])
    const result = await parseEditIntent('改室內', SAMPLE_PLACE, mockEnv)
    expect(result).toEqual([{ property: 'Indoor/Outdoor', value: '室內' }])
  })

  it('parses multi-select add', async () => {
    mockChatJson.mockResolvedValueOnce([{ property: 'Categories', op: 'add', values: ['沙坑'] }])
    const result = await parseEditIntent('加沙坑', SAMPLE_PLACE, mockEnv)
    expect(result).toEqual([{ property: 'Categories', op: 'add', values: ['沙坑'] }])
  })

  it('parses status change', async () => {
    mockChatJson.mockResolvedValueOnce([{ property: 'Status', value: 'confirmed' }])
    const result = await parseEditIntent('Status 設成 confirmed', SAMPLE_PLACE, mockEnv)
    expect(result).toEqual([{ property: 'Status', value: 'confirmed' }])
  })

  it('returns Name op for rename attempt (detectable but rejected by applyEdits)', async () => {
    mockChatJson.mockResolvedValueOnce([{ property: 'Name', value: '兒童新樂園' }])
    const result = await parseEditIntent('改名叫兒童新樂園', SAMPLE_PLACE, mockEnv)
    expect(result).toEqual([{ property: 'Name', value: '兒童新樂園' }])
  })

  it('returns [] when intent is ambiguous', async () => {
    mockChatJson.mockResolvedValueOnce([])
    const result = await parseEditIntent('沙坑超棒', SAMPLE_PLACE, mockEnv)
    expect(result).toEqual([])
  })
})

describe('parseEditIntent — system prompt includes current place context', () => {
  it('passes current place state in system prompt', async () => {
    mockChatJson.mockResolvedValueOnce([])
    await parseEditIntent('改室內', SAMPLE_PLACE, mockEnv)
    const systemPrompt = mockChatJson.mock.calls[0][2] as string
    expect(systemPrompt).toContain('大湖公園')
    expect(systemPrompt).toContain('Categories')
    expect(systemPrompt).toContain('公園')
  })
})

describe('parseEditIntent — failure handling', () => {
  it('retries once and returns [] on double failure', async () => {
    mockChatJson.mockRejectedValueOnce(new Error('API error'))
    mockChatJson.mockRejectedValueOnce(new Error('API error'))
    const result = await parseEditIntent('改室內', SAMPLE_PLACE, mockEnv)
    expect(result).toEqual([])
    expect(mockChatJson).toHaveBeenCalledTimes(2)
  })

  it('succeeds on second attempt', async () => {
    mockChatJson.mockRejectedValueOnce(new Error('transient'))
    mockChatJson.mockResolvedValueOnce([{ property: 'Indoor/Outdoor', value: '室內' }])
    const result = await parseEditIntent('改室內', SAMPLE_PLACE, mockEnv)
    expect(result).toHaveLength(1)
    expect(mockChatJson).toHaveBeenCalledTimes(2)
  })

  it('returns [] when response is not an array', async () => {
    mockChatJson.mockResolvedValueOnce({ property: 'Indoor/Outdoor', value: '室內' })
    const result = await parseEditIntent('改室內', SAMPLE_PLACE, mockEnv)
    expect(result).toEqual([])
  })

  it('filters out invalid ops missing property field', async () => {
    mockChatJson.mockResolvedValueOnce([
      { property: 'Indoor/Outdoor', value: '室內' },
      { value: '室外' },  // missing property
    ])
    const result = await parseEditIntent('改室內', SAMPLE_PLACE, mockEnv)
    expect(result).toHaveLength(1)
  })
})

describe('parseEditTarget', () => {
  it('extracts place name and edit message from named edit', async () => {
    mockChatJson.mockResolvedValueOnce({ target_place_name: '大湖公園', edit_message: '改成室內' })
    const result = await parseEditTarget('大湖公園改成室內', mockEnv)
    expect(result.target_place_name).toBe('大湖公園')
    expect(result.edit_message).toBe('改成室內')
  })

  it('returns null target_place_name for unnamed edit', async () => {
    mockChatJson.mockResolvedValueOnce({ target_place_name: null, edit_message: '改成 5-10 歲' })
    const result = await parseEditTarget('改成 5-10 歲', mockEnv)
    expect(result.target_place_name).toBeNull()
    expect(result.edit_message).toBe('改成 5-10 歲')
  })

  it('falls back to original message on failure', async () => {
    mockChatJson.mockRejectedValueOnce(new Error('API error'))
    mockChatJson.mockRejectedValueOnce(new Error('API error'))
    const result = await parseEditTarget('大湖公園改室內', mockEnv)
    expect(result.target_place_name).toBeNull()
    expect(result.edit_message).toBe('大湖公園改室內')
  })
})
