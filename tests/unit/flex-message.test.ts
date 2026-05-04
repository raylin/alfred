import { describe, it, expect } from 'vitest'
import { buildDraftCard, buildSearchCarousel } from '../../src/capabilities/places/flex-message'
import { SAMPLE_PLACE } from '../fixtures/places'
import type { RouteResult } from '../../src/integrations/routes-api'

const NOTION_URL = 'https://www.notion.so/test-page-abc'

const PLACE_WITH_NOTION = {
  ...SAMPLE_PLACE,
  notion_url: NOTION_URL,
  notion_page_id: 'test-page-abc',
}

describe('buildDraftCard', () => {
  it('returns a flex message type', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    expect(msg.type).toBe('flex')
  })

  it('sets altText with place name', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    expect(msg.altText).toContain('兒童新樂園')
  })

  it('contents is a bubble', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    expect((msg.contents as { type: string }).type).toBe('bubble')
  })

  it('includes place name in header', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    const headerStr = JSON.stringify(msg.contents)
    expect(headerStr).toContain('兒童新樂園')
  })

  it('includes Notion URL in footer button', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    const footerStr = JSON.stringify((msg.contents as { footer: unknown }).footer)
    expect(footerStr).toContain(NOTION_URL)
  })

  it('includes category in header subtitle', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    const headerStr = JSON.stringify((msg.contents as { header: unknown }).header)
    expect(headerStr).toContain('遊樂園')
  })

  it('includes AI推測 badge for inferred fields', () => {
    const placeWithInferred = {
      ...PLACE_WITH_NOTION,
      ai_inferred_fields: ['Age Min', 'Age Max'],
    }
    const msg = buildDraftCard(placeWithInferred)
    expect(JSON.stringify(msg.contents)).toContain('AI推測')
  })

  it('does not include AI推測 when ai_inferred_fields is empty', () => {
    const placeNoInferred = { ...PLACE_WITH_NOTION, ai_inferred_fields: [] }
    const msg = buildDraftCard(placeNoInferred)
    expect(JSON.stringify(msg.contents)).not.toContain('AI推測')
  })

  it('includes location row when region is present', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    const bodyStr = JSON.stringify((msg.contents as { body: unknown }).body)
    expect(bodyStr).toContain('台北')
    expect(bodyStr).toContain('位置')
  })

  it('includes fee row when fee_type is present', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    const bodyStr = JSON.stringify((msg.contents as { body: unknown }).body)
    expect(bodyStr).toContain('收費')
    expect(bodyStr).toContain('部分收費')
  })

  it('uses notion_url for button when available', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    const contents = JSON.stringify(msg.contents)
    expect(contents).toContain(NOTION_URL)
  })

  it('falls back to notion_page_id in URL when notion_url absent', () => {
    const { notion_url: _notionUrl, ...placeNoUrl } = PLACE_WITH_NOTION
    const msg = buildDraftCard(placeNoUrl)
    const contents = JSON.stringify(msg.contents)
    expect(contents).toContain('test-page-abc')
  })

  it('includes disambiguation note in body when note is provided', () => {
    const note = '找到的是：台北市士林區，不是的話告訴我正確的地點。'
    const msg = buildDraftCard(PLACE_WITH_NOTION, note)
    const bodyStr = JSON.stringify((msg.contents as { body: unknown }).body)
    expect(bodyStr).toContain('找到的是')
    expect(bodyStr).toContain('台北市士林區')
  })

  it('does not include note text when note is undefined', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    const bodyStr = JSON.stringify((msg.contents as { body: unknown }).body)
    expect(bodyStr).not.toContain('找到的是')
  })

  it('includes distance row when driving + transit are present', () => {
    const distance: RouteResult = {
      driving: { duration_minutes: 22, distance_meters: 5000 },
      transit: { duration_minutes: 35, distance_meters: 5800 },
    }
    const msg = buildDraftCard(PLACE_WITH_NOTION, undefined, distance)
    const bodyStr = JSON.stringify((msg.contents as { body: unknown }).body)
    expect(bodyStr).toContain('🚗')
    expect(bodyStr).toContain('22 分')
    expect(bodyStr).toContain('🚇')
    expect(bodyStr).toContain('35 分')
  })

  it('includes distance row with driving only when transit is null', () => {
    const distance: RouteResult = {
      driving: { duration_minutes: 15, distance_meters: 3000 },
      transit: null,
    }
    const msg = buildDraftCard(PLACE_WITH_NOTION, undefined, distance)
    const bodyStr = JSON.stringify((msg.contents as { body: unknown }).body)
    expect(bodyStr).toContain('🚗')
    expect(bodyStr).not.toContain('🚇')
  })

  it('does not add distance row when both driving and transit are null', () => {
    const distance: RouteResult = { driving: null, transit: null }
    const msg = buildDraftCard(PLACE_WITH_NOTION, undefined, distance)
    const bodyStr = JSON.stringify((msg.contents as { body: unknown }).body)
    expect(bodyStr).not.toContain('🚗')
    expect(bodyStr).not.toContain('🚇')
  })

  it('does not add distance row when distance is not provided', () => {
    const msg = buildDraftCard(PLACE_WITH_NOTION)
    const bodyStr = JSON.stringify((msg.contents as { body: unknown }).body)
    expect(bodyStr).not.toContain('🚗')
  })
})

describe('buildSearchCarousel', () => {
  const PLACE_WITH_NOTION = {
    ...SAMPLE_PLACE,
    notion_url: 'https://www.notion.so/test-page-abc',
    notion_page_id: 'test-page-abc',
  }

  it('includes distance row in bubble when distance provided', () => {
    const distance: RouteResult = {
      driving: { duration_minutes: 20, distance_meters: 4000 },
      transit: null,
    }
    const msg = buildSearchCarousel([PLACE_WITH_NOTION], [distance])
    expect(JSON.stringify(msg.contents)).toContain('🚗')
    expect(JSON.stringify(msg.contents)).toContain('20 分')
  })

  it('does not add distance row when distances array is not provided', () => {
    const msg = buildSearchCarousel([PLACE_WITH_NOTION])
    expect(JSON.stringify(msg.contents)).not.toContain('🚗')
  })

  it('handles mixed distances (some null)', () => {
    const places = [PLACE_WITH_NOTION, PLACE_WITH_NOTION]
    const distances: (RouteResult | null)[] = [
      { driving: { duration_minutes: 10, distance_meters: 2000 }, transit: null },
      null,
    ]
    const msg = buildSearchCarousel(places, distances)
    const carouselStr = JSON.stringify(msg.contents)
    expect(carouselStr).toContain('🚗')
  })
})
