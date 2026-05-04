import type { Env } from '../core/env'
import { N, type Place, type SearchFilters } from '../capabilities/places/schema'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

// --- Internal Notion response shapes (minimal) ---

type RichTextItem = { plain_text: string }
type SelectOption = { name: string }

type NotionPropValue = {
  type: string
  title?: RichTextItem[]
  rich_text?: RichTextItem[]
  select?: SelectOption | null
  multi_select?: SelectOption[]
  number?: number | null
  checkbox?: boolean
  url?: string | null
  status?: SelectOption | null
}

type NotionPage = {
  id: string
  url: string
  properties: Record<string, NotionPropValue>
}

type NotionQueryResponse = {
  results: NotionPage[]
  has_more: boolean
  next_cursor: string | null
}

// --- Helpers ---

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

async function notionPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${NOTION_API}${path}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Notion ${res.status} ${path}: ${text}`)
  }
  return res.json() as Promise<T>
}

function rt(content: string) {
  return [{ type: 'text', text: { content } }]
}

function ms(items: string[]) {
  return items.map(name => ({ name }))
}

// --- Property mapper: Place → Notion page properties ---

export function placeToNotionProperties(place: Place): Record<string, unknown> {
  const p: Record<string, unknown> = {
    [N.name]:               { title: rt(place.name) },
    [N.status]:             { status: { name: 'draft' } },
    [N.seasons]:            { multi_select: ms(place.seasons) },
    [N.ai_inferred_fields]: { multi_select: ms(place.ai_inferred_fields) },
    [N.internal_id]:        { rich_text: rt(place.internal_id) },
    [N.summary]:            { rich_text: rt(place.summary) },
  }

  if (place.categories.length > 0)  p[N.categories]  = { multi_select: ms(place.categories) }
  if (place.source_type.length > 0) p[N.source_type]  = { multi_select: ms(place.source_type) }

  if (place.indoor_outdoor    != null) p[N.indoor_outdoor]    = { select: { name: place.indoor_outdoor } }
  if (place.address           != null) p[N.address]           = { rich_text: rt(place.address) }
  if (place.region            != null) p[N.region]            = { select: { name: place.region } }
  if (place.longitude         != null) p[N.longitude]         = { number: place.longitude }
  if (place.latitude          != null) p[N.latitude]          = { number: place.latitude }
  if (place.google_place_id   != null) p[N.google_place_id]   = { rich_text: rt(place.google_place_id) }
  if (place.age_min           != null) p[N.age_min]           = { number: place.age_min }
  if (place.age_max           != null) p[N.age_max]           = { number: place.age_max }
  if (place.stroller_friendly != null) p[N.stroller_friendly] = { checkbox: place.stroller_friendly }
  if (place.parking_friendly  != null) p[N.parking_friendly]  = { checkbox: place.parking_friendly }
  if (place.has_restroom      != null) p[N.has_restroom]      = { checkbox: place.has_restroom }
  if (place.has_nursing_room  != null) p[N.has_nursing_room]  = { checkbox: place.has_nursing_room }
  if (place.energy_level      != null) p[N.energy_level]      = { select: { name: place.energy_level } }
  if (place.stay_minutes      != null) p[N.stay_minutes]      = { number: place.stay_minutes }
  if (place.reservation_needed   != null) p[N.reservation_needed]   = { checkbox: place.reservation_needed }
  if (place.crowded_on_weekends  != null) p[N.crowded_on_weekends]  = { checkbox: place.crowded_on_weekends }
  if (place.fee_type          != null) p[N.fee_type]          = { select: { name: place.fee_type } }
  if (place.fee_details       != null) p[N.fee_details]       = { rich_text: rt(place.fee_details) }
  if (place.source_url        != null) p[N.source_url]        = { url: place.source_url }
  if (place.created_by        != null) p[N.created_by]        = { rich_text: rt(place.created_by) }

  return p
}

// --- Property mapper: Notion page → Place ---

export function notionPageToPlace(page: NotionPage): Place {
  const prop = page.properties

  function text(key: string): string {
    const v = prop[key]
    if (!v) return ''
    if (v.type === 'title')      return v.title?.[0]?.plain_text ?? ''
    if (v.type === 'rich_text')  return v.rich_text?.[0]?.plain_text ?? ''
    return ''
  }

  function select(key: string): string | null {
    return prop[key]?.select?.name ?? null
  }

  function multiSelect(key: string): string[] {
    return prop[key]?.multi_select?.map(o => o.name) ?? []
  }

  function num(key: string): number | null {
    return prop[key]?.number ?? null
  }

  function checkbox(key: string): boolean | null {
    const v = prop[key]
    if (!v || v.type !== 'checkbox') return null
    return v.checkbox ?? null
  }

  function url(key: string): string | null {
    return prop[key]?.url ?? null
  }

  return {
    name:               text(N.name),
    summary:            text(N.summary),
    categories:         multiSelect(N.categories) as Place['categories'],
    seasons:            multiSelect(N.seasons) as Place['seasons'],
    ai_inferred_fields: multiSelect(N.ai_inferred_fields),
    source_type:        multiSelect(N.source_type) as Place['source_type'],
    indoor_outdoor:     select(N.indoor_outdoor) as Place['indoor_outdoor'],
    address:            text(N.address) || null,
    region:             select(N.region) as Place['region'],
    longitude:          num(N.longitude),
    latitude:           num(N.latitude),
    google_place_id:    text(N.google_place_id) || null,
    age_min:            num(N.age_min),
    age_max:            num(N.age_max),
    stroller_friendly:  checkbox(N.stroller_friendly),
    parking_friendly:   checkbox(N.parking_friendly),
    has_restroom:       checkbox(N.has_restroom),
    has_nursing_room:   checkbox(N.has_nursing_room),
    energy_level:       select(N.energy_level) as Place['energy_level'],
    stay_minutes:       num(N.stay_minutes),
    reservation_needed: checkbox(N.reservation_needed),
    crowded_on_weekends:checkbox(N.crowded_on_weekends),
    fee_type:           select(N.fee_type) as Place['fee_type'],
    fee_details:        text(N.fee_details) || null,
    source_url:         url(N.source_url),
    internal_id:        text(N.internal_id),
    created_by:         text(N.created_by) || null,
    notion_page_id:     page.id,
    notion_url:         page.url,
    status:             (prop[N.status]?.status?.name ?? 'draft') as Place['status'] & string,
  }
}

// --- Notion filter builder for searchPlaces ---

type Filter = Record<string, unknown>

function and(conditions: Filter[]): Filter {
  return conditions.length === 1 ? conditions[0] : { and: conditions }
}

function orFilters(property: string, type: string, key: string, values: string[]): Filter {
  if (values.length === 1) return { property, [type]: { [key]: values[0] } }
  return { or: values.map(v => ({ property, [type]: { [key]: v } })) }
}

export function buildNotionFilter(filters: SearchFilters): Filter {
  const conditions: Filter[] = [
    { property: N.status, status: { does_not_equal: 'archived' } },
  ]

  if (filters.indoor_outdoor)
    conditions.push({ property: N.indoor_outdoor, select: { equals: filters.indoor_outdoor } })

  if (filters.region)
    conditions.push({ property: N.region, select: { equals: filters.region } })

  if (filters.fee_type)
    conditions.push({ property: N.fee_type, select: { equals: filters.fee_type } })

  if (filters.energy_level)
    conditions.push({ property: N.energy_level, select: { equals: filters.energy_level } })

  if (filters.categories?.length)
    conditions.push(orFilters(N.categories, 'multi_select', 'contains', filters.categories))

  if (filters.seasons?.length)
    conditions.push(orFilters(N.seasons, 'multi_select', 'contains', filters.seasons))

  if (filters.age != null) {
    // Allow entries where age_min is unset OR age_min <= age
    conditions.push({
      or: [
        { property: N.age_min, number: { is_empty: true } },
        { property: N.age_min, number: { less_than_or_equal_to: filters.age } },
      ],
    })
    // Allow entries where age_max is unset OR age_max >= age
    conditions.push({
      or: [
        { property: N.age_max, number: { is_empty: true } },
        { property: N.age_max, number: { greater_than_or_equal_to: filters.age } },
      ],
    })
  }

  if (filters.free_text_keywords?.length) {
    for (const kw of filters.free_text_keywords) {
      conditions.push({
        or: [
          { property: N.name,    title:      { contains: kw } },
          { property: N.summary, rich_text:  { contains: kw } },
        ],
      })
    }
  }

  return and(conditions)
}

// --- API calls ---

export async function createPlace(
  place: Place,
  env: Env,
): Promise<{ notion_page_id: string; url: string }> {
  const page = await notionPost<NotionPage>(
    '/pages',
    {
      parent: { database_id: env.NOTION_DB_ID },
      properties: placeToNotionProperties(place),
    },
    env.NOTION_TOKEN,
  )
  return { notion_page_id: page.id, url: page.url }
}

export async function findPlaceByGooglePlaceId(
  googlePlaceId: string,
  env: Env,
): Promise<Place | null> {
  const res = await notionPost<NotionQueryResponse>(
    `/databases/${env.NOTION_DB_ID}/query`,
    {
      filter: {
        and: [
          { property: N.google_place_id, rich_text: { equals: googlePlaceId } },
          { property: N.status, status: { does_not_equal: 'archived' } },
        ],
      },
      page_size: 1,
    },
    env.NOTION_TOKEN,
  )
  if (res.results.length === 0) return null
  return notionPageToPlace(res.results[0])
}

export async function searchPlaces(
  filters: SearchFilters,
  env: Env,
  limit = 5,
): Promise<Place[]> {
  const res = await notionPost<NotionQueryResponse>(
    `/databases/${env.NOTION_DB_ID}/query`,
    {
      filter: buildNotionFilter(filters),
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: limit,
    },
    env.NOTION_TOKEN,
  )
  return res.results.map(notionPageToPlace)
}

// --- DB discovery (ADR-019) ---

export type DbIds = {
  places: string
  visits: string
  settings: string
}

const DB_NAMES: Record<keyof DbIds, string> = {
  places: 'Alfred — 親子景點',
  visits: 'Visits',
  settings: 'Settings',
}

const DB_IDS_KV_KEY = 'system:db_ids'
const DB_IDS_TTL_SECONDS = 86400  // 24h

type BlocksPage = {
  results: Array<{ type: string; id: string; child_database?: { title: string } }>
  has_more: boolean
  next_cursor: string | null
}

/**
 * Returns the Notion DB IDs for Places, Visits, and Settings.
 * Checks KV cache first (TTL 24h); on miss, scans NOTION_PARENT_PAGE_ID block children.
 * Throws if any expected DB is not found under the parent page.
 */
export async function discoverDbIds(env: Env): Promise<DbIds> {
  const cached = await env.ALFRED_KV.get(DB_IDS_KV_KEY)
  if (cached) return JSON.parse(cached) as DbIds

  const found: Partial<DbIds> = {}
  let cursor: string | undefined

  do {
    const url = `${NOTION_API}/blocks/${env.NOTION_PARENT_PAGE_ID}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
    const res = await fetch(url, { headers: headers(env.NOTION_TOKEN) })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`discoverDbIds: blocks.children failed (${res.status}): ${text}`)
    }
    const page = await res.json() as BlocksPage
    for (const block of page.results) {
      if (block.type !== 'child_database' || !block.child_database) continue
      const title = block.child_database.title
      for (const key of Object.keys(DB_NAMES) as Array<keyof DbIds>) {
        if (title === DB_NAMES[key]) found[key] = block.id
      }
    }
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined
  } while (cursor)

  const missing = (Object.keys(DB_NAMES) as Array<keyof DbIds>).filter(k => !found[k])
  if (missing.length > 0) {
    throw new Error(`discoverDbIds: DB(s) not found under parent page: ${missing.join(', ')}`)
  }

  const ids = found as DbIds
  await env.ALFRED_KV.put(DB_IDS_KV_KEY, JSON.stringify(ids), {
    expirationTtl: DB_IDS_TTL_SECONDS,
  })
  return ids
}
