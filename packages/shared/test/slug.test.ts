import { describe, expect, it } from 'vitest'
import { slugify } from '../src/slug.js'

describe('slugify', () => {
  it('joins parts, lowercases, strips punctuation', () => {
    expect(slugify('Nas', "Life's a Bitch")).toBe('nas-lifes-a-bitch')
  })
  it('collapses spaces/symbols to single hyphens, trims edges', () => {
    expect(slugify('  MF DOOM ', 'Mm.. Food ')).toBe('mf-doom-mm-food')
  })
  it('always starts with an alphanumeric (drops leading hyphens)', () => {
    expect(slugify('!!!', 'Album')).toMatch(/^[a-z0-9]/)
  })
  it('is stable for the same inputs', () => {
    expect(slugify('A', 'B')).toBe(slugify('A', 'B'))
  })
  it('caps length and leaves no trailing hyphen when a boundary falls at the cap', () => {
    const slug = slugify('a'.repeat(63), 'b'.repeat(10))
    expect(slug.length).toBeLessThanOrEqual(64)
    expect(slug).not.toMatch(/-$/)
  })
  it("falls back to 'preset' for empty/all-punctuation input", () => {
    expect(slugify('???')).toBe('preset')
    expect(slugify()).toBe('preset')
    expect(slugify(null, undefined)).toBe('preset')
  })
  it('strips diacritics', () => {
    expect(slugify('Björk', 'Médula')).toBe('bjork-medula')
  })
  it('strips unicode apostrophes', () => {
    expect(slugify('D’Angelo')).toBe('dangelo')
  })
})
