import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/anthropic', () => ({
  MODELS: { extraction: 'claude-sonnet-4-6', search: 'claude-haiku-4-5-20251001' },
  createClient: vi.fn(() => ({})),
  chatJson: vi.fn(),
}))

import { parseDeleteIntent } from '../../src/capabilities/places/delete-parser'
import { chatJson } from '../../src/integrations/anthropic'

const mockChatJson = vi.mocked(chatJson)
const mockEnv = { ANTHROPIC_API_KEY: 'test-key' } as unknown as Env

beforeEach(() => vi.clearAllMocks())

describe('parseDeleteIntent — target: last', () => {
  it.each([
    ['刪掉剛剛那筆'],
    ['重做'],
    ['不要這筆'],
    ['刪掉那個'],
  ])('"%s" → last', async (msg) => {
    mockChatJson.mockResolvedValueOnce({ target: 'last' })
    const result = await parseDeleteIntent(msg, mockEnv)
    expect(result.target).toBe('last')
  })
})

describe('parseDeleteIntent — target: named place', () => {
  it('extracts place name from "刪掉大湖公園"', async () => {
    mockChatJson.mockResolvedValueOnce({ target: '大湖公園' })
    const result = await parseDeleteIntent('刪掉大湖公園', mockEnv)
    expect(result.target).toBe('大湖公園')
  })

  it('extracts place name with longer phrase', async () => {
    mockChatJson.mockResolvedValueOnce({ target: '動物園' })
    const result = await parseDeleteIntent('幫我把動物園那筆刪掉', mockEnv)
    expect(result.target).toBe('動物園')
  })
})

describe('parseDeleteIntent — target: null (safety net)', () => {
  it('returns null for non-delete message', async () => {
    mockChatJson.mockResolvedValueOnce({ target: null })
    const result = await parseDeleteIntent('我們去了大湖公園', mockEnv)
    expect(result.target).toBeNull()
  })

  it('returns null when response shape is wrong', async () => {
    mockChatJson.mockResolvedValueOnce('not an object')
    const result = await parseDeleteIntent('blah', mockEnv)
    expect(result.target).toBeNull()
  })

  it('returns null when target field missing', async () => {
    mockChatJson.mockResolvedValueOnce({ something_else: 'yes' })
    const result = await parseDeleteIntent('blah', mockEnv)
    expect(result.target).toBeNull()
  })
})

describe('parseDeleteIntent — failure handling', () => {
  it('retries once and returns null on double failure', async () => {
    mockChatJson.mockRejectedValueOnce(new Error('API error'))
    mockChatJson.mockRejectedValueOnce(new Error('API error'))
    const result = await parseDeleteIntent('刪掉大湖公園', mockEnv)
    expect(result.target).toBeNull()
    expect(mockChatJson).toHaveBeenCalledTimes(2)
  })

  it('succeeds on second attempt', async () => {
    mockChatJson.mockRejectedValueOnce(new Error('transient'))
    mockChatJson.mockResolvedValueOnce({ target: '大湖公園' })
    const result = await parseDeleteIntent('刪掉大湖公園', mockEnv)
    expect(result.target).toBe('大湖公園')
    expect(mockChatJson).toHaveBeenCalledTimes(2)
  })

  it('returns null when target is empty string', async () => {
    mockChatJson.mockResolvedValueOnce({ target: '' })
    const result = await parseDeleteIntent('blah', mockEnv)
    expect(result.target).toBeNull()
  })
})
