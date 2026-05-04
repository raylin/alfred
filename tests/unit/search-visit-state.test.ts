import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function notionOk(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

const mockKv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
const mockEnv = {
  NOTION_TOKEN: 'test-token',
  NOTION_DB_ID: 'places-db-id',
  NOTION_PARENT_PAGE_ID: 'parent-page-id',
  ALFRED_KV: mockKv,
} as unknown as Env

function mockDiscoverIds() {
  mockFetch.mockResolvedValueOnce(notionOk({
    results: [
      { type: 'child_database', id: 'places-db-id', child_database: { title: 'Alfred — 親子景點' } },
      { type: 'child_database', id: 'visits-db-id', child_database: { title: 'Visits' } },
      { type: 'child_database', id: 'settings-db-id', child_database: { title: 'Settings' } },
    ],
    has_more: false,
    next_cursor: null,
  }))
}

function makePlacePage(id: string, name: string) {
  return {
    id,
    url: `https://notion.so/${id}`,
    properties: {
      'Name': { type: 'title', title: [{ plain_text: name }] },
      'Status': { type: 'status', status: { name: 'confirmed' } },
      'Summary': { type: 'rich_text', rich_text: [{ plain_text: '' }] },
      'Categories': { type: 'multi_select', multi_select: [] },
      'Seasons': { type: 'multi_select', multi_select: [{ name: '全年' }] },
      'AI Inferred Fields': { type: 'multi_select', multi_select: [] },
      'Source Type': { type: 'multi_select', multi_select: [] },
      'Indoor/Outdoor': { type: 'select', select: null },
      'Region': { type: 'select', select: null },
      'Age Min': { type: 'number', number: null },
      'Age Max': { type: 'number', number: null },
      'Stay Minutes': { type: 'number', number: null },
      'Longitude': { type: 'number', number: null },
      'Latitude': { type: 'number', number: null },
      'Google Place ID': { type: 'rich_text', rich_text: [] },
      'Internal ID': { type: 'rich_text', rich_text: [{ plain_text: `int-${id}` }] },
      'Address': { type: 'rich_text', rich_text: [] },
      'Source URLs': { type: 'url', url: null },
      'Created By': { type: 'rich_text', rich_text: [] },
      'Stroller Friendly': { type: 'checkbox', checkbox: false },
      'Parking Friendly': { type: 'checkbox', checkbox: false },
      'Has Restroom': { type: 'checkbox', checkbox: false },
      'Has Nursing Room': { type: 'checkbox', checkbox: false },
      'Reservation Needed': { type: 'checkbox', checkbox: false },
      'Crowded On Weekends': { type: 'checkbox', checkbox: false },
      'Energy Level': { type: 'select', select: null },
      'Fee Type': { type: 'select', select: null },
      'Fee Details': { type: 'rich_text', rich_text: [] },
    },
  }
}

function makeVisitPage(placeId: string) {
  return {
    id: `visit-${placeId}`,
    url: `https://notion.so/visit-${placeId}`,
    properties: {
      'Place': { type: 'relation', relation: [{ id: placeId }] },
      'Rating': { type: 'number', number: 5 },
      'Visited On': { type: 'date', date: { start: new Date().toISOString().slice(0, 10) } },
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockKv.get.mockResolvedValue(null)
  mockKv.put.mockResolvedValue(undefined)
})

import { searchPlaces } from '../../src/integrations/notion'

describe('searchPlaces — loved_recently', () => {
  it('queries Visits DB then Places DB and returns matching places', async () => {
    mockDiscoverIds()  // discoverDbIds fetch

    // Step 1: Visits DB response — two Rating=5 visits for page-aaa and page-bbb
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [makeVisitPage('page-aaa'), makeVisitPage('page-bbb')],
      has_more: false,
      next_cursor: null,
    }))

    // Step 2: Places DB response — three places, two of which are loved
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [
        makePlacePage('page-aaa', '大湖公園'),
        makePlacePage('page-bbb', '動物園'),
        makePlacePage('page-ccc', '未愛過的地方'),
      ],
      has_more: false,
      next_cursor: null,
    }))

    const results = await searchPlaces({ visit_state: 'loved_recently' }, mockEnv, 5)
    expect(results).toHaveLength(2)
    expect(results.map(p => p.name)).toEqual(['大湖公園', '動物園'])
  })

  it('returns empty array when no loved visits in last 30 days', async () => {
    mockDiscoverIds()

    // Visits DB response — empty
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [],
      has_more: false,
      next_cursor: null,
    }))

    const results = await searchPlaces({ visit_state: 'loved_recently' }, mockEnv, 5)
    expect(results).toHaveLength(0)
    // Should NOT call Places DB when loved IDs is empty
    expect(mockFetch).toHaveBeenCalledTimes(2) // discoverDbIds + visits query only
  })

  it('applies limit to in-memory results', async () => {
    mockDiscoverIds()

    // Three loved places
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [makeVisitPage('page-aaa'), makeVisitPage('page-bbb'), makeVisitPage('page-ccc')],
      has_more: false,
      next_cursor: null,
    }))

    // Places DB returns all three
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [
        makePlacePage('page-aaa', '地點A'),
        makePlacePage('page-bbb', '地點B'),
        makePlacePage('page-ccc', '地點C'),
      ],
      has_more: false,
      next_cursor: null,
    }))

    const results = await searchPlaces({ visit_state: 'loved_recently' }, mockEnv, 2)
    expect(results).toHaveLength(2)
  })

  it('combines loved_recently with other filters in Places query', async () => {
    mockDiscoverIds()

    mockFetch.mockResolvedValueOnce(notionOk({
      results: [makeVisitPage('page-aaa')],
      has_more: false,
      next_cursor: null,
    }))

    mockFetch.mockResolvedValueOnce(notionOk({
      results: [makePlacePage('page-aaa', '大湖公園')],
      has_more: false,
      next_cursor: null,
    }))

    const results = await searchPlaces({ visit_state: 'loved_recently', region: '台北' }, mockEnv, 5)
    // The Places query should include the region filter
    const placesCall = mockFetch.mock.calls[2]  // calls: [0]=discoverIds, [1]=visits, [2]=places
    const body = JSON.parse(placesCall[1].body as string)
    expect(JSON.stringify(body.filter)).toContain('台北')
    expect(results).toHaveLength(1)
  })

  it('deduplicates place IDs from multiple visits to same place', async () => {
    mockDiscoverIds()

    // Two visits to same place
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [makeVisitPage('page-aaa'), makeVisitPage('page-aaa')],
      has_more: false,
      next_cursor: null,
    }))

    mockFetch.mockResolvedValueOnce(notionOk({
      results: [makePlacePage('page-aaa', '大湖公園')],
      has_more: false,
      next_cursor: null,
    }))

    const results = await searchPlaces({ visit_state: 'loved_recently' }, mockEnv, 5)
    expect(results).toHaveLength(1)
  })
})

describe('searchPlaces — non-loved_recently visit_state (no extra Visits query)', () => {
  it('never_visited does a single Places query', async () => {
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [makePlacePage('page-aaa', '新地點')],
      has_more: false,
      next_cursor: null,
    }))

    const results = await searchPlaces({ visit_state: 'never_visited' }, mockEnv, 5)
    expect(results).toHaveLength(1)
    // Only one fetch call (no discoverDbIds, no Visits query)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    // Filter should contain never_visited conditions
    expect(JSON.stringify(body.filter)).toContain('Visit Count')
    expect(JSON.stringify(body.filter)).toContain('is_empty')
  })

  it('highly_rated does a single Places query', async () => {
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [],
      has_more: false,
      next_cursor: null,
    }))

    await searchPlaces({ visit_state: 'highly_rated' }, mockEnv, 5)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(JSON.stringify(body.filter)).toContain('4.5')
    expect(JSON.stringify(body.filter)).toContain('Avg Rating')
  })
})
