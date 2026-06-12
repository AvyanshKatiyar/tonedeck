import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index.js'

describe('shared', () => {
  it('VERSION is a semver string', () => {
    // e.g. "0.1.0", "1.2.3-alpha.1"
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
