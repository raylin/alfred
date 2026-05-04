import { describe, it, expect } from 'vitest'
import { formatVisitTitle } from '../../src/lib/visit-title'

describe('formatVisitTitle', () => {
  it('combines place name and date with " - " separator', () => {
    expect(formatVisitTitle('大湖公園', '2026-05-12')).toBe('大湖公園 - 2026-05-12')
  })

  it('handles longer place names', () => {
    expect(formatVisitTitle('兒童新樂園', '2026-05-04')).toBe('兒童新樂園 - 2026-05-04')
  })

  it('preserves date format as-is', () => {
    expect(formatVisitTitle('測試地點', '2026-01-01')).toBe('測試地點 - 2026-01-01')
  })
})
