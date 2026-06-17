import { describe, it, expect } from 'vitest'
import { actionClusters } from '../src/commands.js'
import { makeCtx, type FetchFn } from '../src/api.js'
import { fmtClusters } from '../src/format.js'

const RESULT = {
  threshold: 1.5,
  clusters: [
    { id: 0, members: [{ slug: 'a', title: 'A', artist: 'K' }, { slug: 'b', title: 'B', artist: 'K' }], character: 'bass-forward, flat mids, tamed top', nearestClusterId: 1, nearestDistanceDb: 2.4 },
    { id: 1, members: [{ slug: 'c', title: 'C', artist: 'K' }], character: 'lean bass, flat mids, bright top', nearestClusterId: 0, nearestDistanceDb: 2.4 },
  ],
}

describe('fmtClusters', () => {
  it('renders cluster size, character, and the dB gap', () => {
    const s = fmtClusters(RESULT as never)
    expect(s).toContain('2 clusters')
    expect(s).toContain('2 songs')
    expect(s).toContain('2.4 dB')
  })
})

describe('actionClusters', () => {
  it('GETs /api/clusters with the threshold and prints JSON when --json', async () => {
    let calledUrl = ''
    const fetchFn: FetchFn = async (url) => {
      calledUrl = url
      return new Response(JSON.stringify(RESULT), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const logs: string[] = []
    const orig = console.log
    console.log = (m?: unknown) => { logs.push(String(m)) }
    try {
      await actionClusters(makeCtx('http://x', fetchFn), { json: true, threshold: 2 })
    } finally {
      console.log = orig
    }
    expect(calledUrl).toBe('http://x/api/clusters?threshold=2')
    expect(JSON.parse(logs[0]).clusters).toHaveLength(2)
  })
})
