import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/capabilities/places/search-parser', () => ({
  parseSearchIntent: vi.fn(),
}))
vi.mock('../../src/integrations/notion', () => ({
  searchPlaces: vi.fn(),
}))
vi.mock('../../src/integrations/line', () => ({
  sendReply: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/capabilities/places/home-store', () => ({
  getEffectiveOrigin: vi.fn(),
}))
vi.mock('../../src/integrations/routes-api', () => ({
  computeRouteMatrix: vi.fn(),
}))

import { runFlowE } from '../../src/capabilities/places/flow-e-search'
import { PlacesError } from '../../src/capabilities/places/errors'
import { parseSearchIntent } from '../../src/capabilities/places/search-parser'
import { searchPlaces } from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'
import { getEffectiveOrigin } from '../../src/capabilities/places/home-store'
import { computeRouteMatrix } from '../../src/integrations/routes-api'
import { SAMPLE_PLACE } from '../fixtures/places'

const mockParse = vi.mocked(parseSearchIntent)
const mockSearch = vi.mocked(searchPlaces)
const mockReply = vi.mocked(sendReply)
const mockGetOrigin = vi.mocked(getEffectiveOrigin)
const mockRouteMatrix = vi.mocked(computeRouteMatrix)

const mockEnv = {
  ANTHROPIC_API_KEY: 'test',
  NOTION_TOKEN: 'test',
  NOTION_DB_ID: 'test',
  LINE_CHANNEL_ACCESS_TOKEN: 'test',
} as unknown as Env

const DEFAULT_INTENT = {
  filters: { indoor_outdoor: null, age: null, region: null, categories: null, seasons: null, fee_type: null, energy_level: null, free_text_keywords: [] },
  query_intent_summary: '室內三歲景點',
}

function makePlaces(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...SAMPLE_PLACE,
    internal_id: `id-${i}`,
    name: `地點 ${i}`,
    notion_page_id: `page-${i}`,
    notion_url: `https://www.notion.so/page-${i}`,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockParse.mockResolvedValue(DEFAULT_INTENT)
  mockSearch.mockResolvedValue([SAMPLE_PLACE])
  mockGetOrigin.mockResolvedValue({ source: null })
  mockRouteMatrix.mockResolvedValue([])
})

describe('runFlowE — 0 results', () => {
  it('sends no-results text message', async () => {
    mockSearch.mockResolvedValue([])

    await runFlowE('下雨天哪裡好', 'reply-token', mockEnv)

    expect(mockReply).toHaveBeenCalledOnce()
    const messages = mockReply.mock.calls[0][1]
    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('text')
    expect((messages[0] as { text: string }).text).toContain('沒有完全符合')
  })
})

describe('runFlowE — results found', () => {
  it('sends text header + carousel for 1-10 results', async () => {
    mockSearch.mockResolvedValue(makePlaces(3))

    await runFlowE('台北親子景點', 'reply-token', mockEnv)

    const messages = mockReply.mock.calls[0][1]
    expect(messages).toHaveLength(2)
    expect(messages[0].type).toBe('text')
    expect(messages[1].type).toBe('flex')
  })

  it('carousel contents is type carousel', async () => {
    mockSearch.mockResolvedValue(makePlaces(3))

    await runFlowE('台北親子景點', 'reply-token', mockEnv)

    const carousel = mockReply.mock.calls[0][1][1] as unknown as { contents: { type: string } }
    expect(carousel.contents.type).toBe('carousel')
  })

  it('includes intent summary in header for <= 10 results', async () => {
    mockSearch.mockResolvedValue(makePlaces(5))

    await runFlowE('台北親子景點', 'reply-token', mockEnv)

    const header = mockReply.mock.calls[0][1][0] as { text: string }
    expect(header.text).toContain('室內三歲景點')
  })

  it('shows narrow hint when > 10 candidates', async () => {
    mockSearch.mockResolvedValue(makePlaces(15))

    await runFlowE('台北親子景點', 'reply-token', mockEnv)

    const header = mockReply.mock.calls[0][1][0] as { text: string }
    expect(header.text).toContain('縮小範圍')
  })

  it('caps display at 5 even when more results', async () => {
    mockSearch.mockResolvedValue(makePlaces(15))

    await runFlowE('台北親子景點', 'reply-token', mockEnv)

    const carousel = mockReply.mock.calls[0][1][1] as unknown as { contents: { contents: unknown[] } }
    expect(carousel.contents.contents).toHaveLength(5)
  })

  it('re-ranks by keyword hit when free_text_keywords present', async () => {
    const placeWithKeyword = { ...SAMPLE_PLACE, name: '滑水道樂園', summary: '有滑水道設施', internal_id: 'kw-match' }
    const placeNoKeyword = { ...SAMPLE_PLACE, name: '一般公園', summary: '普通景點', internal_id: 'no-match' }
    mockParse.mockResolvedValue({
      ...DEFAULT_INTENT,
      filters: { ...DEFAULT_INTENT.filters, free_text_keywords: ['滑水道'] },
    })
    mockSearch.mockResolvedValue([placeNoKeyword, placeWithKeyword])

    await runFlowE('有滑水道的地方', 'reply-token', mockEnv)

    const carousel = mockReply.mock.calls[0][1][1] as unknown as { contents: { contents: Array<{ body: { contents: Array<{ text: string }> } }> } }
    const firstName = carousel.contents.contents[0].body.contents[0].text
    expect(firstName).toBe('滑水道樂園')
  })
})

describe('runFlowE — error handling', () => {
  it('throws PlacesError when parseSearchIntent fails', async () => {
    mockParse.mockRejectedValue(new Error('Haiku down'))

    const err = await runFlowE('測試', 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('解析搜尋條件')
  })

  it('throws PlacesError when searchPlaces fails', async () => {
    mockSearch.mockRejectedValue(new Error('Notion error'))

    const err = await runFlowE('測試', 'reply-token', mockEnv).catch(e => e)
    expect(err).toBeInstanceOf(PlacesError)
    expect(err.userMessage).toContain('搜尋時遇到狀況')
  })
})

describe('runFlowE — distance display', () => {
  const placeWithCoords = {
    ...SAMPLE_PLACE,
    latitude: 25.08,
    longitude: 121.56,
    internal_id: 'coord-place',
    notion_page_id: 'page-coord',
    notion_url: 'https://www.notion.so/page-coord',
  }

  it('passes distance to carousel when origin and coords are available', async () => {
    mockSearch.mockResolvedValue([placeWithCoords])
    mockGetOrigin.mockResolvedValue({ lat: 25.05, lng: 121.52, source: 'home' })
    mockRouteMatrix.mockResolvedValue([{ driving: { duration_minutes: 15, distance_meters: 3000 }, transit: null }])

    await runFlowE('台北景點', 'reply-token', mockEnv, 'U001')

    const carousel = mockReply.mock.calls[0][1][1] as unknown as { contents: unknown }
    expect(JSON.stringify(carousel.contents)).toContain('🚗')
    expect(JSON.stringify(carousel.contents)).toContain('15 分')
  })

  it('skips distance when userId is not provided', async () => {
    mockSearch.mockResolvedValue([placeWithCoords])

    await runFlowE('台北景點', 'reply-token', mockEnv)

    expect(mockGetOrigin).not.toHaveBeenCalled()
    expect(mockRouteMatrix).not.toHaveBeenCalled()
    const carousel = mockReply.mock.calls[0][1][1] as unknown as { contents: unknown }
    expect(JSON.stringify(carousel.contents)).not.toContain('🚗')
  })

  it('skips distance when effective origin is null', async () => {
    mockSearch.mockResolvedValue([placeWithCoords])
    mockGetOrigin.mockResolvedValue({ source: null })

    await runFlowE('台北景點', 'reply-token', mockEnv, 'U001')

    expect(mockRouteMatrix).not.toHaveBeenCalled()
  })

  it('does not throw when distance computation fails', async () => {
    mockSearch.mockResolvedValue([placeWithCoords])
    mockGetOrigin.mockResolvedValue({ lat: 25.05, lng: 121.52, source: 'home' })
    mockRouteMatrix.mockRejectedValue(new Error('routes API down'))

    await expect(runFlowE('台北景點', 'reply-token', mockEnv, 'U001')).resolves.toBeUndefined()
    expect(mockReply).toHaveBeenCalledOnce()
  })
})

describe('runFlowE — distance tie-breaking (ADR-023)', () => {
  const makePlaceWithCoords = (id: string, lat: number, lng: number, name: string) => ({
    ...SAMPLE_PLACE,
    internal_id: id,
    name,
    latitude: lat,
    longitude: lng,
    notion_page_id: `page-${id}`,
    notion_url: `https://www.notion.so/page-${id}`,
  })

  it('sorts by distance when keyword scores are equal', async () => {
    const far   = makePlaceWithCoords('far',  25.2, 121.8, '遠的地點')
    const close = makePlaceWithCoords('near', 25.1, 121.6, '近的地點')
    mockSearch.mockResolvedValue([far, close])
    mockGetOrigin.mockResolvedValue({ lat: 25.05, lng: 121.52, source: 'home' })
    // computeRouteMatrix called with [far, close] in that order (no keyword rerank)
    mockRouteMatrix.mockResolvedValue([
      { driving: { duration_minutes: 40, distance_meters: 20000 }, transit: null },
      { driving: { duration_minutes: 15, distance_meters: 5000 }, transit: null },
    ])

    await runFlowE('台北景點', 'reply-token', mockEnv, 'U001')

    const carousel = mockReply.mock.calls[0][1][1] as unknown as { contents: { contents: Array<{ body: { contents: Array<{ text: string }> } }> } }
    const firstName = carousel.contents.contents[0].body.contents[0].text
    expect(firstName).toBe('近的地點')
  })

  it('preserves keyword score ordering when scores differ', async () => {
    const highScore = { ...makePlaceWithCoords('hs', 25.2, 121.8, '滑水道樂園'), summary: '有滑水道設施' }
    const lowScore  = makePlaceWithCoords('ls', 25.1, 121.6, '一般公園')
    mockParse.mockResolvedValue({
      ...DEFAULT_INTENT,
      filters: { ...DEFAULT_INTENT.filters, free_text_keywords: ['滑水道'] },
    })
    mockSearch.mockResolvedValue([lowScore, highScore])
    mockGetOrigin.mockResolvedValue({ lat: 25.05, lng: 121.52, source: 'home' })
    // After keyword sort, highScore is [0], lowScore is [1]
    mockRouteMatrix.mockResolvedValue([
      { driving: { duration_minutes: 40, distance_meters: 20000 }, transit: null },
      { driving: { duration_minutes: 5, distance_meters: 1000 }, transit: null },
    ])

    await runFlowE('有滑水道', 'reply-token', mockEnv, 'U001')

    const carousel = mockReply.mock.calls[0][1][1] as unknown as { contents: { contents: Array<{ body: { contents: Array<{ text: string }> } }> } }
    const firstName = carousel.contents.contents[0].body.contents[0].text
    expect(firstName).toBe('滑水道樂園')
  })
})
