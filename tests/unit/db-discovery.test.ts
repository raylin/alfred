import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Env } from '../../src/core/env'

vi.mock('../../src/integrations/notion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/notion')>()
  return { ...actual }
})

import { discoverDbIds } from '../../src/integrations/notion'

const PLACE_DB_ID  = 'aaa111'
const VISITS_DB_ID = 'bbb222'
const SETTINGS_DB_ID = 'ccc333'

function makeBlocksResponse(entries: Array<{ title: string; id: string }>, hasMore = false) {
  return {
    results: entries.map(e => ({
      type: 'child_database',
      id: e.id,
      child_database: { title: e.title },
    })),
    has_more: hasMore,
    next_cursor: null,
  }
}

const ALL_DBS = [
  { title: 'Alfred — 親子景點', id: PLACE_DB_ID },
  { title: 'Visits',            id: VISITS_DB_ID },
  { title: 'Settings',          id: SETTINGS_DB_ID },
  { title: 'Migrations',        id: 'mig999' },  // should be ignored
]

function makeMockEnv(kvGetValue: string | null): Env {
  return {
    NOTION_TOKEN: 'test-token',
    NOTION_PARENT_PAGE_ID: 'parent-page-id',
    NOTION_DB_ID: PLACE_DB_ID,
    ALFRED_KV: {
      get: vi.fn().mockResolvedValue(kvGetValue),
      put: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Env
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('discoverDbIds', () => {
  it('returns all three DB IDs on KV cache miss, then caches result', async () => {
    const env = makeMockEnv(null)
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(makeBlocksResponse(ALL_DBS)), { status: 200 }),
    )

    const ids = await discoverDbIds(env)

    expect(ids.places).toBe(PLACE_DB_ID)
    expect(ids.visits).toBe(VISITS_DB_ID)
    expect(ids.settings).toBe(SETTINGS_DB_ID)

    const kvPut = (env.ALFRED_KV as unknown as { put: ReturnType<typeof vi.fn> }).put
    expect(kvPut).toHaveBeenCalledWith(
      'system:db_ids',
      JSON.stringify(ids),
      { expirationTtl: 86400 },
    )
  })

  it('returns cached IDs without calling fetch on KV hit', async () => {
    const cached = JSON.stringify({ places: PLACE_DB_ID, visits: VISITS_DB_ID, settings: SETTINGS_DB_ID })
    const env = makeMockEnv(cached)

    const ids = await discoverDbIds(env)

    expect(ids.places).toBe(PLACE_DB_ID)
    expect(ids.visits).toBe(VISITS_DB_ID)
    expect(ids.settings).toBe(SETTINGS_DB_ID)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws when a DB is missing from the parent page', async () => {
    const env = makeMockEnv(null)
    // Only return Places DB, missing Visits and Settings
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify(makeBlocksResponse([{ title: 'Alfred — 親子景點', id: PLACE_DB_ID }])),
        { status: 200 },
      ),
    )

    await expect(discoverDbIds(env)).rejects.toThrow('visits')
  })

  it('throws on Notion API error', async () => {
    const env = makeMockEnv(null)
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    )

    await expect(discoverDbIds(env)).rejects.toThrow('401')
  })

  it('passes correct Authorization and Notion-Version headers', async () => {
    const env = makeMockEnv(null)
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(makeBlocksResponse(ALL_DBS)), { status: 200 }),
    )

    await discoverDbIds(env)

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('parent-page-id')
    const hdrs = init.headers as Record<string, string>
    expect(hdrs['Authorization']).toBe('Bearer test-token')
    expect(hdrs['Notion-Version']).toBe('2022-06-28')
  })
})
