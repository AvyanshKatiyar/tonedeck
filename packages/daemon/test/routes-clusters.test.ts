import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildServer } from '../src/index.js'

let server: Awaited<ReturnType<typeof buildServer>>
let tmpDir: string

beforeAll(async () => {
  // Isolated temp presets dir → store.init() seeds it from the builtins, so the
  // cluster result is deterministic and independent of the dev machine state.
  tmpDir = await mkdtemp(join(tmpdir(), 'td-clusters-'))
  server = await buildServer({ lifecycle: false, paths: { presetsDir: join(tmpDir, 'presets') } })
})

afterAll(async () => {
  await server.close()
  await rm(tmpDir, { recursive: true, force: true })
})

describe('GET /api/clusters', () => {
  it('returns clusters over the seeded presets', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/clusters' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { threshold: number; clusters: Array<{ members: unknown[] }> }
    expect(body.threshold).toBe(1.5)
    expect(Array.isArray(body.clusters)).toBe(true)
    expect(body.clusters.length).toBeGreaterThan(0)
  })

  it('honors the threshold query param', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/clusters?threshold=0.1' })
    const body = res.json() as { threshold: number }
    expect(body.threshold).toBe(0.1)
  })
})
