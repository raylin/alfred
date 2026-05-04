import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/lib/ulid', () => ({ generateUlid: vi.fn() }))

import { generateUlid } from '../../src/lib/ulid'
import { logEvent } from '../../src/lib/observability'

const mockGenerateUlid = vi.mocked(generateUlid)

const mockKv = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}
const mockEnv = { ALFRED_KV: mockKv } as unknown as Env

beforeEach(() => {
  vi.clearAllMocks()
  mockKv.get.mockResolvedValue(null)
  mockKv.put.mockResolvedValue(undefined)
  mockGenerateUlid.mockReturnValue('01AAAAAAAAAAAAAAAAAAAAAAAAA')
})

describe('logEvent', () => {
  it('writes event to KV with event:{ulid} key and 7-day TTL', async () => {
    await logEvent(mockEnv, { type: 'places.search', duration_ms: 100, outcome: 'success' })
    const putCalls = mockKv.put.mock.calls
    const eventCall = putCalls.find(c => c[0].startsWith('event:'))
    expect(eventCall).toBeDefined()
    expect(eventCall![0]).toBe('event:01AAAAAAAAAAAAAAAAAAAAAAAAA')
    const stored = JSON.parse(eventCall![1] as string)
    expect(stored.type).toBe('places.search')
    expect(stored.duration_ms).toBe(100)
    expect(stored.outcome).toBe('success')
    expect(stored.ulid).toBe('01AAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(stored.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(eventCall![2]).toEqual({ expirationTtl: 604800 }) // 7 days
  })

  it('prepends ULID to ring buffer and saves', async () => {
    mockKv.get.mockImplementation((key: string) =>
      key === 'events:recent' ? Promise.resolve(JSON.stringify(['OLD_ULID'])) : Promise.resolve(null)
    )

    await logEvent(mockEnv, { type: 'places.search', duration_ms: 50, outcome: 'success' })

    const ringCall = mockKv.put.mock.calls.find(c => c[0] === 'events:recent')
    expect(ringCall).toBeDefined()
    const ring = JSON.parse(ringCall![1] as string)
    expect(ring[0]).toBe('01AAAAAAAAAAAAAAAAAAAAAAAAA') // newest first
    expect(ring[1]).toBe('OLD_ULID')
  })

  it('creates new ring buffer when none exists', async () => {
    await logEvent(mockEnv, { type: 'places.add.url', duration_ms: 200, outcome: 'success' })

    const ringCall = mockKv.put.mock.calls.find(c => c[0] === 'events:recent')
    expect(ringCall).toBeDefined()
    const ring = JSON.parse(ringCall![1] as string)
    expect(ring).toEqual(['01AAAAAAAAAAAAAAAAAAAAAAAAA'])
  })

  it('caps ring buffer at 100 entries', async () => {
    const existing = Array.from({ length: 100 }, (_, i) => `ULID_${i}`)
    mockKv.get.mockImplementation((key: string) =>
      key === 'events:recent' ? Promise.resolve(JSON.stringify(existing)) : Promise.resolve(null)
    )

    await logEvent(mockEnv, { type: 'places.search', duration_ms: 50, outcome: 'success' })

    const ringCall = mockKv.put.mock.calls.find(c => c[0] === 'events:recent')
    const ring = JSON.parse(ringCall![1] as string)
    expect(ring).toHaveLength(100)
    expect(ring[0]).toBe('01AAAAAAAAAAAAAAAAAAAAAAAAA') // new ULID at front
    expect(ring[99]).toBe('ULID_98') // last old entry dropped
  })

  it('is non-fatal: swallows KV errors silently', async () => {
    mockKv.put.mockRejectedValue(new Error('KV unavailable'))
    await expect(
      logEvent(mockEnv, { type: 'places.search', duration_ms: 50, outcome: 'success' })
    ).resolves.toBeUndefined() // does not throw
  })

  it('includes optional fields when provided', async () => {
    await logEvent(mockEnv, {
      type: 'places.search',
      user_id: 'U123',
      intent: 'search',
      confidence: 0.9,
      result_count: 5,
      duration_ms: 300,
      outcome: 'success',
      meta: { query: 'park' },
    })

    const eventCall = mockKv.put.mock.calls.find(c => c[0].startsWith('event:'))
    const stored = JSON.parse(eventCall![1] as string)
    expect(stored.user_id).toBe('U123')
    expect(stored.intent).toBe('search')
    expect(stored.confidence).toBe(0.9)
    expect(stored.result_count).toBe(5)
    expect(stored.meta).toEqual({ query: 'park' })
  })

  it('includes error field when provided', async () => {
    await logEvent(mockEnv, { type: 'places.add.url', duration_ms: 50, outcome: 'error', error: 'fetch_failed' })

    const eventCall = mockKv.put.mock.calls.find(c => c[0].startsWith('event:'))
    const stored = JSON.parse(eventCall![1] as string)
    expect(stored.error).toBe('fetch_failed')
  })
})
