import { describe, it, expect } from 'vitest'
import { formatMinutes, formatRouteRow } from '../../src/lib/distance-format'
import type { RouteResult } from '../../src/integrations/routes-api'

describe('formatMinutes', () => {
  it('formats 0 minutes', () => expect(formatMinutes(0)).toBe('0 分'))
  it('formats under 60 minutes', () => expect(formatMinutes(22)).toBe('22 分'))
  it('formats exactly 59 minutes', () => expect(formatMinutes(59)).toBe('59 分'))
  it('formats exactly 60 minutes as 1 小時', () => expect(formatMinutes(60)).toBe('1 小時'))
  it('formats 65 minutes as 1 小時 5 分', () => expect(formatMinutes(65)).toBe('1 小時 5 分'))
  it('formats 90 minutes', () => expect(formatMinutes(90)).toBe('1 小時 30 分'))
  it('formats 120 minutes as 2 小時', () => expect(formatMinutes(120)).toBe('2 小時'))
})

describe('formatRouteRow', () => {
  const driving: RouteResult['driving'] = { duration_minutes: 22, distance_meters: 5000 }
  const transit: RouteResult['transit'] = { duration_minutes: 35, distance_meters: 5800 }

  it('formats driving + transit on one line', () => {
    const row = formatRouteRow({ driving, transit })
    expect(row).toContain('🚗 22 分')
    expect(row).toContain('🚇 35 分')
  })

  it('formats driving only', () => {
    expect(formatRouteRow({ driving, transit: null })).toBe('🚗 22 分')
  })

  it('formats transit only', () => {
    expect(formatRouteRow({ driving: null, transit })).toBe('🚇 35 分')
  })

  it('returns empty string when both null', () => {
    expect(formatRouteRow({ driving: null, transit: null })).toBe('')
  })

  it('over-60-minute driving is formatted correctly', () => {
    const row = formatRouteRow({ driving: { duration_minutes: 75, distance_meters: 30000 }, transit: null })
    expect(row).toBe('🚗 1 小時 15 分')
  })
})
