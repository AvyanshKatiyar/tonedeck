/**
 * Artwork module unit tests — fetch is fully injectable; no network calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { Artwork, ArtworkError, type FetchLike } from '../src/artwork.js'

// Reference bytes — used for assertions.
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

/** Build a correctly-sized ArrayBuffer so Buffer.from(ab) is byte-exact. */
function fakeJpegArrayBuffer(): ArrayBuffer {
  const ab = new ArrayBuffer(FAKE_JPEG.length)
  new Uint8Array(ab).set(FAKE_JPEG)
  return ab
}

function makeFakeSearch(results: unknown[] = []): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results }),
    arrayBuffer: async () => fakeJpegArrayBuffer(),
  })
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'td-artwork-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ── search ────────────────────────────────────────────────────────────────────

describe('search', () => {
  it('maps iTunes results and rewrites artworkUrl600', async () => {
    const fetch = makeFakeSearch([
      {
        collectionId: 12345,
        artistName: 'Kanye West',
        collectionName: 'My Beautiful Dark Twisted Fantasy',
        artworkUrl100: 'https://example.mzstatic.com/image/100x100bb.jpg',
      },
    ])
    const art = new Artwork({ cacheDir: tmpDir, fetchImpl: fetch })
    const results = await art.search('Kanye West MBDTF')

    expect(results).toHaveLength(1)
    expect(results[0].collectionId).toBe(12345)
    expect(results[0].artistName).toBe('Kanye West')
    expect(results[0].collectionName).toBe('My Beautiful Dark Twisted Fantasy')
    expect(results[0].artworkUrl100).toBe('https://example.mzstatic.com/image/100x100bb.jpg')
    expect(results[0].artworkUrl600).toBe('https://example.mzstatic.com/image/600x600bb.jpg')
  })

  it('returns empty array when results is missing', async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    const art = new Artwork({ cacheDir: tmpDir, fetchImpl: fetch })
    expect(await art.search('term')).toEqual([])
  })

  it('throws ArtworkError on non-200 status', async () => {
    const fetch: FetchLike = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    const art = new Artwork({ cacheDir: tmpDir, fetchImpl: fetch })
    await expect(art.search('term')).rejects.toBeInstanceOf(ArtworkError)
  })

  it('throws ArtworkError when fetch rejects (network / abort)', async () => {
    const abortErr = Object.assign(new Error('AbortError'), { name: 'AbortError' })
    const fetch: FetchLike = async () => {
      throw abortErr
    }
    const art = new Artwork({ cacheDir: tmpDir, fetchImpl: fetch })
    await expect(art.search('term')).rejects.toBeInstanceOf(ArtworkError)
  })

  it('constructs the correct iTunes search URL', async () => {
    let capturedUrl = ''
    const fetch: FetchLike = async (url) => {
      capturedUrl = url
      return { ok: true, status: 200, json: async () => ({ results: [] }), arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const art = new Artwork({ cacheDir: tmpDir, fetchImpl: fetch })
    await art.search('808s & Heartbreak')
    expect(capturedUrl).toContain('entity=album')
    expect(capturedUrl).toContain('808s')
    expect(capturedUrl).toContain('media=music')
    expect(capturedUrl).not.toContain(' ') // URL-encoded
  })
})

// ── ensureCached ──────────────────────────────────────────────────────────────

describe('ensureCached', () => {
  it('downloads the image and writes it atomically', async () => {
    const fetch = makeFakeSearch()
    const art = new Artwork({ cacheDir: join(tmpDir, 'cache'), fetchImpl: fetch })
    const path = await art.ensureCached('my-slug', 'https://example.com/art.jpg')
    expect(existsSync(path)).toBe(true)
    const buf = await readFile(path)
    // Verify the exact bytes were stored (use subarray to handle any trailing zeros).
    expect(buf.length).toBe(FAKE_JPEG.length)
    expect(buf.compare(FAKE_JPEG)).toBe(0)
  })

  it('returns the same path on second call without re-fetching', async () => {
    let callCount = 0
    const fetch: FetchLike = async () => {
      callCount++
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
        arrayBuffer: async () => fakeJpegArrayBuffer(),
      }
    }
    const art = new Artwork({ cacheDir: join(tmpDir, 'cache'), fetchImpl: fetch })
    const p1 = await art.ensureCached('slug', 'https://x.com/art.jpg')
    const p2 = await art.ensureCached('slug', 'https://x.com/art.jpg')
    expect(callCount).toBe(1)
    expect(p1).toBe(p2)
  })

  it('throws ArtworkError on non-200 download', async () => {
    const fetch: FetchLike = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    const art = new Artwork({ cacheDir: join(tmpDir, 'cache'), fetchImpl: fetch })
    await expect(art.ensureCached('slug', 'https://x.com/art.jpg')).rejects.toBeInstanceOf(ArtworkError)
  })

  it('creates cacheDir if it does not exist', async () => {
    const deepDir = join(tmpDir, 'a', 'b', 'cache')
    const fetch = makeFakeSearch()
    const art = new Artwork({ cacheDir: deepDir, fetchImpl: fetch })
    const path = await art.ensureCached('s', 'https://x.com/a.jpg')
    expect(existsSync(path)).toBe(true)
  })
})

// ── cachedPath ────────────────────────────────────────────────────────────────

describe('cachedPath', () => {
  it('returns undefined when not cached', () => {
    const art = new Artwork({ cacheDir: tmpDir, fetchImpl: makeFakeSearch() })
    expect(art.cachedPath('missing-slug')).toBeUndefined()
  })

  it('returns the path once the file is cached', async () => {
    const fetch = makeFakeSearch()
    const art = new Artwork({ cacheDir: join(tmpDir, 'cache'), fetchImpl: fetch })
    await art.ensureCached('slug2', 'https://x.com/b.jpg')
    expect(art.cachedPath('slug2')).toBeDefined()
    expect(art.cachedPath('slug2')).toMatch(/slug2\.jpg$/)
  })
})
