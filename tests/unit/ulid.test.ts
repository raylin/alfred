import { describe, it, expect } from 'vitest'
import { generateUlid } from '../../src/lib/ulid'

describe('generateUlid', () => {
  it('returns a 26-character string', () => {
    expect(generateUlid()).toHaveLength(26)
  })

  it('uses only Crockford base32 characters', () => {
    const ulid = generateUlid()
    expect(ulid).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
  })

  it('generates unique values on each call', () => {
    const a = generateUlid()
    const b = generateUlid()
    expect(a).not.toBe(b)
  })

  it('is lexicographically sortable by time (later call has >= prefix)', () => {
    const a = generateUlid()
    const b = generateUlid()
    // Both generated in same millisecond or later — b's time prefix >= a's
    expect(b.slice(0, 10) >= a.slice(0, 10)).toBe(true)
  })

  it('generates 100 unique values with no collisions', () => {
    const set = new Set<string>()
    for (let i = 0; i < 100; i++) set.add(generateUlid())
    expect(set.size).toBe(100)
  })
})
