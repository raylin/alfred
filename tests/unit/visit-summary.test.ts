import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/notion', () => ({
  queryVisitsForPlace: vi.fn(),
  patchPlaceSummary: vi.fn(),
}))

import { recomputePlaceSummary } from '../../src/capabilities/places/visit-summary'
import { queryVisitsForPlace, patchPlaceSummary } from '../../src/integrations/notion'

const mockQuery = vi.mocked(queryVisitsForPlace)
const mockPatch = vi.mocked(patchPlaceSummary)
const mockEnv = {} as unknown as Env

beforeEach(() => vi.clearAllMocks())

describe('recomputePlaceSummary', () => {
  it('queries visits and patches place with computed summary', async () => {
    const summary = { last_visited: '2026-05-04', visit_count: 3, avg_rating: 4.3 }
    mockQuery.mockResolvedValueOnce(summary)
    mockPatch.mockResolvedValueOnce(undefined)

    await recomputePlaceSummary('place-page-id', mockEnv)

    expect(mockQuery).toHaveBeenCalledWith('place-page-id', mockEnv)
    expect(mockPatch).toHaveBeenCalledWith('place-page-id', summary, mockEnv)
  })

  it('does not throw if queryVisitsForPlace fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Notion down'))
    await expect(recomputePlaceSummary('place-page-id', mockEnv)).resolves.toBeUndefined()
  })

  it('does not throw if patchPlaceSummary fails', async () => {
    mockQuery.mockResolvedValueOnce({ last_visited: null, visit_count: 1, avg_rating: null })
    mockPatch.mockRejectedValueOnce(new Error('PATCH failed'))
    await expect(recomputePlaceSummary('place-page-id', mockEnv)).resolves.toBeUndefined()
  })
})
