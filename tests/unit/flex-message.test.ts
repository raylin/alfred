import { describe, it, expect } from 'vitest'
import { buildDraftCard } from '../../src/capabilities/places/flex-message'
import { SAMPLE_PLACE } from '../fixtures/places'

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
    const msg = buildDraftCard({ ...placeNoUrl, notion_url: undefined })
    const contents = JSON.stringify(msg.contents)
    expect(contents).toContain('test-page-abc')
  })
})
