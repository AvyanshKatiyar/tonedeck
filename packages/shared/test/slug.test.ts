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
})
