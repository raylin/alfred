import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'
import { writeRawExtraction, writeUserLastPlace } from '../../src/capabilities/places/kv-store'

const mockKvPut = vi.fn().mockResolvedValue(undefined)

const mockEnv = {
  ALFRED_KV: { put: mockKvPut },
} as unknown as Env

beforeEach(() => {
  vi.clearAllMocks()
})

describe('writeRawExtraction', () => {
  it('writes to place:{id}:raw with 90-day TTL', async () => {
    await writeRawExtraction(mockEnv, 'uuid-abc', {
      raw_input: 'https://example.com',
      raw_html: '<p>test</p>',
      extracted_at: '2026-05-04T00:00:00.000Z',
    })

    expect(mockKvPut).toHaveBeenCalledWith(
      'place:uuid-abc:raw',
      expect.any(String),
      { expirationTtl: 90 * 24 * 60 * 60 },
    )
  })

  it('stores JSON with all provided fields', async () => {
    await writeRawExtraction(mockEnv, 'uuid-xyz', {
      raw_input: 'test-input',
      raw_google_places: '{"name":"park"}',
      extracted_at: '2026-05-04T00:00:00.000Z',
    })

    const json = JSON.parse(mockKvPut.mock.calls[0][1] as string)
    expect(json.raw_input).toBe('test-input')
    expect(json.raw_google_places).toBe('{"name":"park"}')
    expect(json.extracted_at).toBe('2026-05-04T00:00:00.000Z')
  })
})

describe('writeUserLastPlace', () => {
  it('writes to user:{userId}:last_place with 24-hour TTL', async () => {
    await writeUserLastPlace(mockEnv, 'U123', 'uuid-abc', 'chat-456')

    expect(mockKvPut).toHaveBeenCalledWith(
      'user:U123:last_place',
      expect.any(String),
      { expirationTtl: 24 * 60 * 60 },
    )
  })

  it('stores internal_id, sent_at, and chat_id in JSON', async () => {
    await writeUserLastPlace(mockEnv, 'U123', 'uuid-abc', 'chat-456')

    const json = JSON.parse(mockKvPut.mock.calls[0][1] as string)
    expect(json.internal_id).toBe('uuid-abc')
    expect(json.chat_id).toBe('chat-456')
    expect(typeof json.sent_at).toBe('string')
  })
})
