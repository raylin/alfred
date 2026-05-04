import { describe, it, expect } from 'vitest'
import { detectInputType, isInstagramUrl } from '../../src/capabilities/places/input-detect'

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

  it('classifies Instagram URL as instagram-url', () => {
    expect(detectInputType('https://www.instagram.com/reel/ABC123/')).toBe('instagram-url')
  })

  it('classifies instagram.com without www as instagram-url', () => {
    expect(detectInputType('https://instagram.com/p/DEF456/')).toBe('instagram-url')
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

describe('isInstagramUrl', () => {
  it('detects www.instagram.com', () => {
    expect(isInstagramUrl('https://www.instagram.com/reel/ABC123/')).toBe(true)
  })

  it('detects instagram.com without www', () => {
    expect(isInstagramUrl('https://instagram.com/p/XYZ/')).toBe(true)
  })

  it('returns false for regular URL', () => {
    expect(isInstagramUrl('https://example.com/photo')).toBe(false)
  })

  it('returns false for Google Maps URL', () => {
    expect(isInstagramUrl('https://maps.app.goo.gl/abc')).toBe(false)
  })
})

