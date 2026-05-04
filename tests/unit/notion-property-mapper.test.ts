import { describe, it, expect } from 'vitest'
import {
  placeToNotionProperties,
  notionPageToPlace,
  buildNotionFilter,
} from '../../src/integrations/notion'
import { N } from '../../src/capabilities/places/schema'
import { SAMPLE_PLACE, MINIMAL_PLACE } from '../fixtures/places'

// --- placeToNotionProperties ---

describe('placeToNotionProperties', () => {
  it('sets required fields unconditionally', () => {
    const props = placeToNotionProperties(SAMPLE_PLACE)
    expect(props[N.name]).toEqual({ title: [{ type: 'text', text: { content: '兒童新樂園' } }] })
    expect(props[N.status]).toEqual({ status: { name: 'draft' } })
    expect(props[N.internal_id]).toEqual({ rich_text: [{ type: 'text', text: { content: 'test-uuid-1234' } }] })
    expect(props[N.summary]).toEqual({
      rich_text: [{ type: 'text', text: { content: SAMPLE_PLACE.summary } }],
    })
  })

  it('maps multi-select fields', () => {
    const props = placeToNotionProperties(SAMPLE_PLACE)
    expect(props[N.categories]).toEqual({ multi_select: [{ name: '遊樂園' }] })
    expect(props[N.seasons]).toEqual({ multi_select: [{ name: '全年' }] })
    expect(props[N.ai_inferred_fields]).toEqual({
      multi_select: [{ name: 'Age Min' }, { name: 'Age Max' }],
    })
  })

  it('maps select fields', () => {
    const props = placeToNotionProperties(SAMPLE_PLACE)
    expect(props[N.indoor_outdoor]).toEqual({ select: { name: '半室內' } })
    expect(props[N.region]).toEqual({ select: { name: '台北' } })
    expect(props[N.energy_level]).toEqual({ select: { name: '放電型' } })
    expect(props[N.fee_type]).toEqual({ select: { name: '部分收費' } })
  })

  it('maps number fields', () => {
    const props = placeToNotionProperties(SAMPLE_PLACE)
    expect(props[N.age_min]).toEqual({ number: 3 })
    expect(props[N.age_max]).toEqual({ number: 12 })
    expect(props[N.stay_minutes]).toEqual({ number: 240 })
  })

  it('maps checkbox fields', () => {
    const props = placeToNotionProperties(SAMPLE_PLACE)
    expect(props[N.stroller_friendly]).toEqual({ checkbox: true })
    expect(props[N.parking_friendly]).toEqual({ checkbox: true })
    expect(props[N.reservation_needed]).toEqual({ checkbox: false })
    expect(props[N.crowded_on_weekends]).toEqual({ checkbox: true })
  })

  it('omits null optional fields', () => {
    const props = placeToNotionProperties(MINIMAL_PLACE)
    expect(props[N.indoor_outdoor]).toBeUndefined()
    expect(props[N.region]).toBeUndefined()
    expect(props[N.address]).toBeUndefined()
    expect(props[N.age_min]).toBeUndefined()
    expect(props[N.age_max]).toBeUndefined()
    expect(props[N.stroller_friendly]).toBeUndefined()
    expect(props[N.energy_level]).toBeUndefined()
    expect(props[N.fee_type]).toBeUndefined()
    expect(props[N.source_url]).toBeUndefined()
  })

  it('omits empty multi-select arrays', () => {
    const props = placeToNotionProperties(MINIMAL_PLACE)
    expect(props[N.categories]).toBeUndefined()
    expect(props[N.source_type]).toBeUndefined()
  })

  it('always sets seasons and ai_inferred_fields even if empty', () => {
    const props = placeToNotionProperties(MINIMAL_PLACE)
    expect(props[N.seasons]).toEqual({ multi_select: [{ name: '全年' }] })
    expect(props[N.ai_inferred_fields]).toEqual({ multi_select: [] })
  })
})

// --- notionPageToPlace ---

function makePage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'page-id-abc',
    url: 'https://www.notion.so/page-id-abc',
    properties: {
      [N.name]:               { type: 'title', title: [{ plain_text: '兒童新樂園' }] },
      [N.status]:             { type: 'status', status: { name: 'confirmed' } },
      [N.summary]:            { type: 'rich_text', rich_text: [{ plain_text: SAMPLE_PLACE.summary }] },
      [N.categories]:         { type: 'multi_select', multi_select: [{ name: '遊樂園' }] },
      [N.seasons]:            { type: 'multi_select', multi_select: [{ name: '全年' }] },
      [N.ai_inferred_fields]: { type: 'multi_select', multi_select: [{ name: 'Age Min' }] },
      [N.indoor_outdoor]:     { type: 'select', select: { name: '半室內' } },
      [N.region]:             { type: 'select', select: { name: '台北' } },
      [N.age_min]:            { type: 'number', number: 3 },
      [N.age_max]:            { type: 'number', number: 12 },
      [N.stay_minutes]:       { type: 'number', number: 240 },
      [N.stroller_friendly]:  { type: 'checkbox', checkbox: true },
      [N.parking_friendly]:   { type: 'checkbox', checkbox: true },
      [N.has_restroom]:       { type: 'checkbox', checkbox: true },
      [N.has_nursing_room]:   { type: 'checkbox', checkbox: true },
      [N.reservation_needed]: { type: 'checkbox', checkbox: false },
      [N.crowded_on_weekends]:{ type: 'checkbox', checkbox: true },
      [N.energy_level]:       { type: 'select', select: { name: '放電型' } },
      [N.fee_type]:           { type: 'select', select: { name: '部分收費' } },
      [N.fee_details]:        { type: 'rich_text', rich_text: [{ plain_text: '入園免費' }] },
      [N.source_type]:        { type: 'multi_select', multi_select: [] },
      [N.internal_id]:        { type: 'rich_text', rich_text: [{ plain_text: 'test-uuid-1234' }] },
      [N.address]:            { type: 'rich_text', rich_text: [{ plain_text: '台北市士林區承德路五段55號' }] },
      [N.google_place_id]:    { type: 'rich_text', rich_text: [] },
      [N.source_url]:         { type: 'url', url: null },
      [N.longitude]:          { type: 'number', number: null },
      [N.latitude]:           { type: 'number', number: null },
      [N.created_by]:         { type: 'rich_text', rich_text: [] },
      ...overrides,
    },
  }
}

describe('notionPageToPlace', () => {
  it('reads scalar fields', () => {
    const place = notionPageToPlace(makePage())
    expect(place.name).toBe('兒童新樂園')
    expect(place.status).toBe('confirmed')
    expect(place.age_min).toBe(3)
    expect(place.age_max).toBe(12)
    expect(place.stay_minutes).toBe(240)
    expect(place.indoor_outdoor).toBe('半室內')
    expect(place.region).toBe('台北')
    expect(place.energy_level).toBe('放電型')
    expect(place.fee_type).toBe('部分收費')
    expect(place.notion_page_id).toBe('page-id-abc')
  })

  it('reads multi-select arrays', () => {
    const place = notionPageToPlace(makePage())
    expect(place.categories).toEqual(['遊樂園'])
    expect(place.seasons).toEqual(['全年'])
    expect(place.ai_inferred_fields).toEqual(['Age Min'])
  })

  it('reads checkboxes as booleans', () => {
    const place = notionPageToPlace(makePage())
    expect(place.stroller_friendly).toBe(true)
    expect(place.reservation_needed).toBe(false)
  })

  it('returns null for empty rich_text', () => {
    const place = notionPageToPlace(makePage())
    expect(place.google_place_id).toBeNull()
    expect(place.source_url).toBeNull()
    expect(place.longitude).toBeNull()
  })

  it('defaults status to draft when missing', () => {
    const place = notionPageToPlace(
      makePage({ [N.status]: { type: 'status', status: null } }),
    )
    expect(place.status).toBe('draft')
  })
})

// --- buildNotionFilter ---

describe('buildNotionFilter', () => {
  it('always excludes archived status', () => {
    const filter = buildNotionFilter({})
    expect(JSON.stringify(filter)).toContain('"archived"')
    expect(JSON.stringify(filter)).toContain(N.status)
  })

  it('returns single condition directly when only status filter', () => {
    const filter = buildNotionFilter({})
    expect(filter).toEqual({ property: N.status, status: { does_not_equal: 'archived' } })
  })

  it('wraps multiple conditions in and', () => {
    const filter = buildNotionFilter({ indoor_outdoor: '室內', region: '台北' })
    expect(filter).toHaveProperty('and')
    const { and } = filter as { and: unknown[] }
    expect(and).toHaveLength(3) // status + indoor + region
  })

  it('applies age filter with null-safe or conditions', () => {
    const filter = buildNotionFilter({ age: 3 }) as { and: unknown[] }
    const ageMinCond = filter.and.find(
      (c: unknown) => JSON.stringify(c).includes(N.age_min),
    )
    expect(ageMinCond).toBeDefined()
    expect(JSON.stringify(ageMinCond)).toContain('is_empty')
    expect(JSON.stringify(ageMinCond)).toContain('less_than_or_equal_to')
  })

  it('builds OR for multiple categories', () => {
    const filter = buildNotionFilter({ categories: ['公園', '步道'] }) as { and: unknown[] }
    const catCond = filter.and.find(
      (c: unknown) => JSON.stringify(c).includes(N.categories),
    )
    expect(JSON.stringify(catCond)).toContain('"or"')
    expect(JSON.stringify(catCond)).toContain('公園')
    expect(JSON.stringify(catCond)).toContain('步道')
  })

  it('never_visited — OR(is_empty, equals 0) on Visit Count', () => {
    const filter = buildNotionFilter({ visit_state: 'never_visited' }) as { and: unknown[] }
    const cond = filter.and.find((c: unknown) => JSON.stringify(c).includes(N.visit_count))
    const s = JSON.stringify(cond)
    expect(s).toContain('"or"')
    expect(s).toContain('is_empty')
    expect(s).toContain('"equals":0')
  })

  it('visited_recently — Last Visited on_or_after 30 days ago', () => {
    const filter = buildNotionFilter({ visit_state: 'visited_recently' }) as { and: unknown[] }
    const cond = filter.and.find((c: unknown) => JSON.stringify(c).includes(N.last_visited))
    const s = JSON.stringify(cond)
    expect(s).toContain('on_or_after')
    // date should be in the past (YYYY-MM-DD)
    expect(s).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('visited_long_ago — Last Visited on_or_before 180 days ago + Visit Count > 0', () => {
    const filter = buildNotionFilter({ visit_state: 'visited_long_ago' }) as { and: unknown[] }
    const s = JSON.stringify(filter)
    expect(s).toContain('on_or_before')
    expect(s).toContain('"greater_than":0')
    expect(s).toContain(N.last_visited)
    expect(s).toContain(N.visit_count)
  })

  it('highly_rated — Avg Rating >= 4.5 + Visit Count >= 1', () => {
    const filter = buildNotionFilter({ visit_state: 'highly_rated' }) as { and: unknown[] }
    const s = JSON.stringify(filter)
    expect(s).toContain('greater_than_or_equal_to')
    expect(s).toContain('4.5')
    expect(s).toContain(N.avg_rating)
    expect(s).toContain(N.visit_count)
  })

  it('loved_recently does not add conditions (handled by searchLovedRecentlyPlaces)', () => {
    const filter = buildNotionFilter({ visit_state: 'loved_recently' })
    // Only the status condition should be present
    expect(filter).toEqual({ property: N.status, status: { does_not_equal: 'archived' } })
  })

  it('null visit_state adds no conditions', () => {
    const filter = buildNotionFilter({ visit_state: null })
    expect(filter).toEqual({ property: N.status, status: { does_not_equal: 'archived' } })
  })
})
