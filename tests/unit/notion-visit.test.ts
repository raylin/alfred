import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

const mockKv = { get: vi.fn(), put: vi.fn() }

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function notionOk(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function notionErr(status: number, text = 'error') {
  return { ok: false, status, text: () => Promise.resolve(text) }
}

function makePage(id: string, props: Record<string, unknown> = {}) {
  return {
    id,
    url: `https://notion.so/${id}`,
    properties: {
      'Name': { type: 'title', title: [{ plain_text: '測試地點' }] },
      'Internal ID': { type: 'rich_text', rich_text: [{ plain_text: 'int-001' }] },
      ...props,
    },
  }
}

const mockEnv = {
  NOTION_TOKEN: 'test-token',
  NOTION_DB_ID: 'places-db-id',
  NOTION_PARENT_PAGE_ID: 'parent-page-id',
  ALFRED_KV: mockKv,
} as unknown as Env

beforeEach(() => {
  vi.resetAllMocks()  // clears Once queues so no bleed between tests
  mockKv.get.mockResolvedValue(null)
  mockKv.put.mockResolvedValue(undefined)
})

import {
  createVisit,
  queryVisitsForPlace,
  patchVisitRating,
  patchPlaceSummary,
  getPlaceByNotionPageId,
} from '../../src/integrations/notion'

// discoverDbIds scans parent page blocks — all three DBs must be present
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

describe('createVisit', () => {
  it('posts to /pages with correct Visits DB parent and properties', async () => {
    mockDiscoverIds()
    mockFetch.mockResolvedValueOnce(notionOk(makePage('visit-page-001')))

    const result = await createVisit({
      place_notion_page_id: 'place-page-aaa',
      place_name: '大湖公園',
      visited_on: '2026-05-04',
      rating: 4,
      notes: '很好玩',
      logged_by: 'u1',
    }, mockEnv)

    expect(result.notion_page_id).toBe('visit-page-001')
    const call = mockFetch.mock.calls.find(c => (c[0] as string).includes('/pages') && c[1]?.method === 'POST')
    const body = JSON.parse(call![1]!.body as string)
    expect(body.parent.database_id).toBe('visits-db-id')
    expect(body.properties['Title'].title[0].text.content).toContain('大湖公園')
    expect(body.properties['Place'].relation[0].id).toBe('place-page-aaa')
    expect(body.properties['Visited On'].date.start).toBe('2026-05-04')
    expect(body.properties['Rating'].number).toBe(4)
  })

  it('defaults visited_on to today when null', async () => {
    mockDiscoverIds()
    mockFetch.mockResolvedValueOnce(notionOk(makePage('visit-page-002')))

    await createVisit({
      place_notion_page_id: 'place-page-aaa',
      place_name: '大湖公園',
      visited_on: null,
      rating: null,
      notes: null,
      logged_by: null,
    }, mockEnv)

    const call = mockFetch.mock.calls.find(c => (c[0] as string).includes('/pages') && c[1]?.method === 'POST')
    const body = JSON.parse(call![1]!.body as string)
    const today = new Date().toISOString().slice(0, 10)
    expect(body.properties['Visited On'].date.start).toBe(today)
  })

  it('omits optional properties when null', async () => {
    mockDiscoverIds()
    mockFetch.mockResolvedValueOnce(notionOk(makePage('visit-page-003')))

    await createVisit({
      place_notion_page_id: 'place-page-aaa',
      place_name: '大湖公園',
      visited_on: '2026-05-04',
      rating: null,
      notes: null,
      logged_by: null,
    }, mockEnv)

    const call = mockFetch.mock.calls.find(c => (c[0] as string).includes('/pages') && c[1]?.method === 'POST')
    const body = JSON.parse(call![1]!.body as string)
    expect(body.properties['Rating']).toBeUndefined()
    expect(body.properties['Notes']).toBeUndefined()
  })
})

describe('queryVisitsForPlace', () => {
  it('computes summary from visit pages', async () => {
    mockDiscoverIds()
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [
        makePage('v1', { 'Visited On': { type: 'date', date: { start: '2026-05-04' } }, 'Rating': { type: 'number', number: 5 } }),
        makePage('v2', { 'Visited On': { type: 'date', date: { start: '2026-04-10' } }, 'Rating': { type: 'number', number: 3 } }),
        makePage('v3', { 'Visited On': { type: 'date', date: { start: '2026-03-01' } }, 'Rating': { type: 'number', number: null } }),
      ],
      has_more: false,
      next_cursor: null,
    }))

    const result = await queryVisitsForPlace('place-page-aaa', mockEnv)
    expect(result.visit_count).toBe(3)
    expect(result.last_visited).toBe('2026-05-04')
    expect(result.avg_rating).toBe(4)  // (5+3)/2 = 4
  })

  it('returns zero-state when no visits', async () => {
    mockDiscoverIds()
    mockFetch.mockResolvedValueOnce(notionOk({ results: [], has_more: false, next_cursor: null }))

    const result = await queryVisitsForPlace('place-page-aaa', mockEnv)
    expect(result).toEqual({ last_visited: null, visit_count: 0, avg_rating: null })
  })

  it('rounds avg_rating to 1 decimal', async () => {
    mockDiscoverIds()
    mockFetch.mockResolvedValueOnce(notionOk({
      results: [
        makePage('v1', { 'Visited On': { type: 'date', date: { start: '2026-05-04' } }, 'Rating': { type: 'number', number: 4 } }),
        makePage('v2', { 'Visited On': { type: 'date', date: { start: '2026-04-01' } }, 'Rating': { type: 'number', number: 5 } }),
        makePage('v3', { 'Visited On': { type: 'date', date: { start: '2026-03-01' } }, 'Rating': { type: 'number', number: 3 } }),
      ],
      has_more: false,
      next_cursor: null,
    }))

    const result = await queryVisitsForPlace('place-page-aaa', mockEnv)
    expect(result.avg_rating).toBe(4)  // (4+5+3)/3 = 4.0
  })
})

describe('patchVisitRating', () => {
  it('PATCHes the visit page Rating property', async () => {
    mockFetch.mockResolvedValueOnce(notionOk(makePage('visit-page-001')))
    await patchVisitRating('visit-page-001', 5, mockEnv)
    const call = mockFetch.mock.calls[0]
    expect(call[0]).toContain('/pages/visit-page-001')
    expect(call[1]?.method).toBe('PATCH')
    const body = JSON.parse(call[1]!.body as string)
    expect(body.properties['Rating'].number).toBe(5)
  })
})

describe('patchPlaceSummary', () => {
  it('PATCHes place with visit count and last_visited', async () => {
    mockFetch.mockResolvedValueOnce(notionOk(makePage('place-page-aaa')))
    await patchPlaceSummary('place-page-aaa', {
      last_visited: '2026-05-04',
      visit_count: 3,
      avg_rating: 4.3,
    }, mockEnv)
    const call = mockFetch.mock.calls[0]
    const body = JSON.parse(call[1]!.body as string)
    expect(body.properties['Visit Count'].number).toBe(3)
    expect(body.properties['Last Visited'].date.start).toBe('2026-05-04')
    expect(body.properties['Avg Rating'].number).toBe(4.3)
  })

  it('omits Last Visited and Avg Rating when null', async () => {
    mockFetch.mockResolvedValueOnce(notionOk(makePage('place-page-aaa')))
    await patchPlaceSummary('place-page-aaa', {
      last_visited: null,
      visit_count: 0,
      avg_rating: null,
    }, mockEnv)
    const body = JSON.parse(mockFetch.mock.calls[0][1]!.body as string)
    expect(body.properties['Last Visited']).toBeUndefined()
    expect(body.properties['Avg Rating']).toBeUndefined()
  })
})

describe('getPlaceByNotionPageId', () => {
  it('returns a Place when page found', async () => {
    mockFetch.mockResolvedValueOnce(notionOk(makePage('place-page-aaa')))
    const place = await getPlaceByNotionPageId('place-page-aaa', mockEnv)
    expect(place).not.toBeNull()
    expect(place!.notion_page_id).toBe('place-page-aaa')
  })

  it('returns null on Notion error', async () => {
    mockFetch.mockResolvedValueOnce(notionErr(404, 'not found'))
    const place = await getPlaceByNotionPageId('missing-id', mockEnv)
    expect(place).toBeNull()
  })
})
