import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/anthropic', () => ({
  MODELS: { extraction: 'claude-sonnet-4-6', search: 'claude-haiku-4-5-20251001' },
  createClient: vi.fn(() => ({})),
  chatJson: vi.fn(),
}))

import { parseVisitMessage } from '../../src/capabilities/places/visit-parser'
import { chatJson } from '../../src/integrations/anthropic'

const mockChatJson = vi.mocked(chatJson)
const mockEnv = { ANTHROPIC_API_KEY: 'test-key' } as unknown as Env

beforeEach(() => vi.clearAllMocks())

function mockResult(result: unknown) {
  mockChatJson.mockResolvedValueOnce(result)
}

describe('parseVisitMessage — happy paths', () => {
  it('parses place name, date, and notes', async () => {
    mockResult({ place_query: '大湖公園', visited_on: '2026-05-04', rating_signal: null, notes: '很好玩' })
    const result = await parseVisitMessage('今天去了大湖公園，很好玩', mockEnv)
    expect(result).toEqual({ place_query: '大湖公園', visited_on: '2026-05-04', rating_signal: null, notes: '很好玩' })
  })

  it('returns "last" for vague place references', async () => {
    mockResult({ place_query: 'last', visited_on: '2026-05-04', rating_signal: null, notes: null })
    const result = await parseVisitMessage('昨天去的那個地方', mockEnv)
    expect(result.place_query).toBe('last')
  })

  it('parses rating_signal when explicitly given', async () => {
    mockResult({ place_query: '兒童新樂園', visited_on: null, rating_signal: 4, notes: null })
    const result = await parseVisitMessage('兒童新樂園 4顆星', mockEnv)
    expect(result.rating_signal).toBe(4)
  })

  it('returns null place_query when place is ambiguous', async () => {
    mockResult({ place_query: null, visited_on: '2026-05-04', rating_signal: null, notes: null })
    const result = await parseVisitMessage('今天去玩了', mockEnv)
    expect(result.place_query).toBeNull()
  })
})

describe('parseVisitMessage — sanitization', () => {
  it('rejects invalid date format', async () => {
    mockResult({ place_query: '大湖公園', visited_on: '2026/05/04', rating_signal: null, notes: null })
    const result = await parseVisitMessage('test', mockEnv)
    expect(result.visited_on).toBeNull()
  })

  it('rejects out-of-range rating_signal', async () => {
    mockResult({ place_query: '大湖公園', visited_on: null, rating_signal: 6, notes: null })
    const result = await parseVisitMessage('test', mockEnv)
    expect(result.rating_signal).toBeNull()
  })

  it('rejects non-string notes', async () => {
    mockResult({ place_query: '大湖公園', visited_on: null, rating_signal: null, notes: 123 })
    const result = await parseVisitMessage('test', mockEnv)
    expect(result.notes).toBeNull()
  })

  it('accepts valid rating_signal values 1-5', async () => {
    for (const r of [1, 2, 3, 4, 5]) {
      mockResult({ place_query: '大湖公園', visited_on: null, rating_signal: r, notes: null })
      const result = await parseVisitMessage('test', mockEnv)
      expect(result.rating_signal).toBe(r)
    }
  })
})

describe('parseVisitMessage — failure handling', () => {
  it('retries once on API failure then returns null fields', async () => {
    mockChatJson.mockRejectedValueOnce(new Error('API error'))
    mockChatJson.mockRejectedValueOnce(new Error('API error'))
    const result = await parseVisitMessage('test', mockEnv)
    expect(result).toEqual({ place_query: null, visited_on: null, rating_signal: null, notes: null })
    expect(mockChatJson).toHaveBeenCalledTimes(2)
  })

  it('succeeds on second attempt after first failure', async () => {
    mockChatJson.mockRejectedValueOnce(new Error('transient'))
    mockResult({ place_query: '大湖公園', visited_on: null, rating_signal: null, notes: null })
    const result = await parseVisitMessage('test', mockEnv)
    expect(result.place_query).toBe('大湖公園')
    expect(mockChatJson).toHaveBeenCalledTimes(2)
  })

  it('returns null fields when response is not an object', async () => {
    mockResult('not an object')
    const result = await parseVisitMessage('test', mockEnv)
    expect(result).toEqual({ place_query: null, visited_on: null, rating_signal: null, notes: null })
  })
})
