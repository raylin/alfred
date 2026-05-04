import { describe, it, expect } from 'vitest'
import { detectInputType } from '../../src/capabilities/places/input-detect'

describe('detectInputType', () => {
  it('classifies Google Maps /maps/ URL as google-maps-url', () => {
    expect(detectInputType('https://www.google.com/maps/place/兒童新樂園/@25.08,121.49,17z')).toBe('google-maps-url')
  })

  it('classifies maps.app.goo.gl as google-maps-url', () => {
    expect(detectInputType('https://maps.app.goo.gl/abc123')).toBe('google-maps-url')
  })

  it('classifies goo.gl/maps as google-maps-url', () => {
    expect(detectInputType('https://goo.gl/maps/XXXXX')).toBe('google-maps-url')
  })

  it('classifies regular https URL as url', () => {
    expect(detectInputType('https://mommytime.blog/taipei-kids-park')).toBe('url')
  })

  it('classifies http URL as url', () => {
    expect(detectInputType('http://example.com/article')).toBe('url')
  })

  it('classifies plain text as text', () => {
    expect(detectInputType('大湖公園划船')).toBe('text')
  })

  it('classifies question as text', () => {
    expect(detectInputType('下雨天三歲適合的台北景點')).toBe('text')
  })

  it('trims whitespace before detecting', () => {
    expect(detectInputType('  https://example.com  ')).toBe('url')
  })
})
