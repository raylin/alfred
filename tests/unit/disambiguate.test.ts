import { describe, it, expect } from 'vitest'
import { buildDisambiguateCard } from '../../src/capabilities/places/disambiguate'
import type { Place } from '../../src/capabilities/places/schema'

function makePlace(name: string, notionPageId: string): Place {
  return {
    name,
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
    age_min: null,
    age_max: null,
    stroller_friendly: null,
    parking_friendly: null,
    has_restroom: null,
    has_nursing_room: null,
    energy_level: null,
    stay_minutes: null,
    reservation_needed: null,
    crowded_on_weekends: null,
    fee_type: null,
    fee_details: null,
    source_url: null,
    internal_id: 'int-id',
    created_by: null,
    notion_page_id: notionPageId,
    status: 'draft',
  }
}

const PLACES = [
  makePlace('大湖公園', 'page-aaa'),
  makePlace('大湖農場', 'page-bbb'),
  makePlace('大湖特色公園', 'page-ccc'),
]

describe('buildDisambiguateCard', () => {
  it('returns a flex message with altText', () => {
    const card = buildDisambiguateCard(PLACES, 'visit')
    expect(card.type).toBe('flex')
    expect(card.altText).toBe('你說的是哪個地方？')
  })

  it('creates one button per candidate place', () => {
    const card = buildDisambiguateCard(PLACES, 'visit')
    const bubble = card.contents as Record<string, unknown>
    const body = bubble['body'] as Record<string, unknown>
    const contents = body['contents'] as unknown[]
    // First is heading text, second is separator, then buttons
    const buttons = contents.filter((c: unknown) => (c as Record<string, unknown>)['type'] === 'button')
    expect(buttons).toHaveLength(3)
  })

  it('encodes postback data as visit:select:{notion_page_id}', () => {
    const card = buildDisambiguateCard(PLACES, 'visit')
    const bubble = card.contents as Record<string, unknown>
    const body = bubble['body'] as Record<string, unknown>
    const contents = body['contents'] as unknown[]
    const buttons = contents.filter((c: unknown) => (c as Record<string, unknown>)['type'] === 'button')
    const firstAction = (buttons[0] as Record<string, unknown>)['action'] as Record<string, unknown>
    expect(firstAction['data']).toBe('visit:select:page-aaa')
  })

  it('truncates long place names to 20 chars in button label', () => {
    const longName = 'A'.repeat(25)
    const card = buildDisambiguateCard([makePlace(longName, 'page-x')], 'visit')
    const bubble = card.contents as Record<string, unknown>
    const body = bubble['body'] as Record<string, unknown>
    const contents = body['contents'] as unknown[]
    const button = contents.find((c: unknown) => (c as Record<string, unknown>)['type'] === 'button') as Record<string, unknown>
    const action = button['action'] as Record<string, unknown>
    expect((action['label'] as string).length).toBeLessThanOrEqual(20)
  })

  it('caps at 5 buttons for large candidate lists', () => {
    const places = Array.from({ length: 8 }, (_, i) => makePlace(`地點${i}`, `page-${i}`))
    const card = buildDisambiguateCard(places, 'visit')
    const bubble = card.contents as Record<string, unknown>
    const body = bubble['body'] as Record<string, unknown>
    const contents = body['contents'] as unknown[]
    const buttons = contents.filter((c: unknown) => (c as Record<string, unknown>)['type'] === 'button')
    expect(buttons).toHaveLength(5)
  })
})
