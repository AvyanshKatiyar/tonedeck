import { describe, expect, it, vi } from 'vitest'
import { parseNowPlaying, readNowPlaying } from '../src/nowplaying.js'

describe('parseNowPlaying', () => {
  it('parses a playing track', () => {
    expect(parseNowPlaying("playing|1234|Life's a Bitch|Nas|Illmatic")).toEqual({
      state: 'playing', trackId: 1234, title: "Life's a Bitch", artist: 'Nas', album: 'Illmatic',
    })
  })
  it('handles a pipe inside the title (splits on first 4 delimiters)', () => {
    // Rule: album = last field, artist = second-to-last, title = everything in between.
    // For 'playing|9|A|B|C|D': parts=[playing,9,A,B,C,D], n=6 → artist=C, album=D, title=A|B
    expect(parseNowPlaying('playing|9|A|B|C|D').title).toBe('A|B')
    expect(parseNowPlaying('playing|9|Intro | Outro|Nas|Illmatic').title).toBe('Intro | Outro')
  })
  it('maps closed/stopped to empty struct', () => {
    expect(parseNowPlaying('closed|||').state).toBe('closed')
    expect(parseNowPlaying('stopped|||').state).toBe('stopped')
    expect(parseNowPlaying('closed|||').trackId).toBeNull()
  })
  it('maps paused', () => {
    expect(parseNowPlaying('paused|5|T|Ar|Al').state).toBe('paused')
  })
  it('returns closed for too-few fields (truncated osascript output)', () => {
    expect(parseNowPlaying('playing|5').state).toBe('closed')
    expect(parseNowPlaying('playing|5').trackId).toBeNull()
    expect(parseNowPlaying('playing|5').artist).toBeNull()
  })
  it('returns closed for empty string', () => {
    expect(parseNowPlaying('').state).toBe('closed')
  })
  it('returns closed for an unknown state token', () => {
    expect(parseNowPlaying('rewinding|5|T|Ar|Al').state).toBe('closed')
  })
})

describe('readNowPlaying', () => {
  it('uses injected exec and returns parsed struct', async () => {
    const exec = vi.fn().mockResolvedValue('playing|7|T|Ar|Al')
    expect(await readNowPlaying(exec)).toMatchObject({ state: 'playing', trackId: 7 })
  })
  it('returns closed when exec throws (Music not scriptable)', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('app not running'))
    expect((await readNowPlaying(exec)).state).toBe('closed')
  })
})
