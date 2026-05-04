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

import { runFlowE } from '../../src/capabilities/places/flow-e-search'
import { PlacesError } from '../../src/capabilities/places/errors'
import { parseSearchIntent } from '../../src/capabilities/places/search-parser'
import { searchPlaces } from '../../src/integrations/notion'
import { sendReply } from '../../src/integrations/line'
import { SAMPLE_PLACE } from '../fixtures/places'

const mockParse = vi.mocked(parseSearchIntent)
const mockSearch = vi.mocked(searchPlaces)
const mockReply = vi.mocked(sendReply)

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
