/**
 * MeterBroadcaster — pushes live CamillaDSP signal meters to ws clients.
 *
 * Polling is strictly demand-driven: the interval only runs while there is at
 * least one connected socket, and inside each tick we only query CamillaDSP
 * when the lifecycle is engaged AND the cdsp client is connected. Poll errors
 * are swallowed — the lifecycle watchdog owns failure handling; the meter loop
 * is a best-effort read.
 *
 * It also relays the lifecycle's own 'state' and 'applied' events to every
 * socket, so a UI gets engage/apply/bypass changes on the same channel.
 */
import type { CdspLike } from './lifecycle.js'

/** The subset of a ws socket we use (so tests can pass plain fakes). */
export interface MeterSocket {
  readyState: number
  send(data: string): void
  on(event: 'close' | 'error', listener: () => void): unknown
}

/** The subset of Lifecycle MeterBroadcaster reads. */
export interface MeterLifecycle {
  readonly engaged: boolean
  readonly cdsp: CdspLike | null
  on(event: 'state' | 'applied', listener: (payload: unknown) => void): unknown
}

export interface MeterBroadcasterOpts {
  lifecycle: MeterLifecycle
  intervalMs?: number
}

export interface MeterMessage {
  type: 'meters'
  rms: number[]
  peak: number[]
  clippedSamples?: number
}

/** ws readyState OPEN. */
const WS_OPEN = 1

export class MeterBroadcaster {
  private readonly lifecycle: MeterLifecycle
  private readonly intervalMs: number
  private readonly sockets = new Set<MeterSocket>()
  private timer: ReturnType<typeof setInterval> | null = null
  private tick = 0

  constructor(opts: MeterBroadcasterOpts) {
    this.lifecycle = opts.lifecycle
    this.intervalMs = opts.intervalMs ?? 100
    this.lifecycle.on('state', (payload) => this._relay('state', payload))
    this.lifecycle.on('applied', (payload) => this._relay('applied', payload))
  }

  /** Register a socket and start polling if this is the first one. */
  addSocket(socket: MeterSocket): void {
    this.sockets.add(socket)
    const remove = (): void => this.removeSocket(socket)
    socket.on('close', remove)
    socket.on('error', remove)
    this._maybeStart()
  }

  removeSocket(socket: MeterSocket): void {
    this.sockets.delete(socket)
    if (this.sockets.size === 0) this._stop()
  }

  get socketCount(): number {
    return this.sockets.size
  }

  get polling(): boolean {
    return this.timer !== null
  }

  /** Stop the timer and forget all sockets (daemon shutdown / tests). */
  close(): void {
    this._stop()
    this.sockets.clear()
  }

  private _maybeStart(): void {
    if (this.timer || this.sockets.size === 0) return
    this.tick = 0
    this.timer = setInterval(() => {
      void this._poll()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  private _stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async _poll(): Promise<void> {
    if (this.sockets.size === 0) {
      this._stop()
      return
    }
    const client = this.lifecycle.cdsp
    if (!this.lifecycle.engaged || !client || !client.isConnected) return
    try {
      const rms = await client.getPlaybackSignalRms()
      const peak = await client.getPlaybackSignalPeak()
      const msg: MeterMessage = { type: 'meters', rms, peak }
      if (this.tick % 10 === 0) {
        msg.clippedSamples = await client.getClippedSamples()
      }
      this.tick++
      this._broadcast(msg)
    } catch {
      // Watchdog owns failure handling; meters are best-effort.
    }
  }

  private _relay(type: 'state' | 'applied', payload: unknown): void {
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    this._broadcast({ type, ...body })
  }

  private _broadcast(msg: object): void {
    const data = JSON.stringify(msg)
    for (const socket of this.sockets) {
      try {
        if (socket.readyState === WS_OPEN) socket.send(data)
      } catch {
        // A dead socket shouldn't break the broadcast to the others.
      }
    }
  }
}
