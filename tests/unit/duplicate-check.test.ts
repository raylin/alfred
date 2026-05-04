import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/notion', () => ({
  findPlaceByGooglePlaceId: vi.fn(),
}))

import { checkDuplicate, writeDedupKV } from '../../src/capabilities/places/duplicate-check'
import { findPlaceByGooglePlaceId } from '../../src/integrations/notion'
import { SAMPLE_PLACE } from '../fixtures/places'

const mockFindByGoogleId = vi.mocked(findPlaceByGooglePlaceId)

const mockEnv = {
  ALFRED_KV: {
    get: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
  },
} as unknown as Env

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkDuplicate — KV fast path', () => {
  it('returns found:true from KV when entry exists', async () => {
    const kvData = { notion_page_id: 'page-abc', internal_id: 'int-123', name: '兒童新樂園' }
    ;(mockEnv.ALFRED_KV as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValue(JSON.stringify(kvData))

    const result = await checkDuplicate('ChIJabc', mockEnv)

    expect(result).toEqual({ found: true, ...kvData })
    expect(mockFindByGoogleId).not.toHaveBeenCalled()
  })

  it('falls through to Notion when KV returns null', async () => {
    ;(mockEnv.ALFRED_KV as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValue(null)
    mockFindByGoogleId.mockResolvedValue(null)

    const result = await checkDuplicate('ChIJabc', mockEnv)

    expect(result).toEqual({ found: false })
    expect(mockFindByGoogleId).toHaveBeenCalledWith('ChIJabc', mockEnv)
  })

  it('falls through to Notion when KV data is corrupted', async () => {
    ;(mockEnv.ALFRED_KV as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValue('not-json{')
    mockFindByGoogleId.mockResolvedValue(null)

    const result = await checkDuplicate('ChIJabc', mockEnv)

    expect(result).toEqual({ found: false })
    expect(mockFindByGoogleId).toHaveBeenCalledOnce()
  })
})

describe('checkDuplicate — Notion slow path', () => {
  beforeEach(() => {
    ;(mockEnv.ALFRED_KV as unknown as { get: ReturnType<typeof vi.fn> }).get.mockResolvedValue(null)
  })

  it('returns found:true from Notion when place exists', async () => {
    mockFindByGoogleId.mockResolvedValue({ ...SAMPLE_PLACE, notion_page_id: 'page-xyz', internal_id: 'int-456', name: '大湖公園' })

    const result = await checkDuplicate('ChIJabc', mockEnv)

    expect(result).toEqual({ found: true, notion_page_id: 'page-xyz', internal_id: 'int-456', name: '大湖公園' })
  })

  it('returns found:false when Notion has no match', async () => {
    mockFindByGoogleId.mockResolvedValue(null)

    const result = await checkDuplicate('ChIJabc', mockEnv)

    expect(result).toEqual({ found: false })
  })

  it('returns found:false when Notion throws (treats as no duplicate)', async () => {
    mockFindByGoogleId.mockRejectedValue(new Error('Notion 503'))

    const result = await checkDuplicate('ChIJabc', mockEnv)

    expect(result).toEqual({ found: false })
  })
})

describe('writeDedupKV', () => {
  it('writes dedup:{id} key with 30-day TTL', async () => {
    await writeDedupKV(mockEnv, 'ChIJabc', 'page-abc', 'int-123', '兒童新樂園')

    const kvPut = (mockEnv.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(
      'dedup:ChIJabc',
      expect.stringContaining('"notion_page_id":"page-abc"'),
      { expirationTtl: 30 * 24 * 60 * 60 },
    )
  })
})
