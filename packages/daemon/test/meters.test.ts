/**
 * Unit tests for MeterBroadcaster with a fake lifecycle, fake cdsp client and
 * fake ws sockets. Fake timers make the polling cadence deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { MeterBroadcaster, type MeterSocket, type MeterLifecycle } from '../src/meters.js'
import type { CdspLike } from '../src/lifecycle.js'

class FakeSocket implements MeterSocket {
  readyState = 1
  sent: string[] = []
  private handlers: Record<string, () => void> = {}
  send(data: string): void {
    this.sent.push(data)
  }
  on(event: 'close' | 'error', listener: () => void): this {
    this.handlers[event] = listener
    return this
  }
  triggerClose(): void {
    this.handlers.close?.()
  }
  messages(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>)
  }
}

class FakeClient implements CdspLike {
  isConnected = true
  rmsCalls = 0
  peakCalls = 0
  clippedCalls = 0
  throwOnRms = false
  async connect(): Promise<void> {}
  async getState(): Promise<string> {
    return 'Running'
  }
  async getVersion(): Promise<string> {
    return '4.1.3'
  }
  async getConfig(): Promise<string> {
    return ''
  }
  async setConfig(): Promise<void> {}
  async resetClippedSamples(): Promise<void> {}
  async getClippedSamples(): Promise<number> {
    this.clippedCalls++
    return 42
  }
  async getPlaybackSignalRms(): Promise<number[]> {
    this.rmsCalls++
    if (this.throwOnRms) throw new Error('boom')
    return [-20, -21]
  }
  async getPlaybackSignalPeak(): Promise<number[]> {
    this.peakCalls++
    return [-10, -11]
  }
  async exit(): Promise<void> {}
  async close(): Promise<void> {}
}

class FakeLifecycle extends EventEmitter implements MeterLifecycle {
  engaged = false
  cdsp: CdspLike | null = null
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('MeterBroadcaster polling gates', () => {
  it('does not poll until a socket is added', () => {
    const lc = new FakeLifecycle()
    lc.engaged = true
    lc.cdsp = new FakeClient()
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 100 })
    expect(mb.polling).toBe(false)
  })

  it('polls when socket present + engaged + connected; emits meter frames', async () => {
    const lc = new FakeLifecycle()
    const client = new FakeClient()
    lc.engaged = true
    lc.cdsp = client
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 100 })
    const sock = new FakeSocket()
    mb.addSocket(sock)
    expect(mb.polling).toBe(true)

    await vi.advanceTimersByTimeAsync(350) // ~3 ticks
    const meters = sock.messages().filter((m) => m.type === 'meters')
    expect(meters.length).toBeGreaterThanOrEqual(3)
    expect(meters[0]).toMatchObject({ type: 'meters', rms: [-20, -21], peak: [-10, -11] })
    mb.close()
  })

  it('does NOT query cdsp while not engaged (timer runs, no meter frames)', async () => {
    const lc = new FakeLifecycle()
    const client = new FakeClient()
    lc.engaged = false // not engaged
    lc.cdsp = client
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 50 })
    const sock = new FakeSocket()
    mb.addSocket(sock)

    await vi.advanceTimersByTimeAsync(300)
    expect(client.rmsCalls).toBe(0)
    expect(sock.messages().filter((m) => m.type === 'meters')).toHaveLength(0)

    // Now engage: frames start flowing.
    lc.engaged = true
    await vi.advanceTimersByTimeAsync(150)
    expect(client.rmsCalls).toBeGreaterThan(0)
    mb.close()
  })

  it('does not query cdsp when the client is disconnected', async () => {
    const lc = new FakeLifecycle()
    const client = new FakeClient()
    client.isConnected = false
    lc.engaged = true
    lc.cdsp = client
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 50 })
    mb.addSocket(new FakeSocket())
    await vi.advanceTimersByTimeAsync(200)
    expect(client.rmsCalls).toBe(0)
    mb.close()
  })
})

describe('MeterBroadcaster cadence', () => {
  it('reads clipped samples every 10th tick', async () => {
    const lc = new FakeLifecycle()
    const client = new FakeClient()
    lc.engaged = true
    lc.cdsp = client
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 100 })
    mb.addSocket(new FakeSocket())

    await vi.advanceTimersByTimeAsync(100 * 21 + 10) // ~21 ticks (0..20)
    expect(client.rmsCalls).toBe(21)
    // clipped at ticks 0, 10, 20 → 3 reads.
    expect(client.clippedCalls).toBe(3)
    mb.close()
  })

  it('meter frame includes clippedSamples only on the 10th-tick frame', async () => {
    const lc = new FakeLifecycle()
    const client = new FakeClient()
    lc.engaged = true
    lc.cdsp = client
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 100 })
    const sock = new FakeSocket()
    mb.addSocket(sock)

    await vi.advanceTimersByTimeAsync(100 * 11 + 10)
    const meters = sock.messages().filter((m) => m.type === 'meters')
    const withClip = meters.filter((m) => 'clippedSamples' in m)
    expect(withClip.length).toBe(2) // ticks 0 and 10
    expect(withClip[0].clippedSamples).toBe(42)
    mb.close()
  })
})

describe('MeterBroadcaster socket lifecycle', () => {
  it('stops polling when the last socket closes', async () => {
    const lc = new FakeLifecycle()
    lc.engaged = true
    lc.cdsp = new FakeClient()
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 50 })
    const sock = new FakeSocket()
    mb.addSocket(sock)
    expect(mb.polling).toBe(true)

    sock.triggerClose() // socket closed
    expect(mb.socketCount).toBe(0)
    expect(mb.polling).toBe(false)
  })

  it('swallows poll errors without crashing or sending', async () => {
    const lc = new FakeLifecycle()
    const client = new FakeClient()
    client.throwOnRms = true
    lc.engaged = true
    lc.cdsp = client
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 50 })
    const sock = new FakeSocket()
    mb.addSocket(sock)

    await vi.advanceTimersByTimeAsync(200)
    expect(client.rmsCalls).toBeGreaterThan(0)
    expect(sock.messages().filter((m) => m.type === 'meters')).toHaveLength(0)
    expect(mb.polling).toBe(true) // still alive
    mb.close()
  })
})

describe('MeterBroadcaster event relay', () => {
  it("relays lifecycle 'state' and 'applied' to sockets", () => {
    const lc = new FakeLifecycle()
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 1000 })
    const sock = new FakeSocket()
    mb.addSocket(sock)

    lc.emit('state', { engaged: true, bypass: false, activePreset: 'mbdtf', lastEvent: 'engaged' })
    lc.emit('applied', { slug: 'yeezus' })

    const msgs = sock.messages()
    expect(msgs).toContainEqual({
      type: 'state',
      engaged: true,
      bypass: false,
      activePreset: 'mbdtf',
      lastEvent: 'engaged',
    })
    expect(msgs).toContainEqual({ type: 'applied', slug: 'yeezus' })
    mb.close()
  })

  it('does not send to a socket that is not OPEN', () => {
    const lc = new FakeLifecycle()
    const mb = new MeterBroadcaster({ lifecycle: lc, intervalMs: 1000 })
    const sock = new FakeSocket()
    sock.readyState = 3 // CLOSED
    mb.addSocket(sock)
    lc.emit('applied', { slug: 'x' })
    expect(sock.sent).toHaveLength(0)
    mb.close()
  })
})
