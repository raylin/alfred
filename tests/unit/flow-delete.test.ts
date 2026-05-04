import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/capabilities/places/delete-parser', () => ({
  parseDeleteIntent: vi.fn(),
}))
vi.mock('../../src/capabilities/places/disambiguate', () => ({
  buildDisambiguateCard: vi.fn().mockReturnValue({ type: 'flex', altText: 'disambig', contents: {} }),
}))
vi.mock('../../src/capabilities/places/flex-message', () => ({
  buildDeleteConfirmCard: vi.fn().mockReturnValue({ type: 'flex', altText: 'confirm-delete', contents: {} }),
}))
vi.mock('../../src/integrations/notion', () => ({
  archivePlace: vi.fn().mockResolvedValue(undefined),
  getPlaceByNotionPageId: vi.fn(),
  findPlaceByInternalId: vi.fn(),
  searchPlaces: vi.fn(),
  queryVisitsForPlace: vi.fn().mockResolvedValue({ visit_count: 0, last_visited: null, avg_rating: null }),
}))
vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))

import {
  runFlowDelete,
  runFlowDeleteSelect,
  runFlowDeleteConfirm,
  runFlowDeleteCancel,
} from '../../src/capabilities/places/flow-delete'
import { parseDeleteIntent } from '../../src/capabilities/places/delete-parser'
import { buildDeleteConfirmCard } from '../../src/capabilities/places/flex-message'
import {
  archivePlace,
  getPlaceByNotionPageId,
  findPlaceByInternalId,
  searchPlaces,
  queryVisitsForPlace,
} from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'

const mockParse = vi.mocked(parseDeleteIntent)
const mockArchive = vi.mocked(archivePlace)
const mockGetPlace = vi.mocked(getPlaceByNotionPageId)
const mockFindByInternal = vi.mocked(findPlaceByInternalId)
const mockSearch = vi.mocked(searchPlaces)
const mockQueryVisits = vi.mocked(queryVisitsForPlace)
const mockReply = vi.mocked(sendReply)
const mockBuildConfirm = vi.mocked(buildDeleteConfirmCard)

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
const mockEnv = {
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
  ALFRED_KV: mockKv,
} as unknown as Env

function makeSamplePlace(overrides: Record<string, unknown> = {}) {
  return {
    name: '大湖公園',
    notion_page_id: 'page-aaa',
    internal_id: 'int-001',
    google_place_id: 'gplace-001',
    summary: '',
    categories: [],
    seasons: [],
    ai_inferred_fields: [],
    source_type: [],
    indoor_outdoor: null,
    address: null,
    region: null,
    longitude: null, latitude: null,
    age_min: null, age_max: null,
    stroller_friendly: null, parking_friendly: null,
    has_restroom: null, has_nursing_room: null,
    energy_level: null, stay_minutes: null,
    reservation_needed: null, crowded_on_weekends: null,
    fee_type: null, fee_details: null,
    source_url: null, created_by: null,
    status: 'draft',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockKv.get.mockResolvedValue(null)
  mockKv.delete.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// runFlowDelete — target: null (safety net)
// ---------------------------------------------------------------------------

describe('runFlowDelete — target null', () => {
  it('asks user to specify a place', async () => {
    mockParse.mockResolvedValueOnce({ target: null })
    await runFlowDelete('不知道啥', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('指名') }),
    ]), 'test-token', 'chat1')
    expect(mockArchive).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// runFlowDelete — target: 'last' (anchor path, no confirmation)
// ---------------------------------------------------------------------------

describe('runFlowDelete — target last, no anchor', () => {
  it('asks user which place when last_place KV is missing', async () => {
    mockParse.mockResolvedValueOnce({ target: 'last' })
    mockKv.get.mockResolvedValue(null)
    await runFlowDelete('重做', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('找不到剛剛') }),
    ]), 'test-token', 'chat1')
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('asks user when no userId provided', async () => {
    mockParse.mockResolvedValueOnce({ target: 'last' })
    await runFlowDelete('重做', 'reply-token', mockEnv, undefined, 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('找不到剛剛') }),
    ]), 'test-token', 'chat1')
    expect(mockArchive).not.toHaveBeenCalled()
  })
})

describe('runFlowDelete — target last, anchor found', () => {
  beforeEach(() => {
    mockParse.mockResolvedValueOnce({ target: 'last' })
    mockKv.get.mockResolvedValueOnce(JSON.stringify({
      internal_id: 'int-001',
      sent_at: new Date().toISOString(),
    }))
    mockFindByInternal.mockResolvedValueOnce(makeSamplePlace() as never)
  })

  it('archives place directly without confirmation', async () => {
    await runFlowDelete('刪掉剛剛那筆', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockArchive).toHaveBeenCalledWith('page-aaa', mockEnv)
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('✓ 已刪除') }),
    ]), 'test-token', 'chat1')
  })

  it('does NOT show confirmation card (no confirmation for last-path)', async () => {
    await runFlowDelete('重做', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockBuildConfirm).not.toHaveBeenCalled()
  })

  it('deletes dedup KV when place has google_place_id', async () => {
    await runFlowDelete('刪掉剛剛那筆', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockKv.delete).toHaveBeenCalledWith('dedup:gplace-001')
  })

  it('clears last_place KV if it points to deleted place', async () => {
    // second get in doDelete — last_place still points to int-001
    mockKv.get.mockResolvedValueOnce(JSON.stringify({
      internal_id: 'int-001',
      sent_at: new Date().toISOString(),
    }))
    await runFlowDelete('刪掉剛剛那筆', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockKv.delete).toHaveBeenCalledWith('user:u1:last_place')
  })

  it('does not clear last_place KV when it points to different place', async () => {
    // second get returns different internal_id
    mockKv.get.mockResolvedValueOnce(JSON.stringify({
      internal_id: 'int-other',
      sent_at: new Date().toISOString(),
    }))
    await runFlowDelete('刪掉剛剛那筆', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockKv.delete).not.toHaveBeenCalledWith('user:u1:last_place')
  })

  it('reports error if archivePlace fails', async () => {
    mockArchive.mockRejectedValueOnce(new Error('Notion 500'))
    await runFlowDelete('刪掉剛剛那筆', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('遇到狀況') }),
    ]), 'test-token', 'chat1')
  })
})

describe('runFlowDelete — target last, anchor stale (> 5 min)', () => {
  it('treats stale anchor as missing and asks user', async () => {
    mockParse.mockResolvedValueOnce({ target: 'last' })
    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    mockKv.get.mockResolvedValueOnce(JSON.stringify({ internal_id: 'int-001', sent_at: staleTime }))

    await runFlowDelete('重做', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockArchive).not.toHaveBeenCalled()
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('找不到剛剛') }),
    ]), 'test-token', 'chat1')
  })
})

// ---------------------------------------------------------------------------
// runFlowDelete — target: named place (confirmation required)
// ---------------------------------------------------------------------------

describe('runFlowDelete — target named, 0 results', () => {
  it('replies not found', async () => {
    mockParse.mockResolvedValueOnce({ target: '神秘地點' })
    mockSearch.mockResolvedValueOnce([])
    await runFlowDelete('刪掉神秘地點', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('神秘地點') }),
    ]), 'test-token', 'chat1')
    expect(mockArchive).not.toHaveBeenCalled()
  })
})

describe('runFlowDelete — target named, 1 result', () => {
  it('shows confirmation card with visit count', async () => {
    mockParse.mockResolvedValueOnce({ target: '大湖公園' })
    mockSearch.mockResolvedValueOnce([makeSamplePlace() as never])
    mockQueryVisits.mockResolvedValueOnce({ visit_count: 3, last_visited: '2026-01-01', avg_rating: null })
    await runFlowDelete('刪掉大湖公園', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockBuildConfirm).toHaveBeenCalledWith('大湖公園', 'page-aaa', 3)
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('shows 0 visits when queryVisitsForPlace fails', async () => {
    mockParse.mockResolvedValueOnce({ target: '大湖公園' })
    mockSearch.mockResolvedValueOnce([makeSamplePlace() as never])
    mockQueryVisits.mockRejectedValueOnce(new Error('Notion down'))
    await runFlowDelete('刪掉大湖公園', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockBuildConfirm).toHaveBeenCalledWith('大湖公園', 'page-aaa', 0)
  })
})

describe('runFlowDelete — target named, multiple results', () => {
  it('sends disambiguation card', async () => {
    mockParse.mockResolvedValueOnce({ target: '動物園' })
    mockSearch.mockResolvedValueOnce([
      makeSamplePlace({ name: '台北市立動物園', notion_page_id: 'page-bbb' }),
      makeSamplePlace({ name: '兒童動物園', notion_page_id: 'page-ccc' }),
    ] as never[])
    await runFlowDelete('刪掉動物園', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockArchive).not.toHaveBeenCalled()
    expect(mockBuildConfirm).not.toHaveBeenCalled()
  })

  it('handles searchPlaces failure gracefully', async () => {
    mockParse.mockResolvedValueOnce({ target: '大湖公園' })
    mockSearch.mockRejectedValueOnce(new Error('Notion down'))
    await runFlowDelete('刪掉大湖公園', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('狀況') }),
    ]), 'test-token', 'chat1')
  })
})

// ---------------------------------------------------------------------------
// runFlowDeleteSelect — disambiguation → confirmation card
// ---------------------------------------------------------------------------

describe('runFlowDeleteSelect', () => {
  it('shows confirmation card for selected place', async () => {
    mockGetPlace.mockResolvedValueOnce(makeSamplePlace() as never)
    mockQueryVisits.mockResolvedValueOnce({ visit_count: 2, last_visited: null, avg_rating: null })
    await runFlowDeleteSelect('page-aaa', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockBuildConfirm).toHaveBeenCalledWith('大湖公園', 'page-aaa', 2)
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('replies error when place not found', async () => {
    mockGetPlace.mockResolvedValueOnce(null)
    await runFlowDeleteSelect('missing-id', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('找不到') }),
    ]), 'test-token', 'chat1')
    expect(mockBuildConfirm).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// runFlowDeleteConfirm — confirmation postback → actual delete
// ---------------------------------------------------------------------------

describe('runFlowDeleteConfirm', () => {
  it('archives place and cleans up', async () => {
    mockGetPlace.mockResolvedValueOnce(makeSamplePlace() as never)
    await runFlowDeleteConfirm('page-aaa', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockArchive).toHaveBeenCalledWith('page-aaa', mockEnv)
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('✓ 已刪除') }),
    ]), 'test-token', 'chat1')
    expect(mockKv.delete).toHaveBeenCalledWith('dedup:gplace-001')
  })

  it('replies error when place not found', async () => {
    mockGetPlace.mockResolvedValueOnce(null)
    await runFlowDeleteConfirm('missing-id', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('找不到') }),
    ]), 'test-token', 'chat1')
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('does NOT delete visits (only archives place)', async () => {
    mockGetPlace.mockResolvedValueOnce(makeSamplePlace() as never)
    await runFlowDeleteConfirm('page-aaa', 'reply-token', mockEnv, 'u1', 'chat1')
    // archivePlace archives the place page only; visits DB is never touched
    expect(mockArchive).toHaveBeenCalledTimes(1)
    expect(mockArchive).toHaveBeenCalledWith('page-aaa', mockEnv)
  })
})

// ---------------------------------------------------------------------------
// runFlowDeleteCancel — cancel postback
// ---------------------------------------------------------------------------

describe('runFlowDeleteCancel', () => {
  it('replies 好，沒刪 without archiving', async () => {
    await runFlowDeleteCancel('page-aaa', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: '好，沒刪。' }),
    ]), 'test-token', 'chat1')
    expect(mockArchive).not.toHaveBeenCalled()
  })
})
