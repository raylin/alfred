import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/capabilities/places/visit-parser', () => ({
  parseVisitMessage: vi.fn(),
}))
vi.mock('../../src/capabilities/places/visit-summary', () => ({
  recomputePlaceSummary: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/capabilities/places/disambiguate', () => ({
  buildDisambiguateCard: vi.fn().mockReturnValue({ type: 'flex', altText: 'disambig', contents: {} }),
}))
vi.mock('../../src/capabilities/places/flex-message', () => ({
  buildVisitCard: vi.fn().mockReturnValue({ type: 'flex', altText: 'visit', contents: {} }),
}))
vi.mock('../../src/integrations/notion', () => ({
  createVisit: vi.fn(),
  searchPlaces: vi.fn(),
  getPlaceByNotionPageId: vi.fn(),
  findPlaceByInternalId: vi.fn(),
}))
vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/capabilities/places/kv-store', () => ({
  writePendingRating: vi.fn().mockResolvedValue(undefined),
  writePendingVisit: vi.fn().mockResolvedValue(undefined),
  readPendingVisit: vi.fn().mockResolvedValue(null),
  clearPendingVisit: vi.fn().mockResolvedValue(undefined),
}))

import { runFlowVisit, runFlowVisitSelect } from '../../src/capabilities/places/flow-visit'
import { parseVisitMessage } from '../../src/capabilities/places/visit-parser'
import { recomputePlaceSummary } from '../../src/capabilities/places/visit-summary'
import { createVisit, searchPlaces, getPlaceByNotionPageId, findPlaceByInternalId } from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'
import { writePendingRating, writePendingVisit, readPendingVisit, clearPendingVisit } from '../../src/capabilities/places/kv-store'

const mockParse = vi.mocked(parseVisitMessage)
const mockSearch = vi.mocked(searchPlaces)
const mockCreate = vi.mocked(createVisit)
const mockGetPlace = vi.mocked(getPlaceByNotionPageId)
const mockFindByInternal = vi.mocked(findPlaceByInternalId)
const mockReply = vi.mocked(sendReply)
const mockRecompute = vi.mocked(recomputePlaceSummary)
const mockWritePendingRating = vi.mocked(writePendingRating)
const mockWritePendingVisit = vi.mocked(writePendingVisit)
const mockReadPendingVisit = vi.mocked(readPendingVisit)
const mockClearPendingVisit = vi.mocked(clearPendingVisit)

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
const mockEnv = {
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
  ALFRED_KV: mockKv,
} as unknown as Env

function makeSamplePlace(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: '大湖公園',
    notion_page_id: 'place-page-aaa',
    internal_id: 'int-001',
    summary: '',
    categories: [],
    seasons: [],
    ai_inferred_fields: [],
    source_type: [],
    indoor_outdoor: null,
    address: null,
    region: null,
    longitude: null,
    latitude: null,
    google_place_id: null,
    age_min: null, age_max: null,
    stroller_friendly: null, parking_friendly: null,
    has_restroom: null, has_nursing_room: null,
    energy_level: null, stay_minutes: null,
    reservation_needed: null, crowded_on_weekends: null,
    fee_type: null, fee_details: null,
    source_url: null, created_by: null,
    notion_url: null, status: 'draft',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({ notion_page_id: 'visit-page-001' })
  mockKv.get.mockResolvedValue(null)
})

describe('runFlowVisit — place_query null', () => {
  it('asks for place name when parser returns null', async () => {
    mockParse.mockResolvedValueOnce({ place_query: null, visited_on: null, rating_signal: null, notes: null })
    await runFlowVisit('去玩了', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('地點名稱') }),
    ]), 'test-token', 'chat1')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('runFlowVisit — place_query "last"', () => {
  it('resolves last place from KV and creates visit', async () => {
    mockParse.mockResolvedValueOnce({ place_query: 'last', visited_on: '2026-05-04', rating_signal: null, notes: null })
    mockKv.get.mockResolvedValueOnce(JSON.stringify({
      internal_id: 'int-001',
      sent_at: new Date().toISOString(),
      chat_id: 'chat1',
    }))
    mockFindByInternal.mockResolvedValueOnce(makeSamplePlace() as never)

    await runFlowVisit('上次去的那個', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      place_notion_page_id: 'place-page-aaa',
      visited_on: '2026-05-04',
    }), mockEnv)
    expect(mockRecompute).toHaveBeenCalled()
  })

  it('asks for place name when last_place KV is missing', async () => {
    mockParse.mockResolvedValueOnce({ place_query: 'last', visited_on: null, rating_signal: null, notes: null })
    mockKv.get.mockResolvedValueOnce(null)

    await runFlowVisit('上次那個', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('地點名稱') }),
    ]), 'test-token', 'chat1')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('runFlowVisit — string place_query', () => {
  it('creates visit when exactly 1 candidate found', async () => {
    mockParse.mockResolvedValueOnce({ place_query: '大湖公園', visited_on: '2026-05-04', rating_signal: 5, notes: null })
    mockSearch.mockResolvedValueOnce([makeSamplePlace() as never])

    await runFlowVisit('今天去了大湖公園 5星', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      place_notion_page_id: 'place-page-aaa',
      rating: 5,
    }), mockEnv)
    expect(mockRecompute).toHaveBeenCalledWith('place-page-aaa', mockEnv)
  })

  it('sets pending_rating when rating_signal is null', async () => {
    mockParse.mockResolvedValueOnce({ place_query: '大湖公園', visited_on: null, rating_signal: null, notes: null })
    mockSearch.mockResolvedValueOnce([makeSamplePlace() as never])

    await runFlowVisit('今天去了大湖公園', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockWritePendingRating).toHaveBeenCalledWith(mockEnv, 'u1', expect.objectContaining({
      visit_notion_page_id: 'visit-page-001',
      place_notion_page_id: 'place-page-aaa',
      place_name: '大湖公園',
    }))
  })

  it('does not set pending_rating when rating_signal is provided', async () => {
    mockParse.mockResolvedValueOnce({ place_query: '大湖公園', visited_on: null, rating_signal: 4, notes: null })
    mockSearch.mockResolvedValueOnce([makeSamplePlace() as never])

    await runFlowVisit('大湖公園 4星', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockWritePendingRating).not.toHaveBeenCalled()
  })

  it('sends disambiguation card when multiple candidates found', async () => {
    mockParse.mockResolvedValueOnce({ place_query: '大湖', visited_on: null, rating_signal: null, notes: null })
    mockSearch.mockResolvedValueOnce([makeSamplePlace(), makeSamplePlace({ name: '大湖農場', notion_page_id: 'page-bbb' })] as never[])

    await runFlowVisit('去了大湖', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockWritePendingVisit).toHaveBeenCalledWith(mockEnv, 'u1', { visited_on: null, rating_signal: null, notes: null })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('replies asking to add when 0 candidates found', async () => {
    mockParse.mockResolvedValueOnce({ place_query: '神秘地點', visited_on: null, rating_signal: null, notes: null })
    mockSearch.mockResolvedValueOnce([])

    await runFlowVisit('去了神秘地點', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('神秘地點') }),
    ]), 'test-token', 'chat1')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('handles searchPlaces failure gracefully', async () => {
    mockParse.mockResolvedValueOnce({ place_query: '大湖公園', visited_on: null, rating_signal: null, notes: null })
    mockSearch.mockRejectedValueOnce(new Error('Notion down'))

    await runFlowVisit('去了大湖公園', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('狀況') }),
    ]), 'test-token', 'chat1')
  })

  it('handles createVisit failure gracefully', async () => {
    mockParse.mockResolvedValueOnce({ place_query: '大湖公園', visited_on: null, rating_signal: null, notes: null })
    mockSearch.mockResolvedValueOnce([makeSamplePlace() as never])
    mockCreate.mockRejectedValueOnce(new Error('Notion error'))

    await runFlowVisit('去了大湖公園', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('記錄時遇到狀況') }),
    ]), 'test-token', 'chat1')
  })
})

describe('runFlowVisitSelect', () => {
  it('looks up place by notion_page_id and creates visit', async () => {
    mockGetPlace.mockResolvedValueOnce(makeSamplePlace() as never)
    mockReadPendingVisit.mockResolvedValueOnce({ visited_on: '2026-05-03', rating_signal: 3, notes: '不錯' })

    await runFlowVisitSelect('place-page-aaa', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      place_notion_page_id: 'place-page-aaa',
      visited_on: '2026-05-03',
      rating: 3,
      notes: '不錯',
    }), mockEnv)
    expect(mockClearPendingVisit).toHaveBeenCalledWith(mockEnv, 'u1')
  })

  it('uses today and null rating when no pending_visit', async () => {
    mockGetPlace.mockResolvedValueOnce(makeSamplePlace() as never)
    mockReadPendingVisit.mockResolvedValueOnce(null)

    await runFlowVisitSelect('place-page-aaa', 'reply-token', mockEnv, 'u1', 'chat1')
    const today = new Date().toISOString().slice(0, 10)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      visited_on: today,
      rating: null,
    }), mockEnv)
  })

  it('replies with error when place not found', async () => {
    mockGetPlace.mockResolvedValueOnce(null)
    await runFlowVisitSelect('missing-page-id', 'reply-token', mockEnv, 'u1', 'chat1')
    expect(mockReply).toHaveBeenCalledWith('reply-token', expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('找不到') }),
    ]), 'test-token', 'chat1')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
