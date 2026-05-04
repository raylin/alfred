import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

const mockKv = {
  put: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
}
const mockEnv = { ALFRED_KV: mockKv } as unknown as Env

beforeEach(() => vi.clearAllMocks())

import {
  writePendingRating,
  readPendingRating,
  clearPendingRating,
  writePendingVisit,
  readPendingVisit,
  clearPendingVisit,
} from '../../src/capabilities/places/kv-store'

const RATING_DATA = {
  visit_notion_page_id: 'visit-page-id',
  place_notion_page_id: 'place-page-id',
  place_name: '大湖公園',
}

describe('writePendingRating', () => {
  it('writes to user:{id}:pending_rating with 10-min TTL', async () => {
    await writePendingRating(mockEnv, 'u1', RATING_DATA)
    expect(mockKv.put).toHaveBeenCalledWith(
      'user:u1:pending_rating',
      JSON.stringify(RATING_DATA),
      { expirationTtl: 600 },
    )
  })
})

describe('readPendingRating', () => {
  it('returns parsed data when key exists', async () => {
    mockKv.get.mockResolvedValueOnce(JSON.stringify(RATING_DATA))
    const result = await readPendingRating(mockEnv, 'u1')
    expect(result).toEqual(RATING_DATA)
  })

  it('returns null when key missing', async () => {
    mockKv.get.mockResolvedValueOnce(null)
    const result = await readPendingRating(mockEnv, 'u1')
    expect(result).toBeNull()
  })

  it('returns null on corrupt JSON', async () => {
    mockKv.get.mockResolvedValueOnce('not-json{{{')
    const result = await readPendingRating(mockEnv, 'u1')
    expect(result).toBeNull()
  })
})

describe('clearPendingRating', () => {
  it('deletes the key', async () => {
    await clearPendingRating(mockEnv, 'u1')
    expect(mockKv.delete).toHaveBeenCalledWith('user:u1:pending_rating')
  })

  it('does not throw if delete fails', async () => {
    mockKv.delete.mockRejectedValueOnce(new Error('KV error'))
    await expect(clearPendingRating(mockEnv, 'u1')).resolves.toBeUndefined()
  })
})

const VISIT_DATA = { visited_on: '2026-05-04', rating_signal: 4 as const, notes: '很好玩' }

describe('writePendingVisit', () => {
  it('writes to user:{id}:pending_visit with 10-min TTL', async () => {
    await writePendingVisit(mockEnv, 'u1', VISIT_DATA)
    expect(mockKv.put).toHaveBeenCalledWith(
      'user:u1:pending_visit',
      JSON.stringify(VISIT_DATA),
      { expirationTtl: 600 },
    )
  })
})

describe('readPendingVisit', () => {
  it('returns parsed data when key exists', async () => {
    mockKv.get.mockResolvedValueOnce(JSON.stringify(VISIT_DATA))
    const result = await readPendingVisit(mockEnv, 'u1')
    expect(result).toEqual(VISIT_DATA)
  })

  it('returns null when key missing', async () => {
    mockKv.get.mockResolvedValueOnce(null)
    expect(await readPendingVisit(mockEnv, 'u1')).toBeNull()
  })
})

describe('clearPendingVisit', () => {
  it('deletes the key', async () => {
    await clearPendingVisit(mockEnv, 'u1')
    expect(mockKv.delete).toHaveBeenCalledWith('user:u1:pending_visit')
  })
})
