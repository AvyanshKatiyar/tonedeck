/**
 * Typed websocket client for the CamillaDSP 4.x control API.
 *
 * Pure protocol — no preset/business knowledge. The daemon layers lifecycle and
 * routes on top of this; this file only knows how to talk JSON over a socket.
 *
 * PROTOCOL, AS VERIFIED EMPIRICALLY AGAINST CamillaDSP 4.1.3 (05e9cfc):
 *  - Request: a bare JSON string for no-arg commands (`"GetState"`), or a
 *    single-key object for commands with args (`{"SetVolume": -10.0}`).
 *  - Success: `{"<Cmd>":{"result":"Ok","value":<payload?>}}`. Commands with no
 *    return payload (SetVolume, SetMute, ResetClippedSamples, Stop, ...) omit
 *    the `value` key entirely: `{"SetVolume":{"result":"Ok"}}`.
 *  - Valid command that FAILED: `result` is NOT the bare string "Error" as some
 *    docs claim — it is an enum-tagged object, e.g.
 *      {"SetConfig":{"result":{"ConfigReadError":"..."},"value":"..."}}
 *    so we treat `result === "Ok"` as the ONLY success signal and surface
 *    everything else as a camilla_error (detail from `value`, else the result).
 *  - Unknown / malformed command: the top-level key is `"Invalid"`, NOT the
 *    command name: `{"Invalid":{"error":"unknown variant ..."}}`. Because the
 *    response key is unreliable, we match responses to requests by FIFO order
 *    (one in-flight request at a time), never by key.
 *  - CamillaDSP sends no unsolicited frames — it is pure request/response — so
 *    "next frame belongs to the head of the queue" is sound.
 *  - `ResetClippedSamples` IS supported natively in 4.1.3 (confirmed via the
 *    command enum + a live `{"result":"Ok"}`), so no client-side emulation is
 *    needed. The baseline-offset fallback contemplated by the spec is documented
 *    in resetClippedSamples() but unused on this version.
 *  - `Stop` AND `Exit` both terminate the process on 4.1.3 when launched without
 *    `--wait`/`--statefile` (the socket drops right after the Ok). Both methods
 *    therefore disable auto-reconnect and treat the ensuing disconnect as the
 *    expected outcome rather than an error.
 */
import { EventEmitter } from 'node:events'
import WebSocket from 'ws'

const BASE_BACKOFF_MS = 250
const MAX_BACKOFF_MS = 5000

export type CdspErrorKind = 'timeout' | 'disconnected' | 'camilla_error'

/** Every failure from a CdspClient method is one of these. */
export class CdspError extends Error {
  constructor(
    readonly command: string,
    readonly kind: CdspErrorKind,
    readonly detail: string,
  ) {
    super(`cdsp ${command} failed (${kind}): ${detail}`)
    this.name = 'CdspError'
  }
}

export interface CdspClientOptions {
  host?: string
  port?: number
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  reconnect?: boolean
}

interface Pending {
  command: string
  frame: string
  resolve: (value: unknown) => void
  reject: (err: CdspError) => void
  timer?: ReturnType<typeof setTimeout>
}

type ParseResult = { ok: true; value: unknown } | { ok: false; detail: string }

/** Decode one CamillaDSP response frame into success-value or error-detail. */
function parseResponse(raw: string): ParseResult {
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return { ok: false, detail: `non-JSON response: ${raw.slice(0, 200)}` }
  }
  if (!msg || typeof msg !== 'object') {
    return { ok: false, detail: `unexpected response: ${raw.slice(0, 200)}` }
  }
  const record = msg as Record<string, unknown>
  // Malformed/unknown command envelope.
  if ('Invalid' in record) {
    const body = record.Invalid as { error?: unknown } | undefined
    return { ok: false, detail: String(body?.error ?? 'invalid command') }
  }
  const key = Object.keys(record)[0]
  const body = key ? (record[key] as Record<string, unknown> | undefined) : undefined
  if (!body || typeof body !== 'object' || !('result' in body)) {
    return { ok: false, detail: `unexpected response shape: ${raw.slice(0, 200)}` }
  }
  if (body.result === 'Ok') return { ok: true, value: body.value }
  // Failure: result is "Error" (string) or an enum object like {ConfigReadError}.
  const detail =
    typeof body.value === 'string'
      ? body.value
      : typeof body.result === 'string'
        ? body.result
        : JSON.stringify(body.result)
  return { ok: false, detail }
}

export interface CdspClient {
  on(event: 'connected', listener: () => void): this
  on(event: 'disconnected', listener: (reason: string) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  once(event: 'connected', listener: () => void): this
  once(event: 'disconnected', listener: (reason: string) => void): this
  once(event: 'error', listener: (err: Error) => void): this
  off(event: 'connected', listener: () => void): this
  off(event: 'disconnected', listener: (reason: string) => void): this
  off(event: 'error', listener: (err: Error) => void): this
}

export class CdspClient extends EventEmitter {
  private readonly host: string
  private readonly port: number
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number
  private reconnect: boolean

  private ws: WebSocket | null = null
  private readonly queue: Pending[] = []
  private inflight: Pending | null = null

  private userClosing = false
  private everConnected = false
  private dropped = false
  private backoff = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: CdspClientOptions = {}) {
    super()
    this.host = opts.host ?? '127.0.0.1'
    this.port = opts.port ?? 1234
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 2000
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 3000
    this.reconnect = opts.reconnect ?? true
  }

  // --- connection lifecycle ------------------------------------------------

  get isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  /** Open the socket. Resolves on the first `open`, rejects on connect failure. */
  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve()
    this.userClosing = false
    return this.attemptConnect()
  }

  /** Resolve once connected (or immediately if already), else reject on timeout. */
  waitForConnection(timeoutMs: number = this.connectTimeoutMs): Promise<void> {
    if (this.isConnected) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('connected', onOk)
        reject(new CdspError('connect', 'timeout', `not connected within ${timeoutMs}ms`))
      }, timeoutMs)
      const onOk = () => {
        clearTimeout(timer)
        resolve()
      }
      this.once('connected', onOk)
    })
  }

  /** Close deliberately: cancels reconnect and rejects every pending request. */
  async close(): Promise<void> {
    this.userClosing = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) this.ws.terminate()
    else this.handleDrop('client closed')
  }

  private attemptConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.dropped = false
      let ws: WebSocket
      try {
        ws = new WebSocket(`ws://${this.host}:${this.port}`)
      } catch (err) {
        reject(new CdspError('connect', 'disconnected', (err as Error).message))
        return
      }
      this.ws = ws
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(
          new CdspError('connect', 'timeout', `connect timed out after ${this.connectTimeoutMs}ms`),
        )
        ws.terminate()
      }, this.connectTimeoutMs)

      ws.on('open', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.everConnected = true
        this.backoff = 0
        this.emit('connected')
        this.pump()
        resolve()
      })
      ws.on('message', (data: WebSocket.RawData) => this.onMessage(data.toString()))
      ws.on('error', (err: Error) => {
        this.emitError(err)
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new CdspError('connect', 'disconnected', err.message))
        }
      })
      ws.on('close', () => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(new CdspError('connect', 'disconnected', 'socket closed before open'))
        }
        this.handleDrop('socket closed')
      })
    })
  }

  /** Tear down + (maybe) reconnect: rejects all in-flight/queued requests loudly. */
  private handleDrop(reason: string): void {
    if (this.dropped) return
    this.dropped = true
    this.ws = null

    if (this.inflight) {
      const p = this.inflight
      this.inflight = null
      if (p.timer) clearTimeout(p.timer)
      p.reject(new CdspError(p.command, 'disconnected', `socket dropped: ${reason}`))
    }
    const queued = this.queue.splice(0)
    for (const p of queued) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new CdspError(p.command, 'disconnected', `socket dropped before send: ${reason}`))
    }

    this.emit('disconnected', reason)

    if (this.reconnect && !this.userClosing && this.everConnected) this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.userClosing) return
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.backoff)
    this.backoff += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      // On failure, the socket's own close handler re-schedules via handleDrop.
      this.attemptConnect().catch(() => {})
    }, delay)
  }

  // --- request plumbing ----------------------------------------------------

  private request(command: string, payload?: object): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (this.userClosing) {
        reject(new CdspError(command, 'disconnected', 'client is closing'))
        return
      }
      const frame = JSON.stringify(payload ?? command)
      const p: Pending = { command, frame, resolve, reject }
      p.timer = setTimeout(() => this.onTimeout(p), this.requestTimeoutMs)
      this.queue.push(p)
      this.pump()
    })
  }

  private pump(): void {
    if (this.inflight || !this.isConnected) return
    const next = this.queue.shift()
    if (!next) return
    this.inflight = next
    try {
      this.ws!.send(next.frame)
    } catch (err) {
      this.inflight = null
      if (next.timer) clearTimeout(next.timer)
      next.reject(new CdspError(next.command, 'disconnected', `send failed: ${(err as Error).message}`))
      this.handleDrop('send failed')
    }
  }

  private onMessage(raw: string): void {
    const cur = this.inflight
    // CamillaDSP never pushes unsolicited frames; a stray one would desync FIFO,
    // so we ignore anything that arrives with no request in flight.
    if (!cur) return
    if (cur.timer) clearTimeout(cur.timer)
    this.inflight = null
    const parsed = parseResponse(raw)
    if (parsed.ok) cur.resolve(parsed.value)
    else cur.reject(new CdspError(cur.command, 'camilla_error', parsed.detail))
    this.pump()
  }

  private onTimeout(p: Pending): void {
    if (this.inflight === p) {
      // A timed-out in-flight request leaves frame alignment uncertain (a late
      // reply would mis-match the next request), so we resync by dropping the
      // socket — which rejects the rest of the queue and triggers reconnect.
      this.inflight = null
      p.reject(new CdspError(p.command, 'timeout', `no response within ${this.requestTimeoutMs}ms`))
      if (this.ws) this.ws.terminate()
      else this.handleDrop(`request '${p.command}' timed out`)
    } else {
      const i = this.queue.indexOf(p)
      if (i >= 0) this.queue.splice(i, 1)
      p.reject(
        new CdspError(p.command, 'timeout', `timed out while queued after ${this.requestTimeoutMs}ms`),
      )
    }
  }

  private emitError(err: Error): void {
    // EventEmitter throws on an unheard 'error' event — guard so a socket error
    // with no listener never crashes the host process.
    if (this.listenerCount('error') > 0) this.emit('error', err)
  }

  // --- typed value coercion ------------------------------------------------

  private async requestString(command: string): Promise<string> {
    const v = await this.request(command)
    if (typeof v !== 'string') {
      throw new CdspError(command, 'camilla_error', `expected string, got ${typeof v}`)
    }
    return v
  }

  private async requestNumber(command: string): Promise<number> {
    const v = await this.request(command)
    if (typeof v !== 'number') {
      throw new CdspError(command, 'camilla_error', `expected number, got ${typeof v}`)
    }
    return v
  }

  private async requestNumberArray(command: string): Promise<number[]> {
    const v = await this.request(command)
    if (!Array.isArray(v) || !v.every((n) => typeof n === 'number')) {
      throw new CdspError(command, 'camilla_error', `expected number[], got ${JSON.stringify(v)?.slice(0, 80)}`)
    }
    return v as number[]
  }

  private async requestBool(command: string): Promise<boolean> {
    const v = await this.request(command)
    if (typeof v !== 'boolean') {
      throw new CdspError(command, 'camilla_error', `expected boolean, got ${typeof v}`)
    }
    return v
  }

  // --- typed commands ------------------------------------------------------

  getState(): Promise<string> {
    return this.requestString('GetState')
  }

  getVersion(): Promise<string> {
    return this.requestString('GetVersion')
  }

  /** Returns the active config as a YAML string. */
  getConfig(): Promise<string> {
    return this.requestString('GetConfig')
  }

  async setConfig(yaml: string): Promise<void> {
    await this.request('SetConfig', { SetConfig: yaml })
  }

  /** Returns the normalized YAML on success; throws camilla_error if invalid. */
  async validateConfig(yaml: string): Promise<string> {
    const v = await this.request('ValidateConfig', { ValidateConfig: yaml })
    return typeof v === 'string' ? v : ''
  }

  getPlaybackSignalRms(): Promise<number[]> {
    return this.requestNumberArray('GetPlaybackSignalRms')
  }

  getPlaybackSignalPeak(): Promise<number[]> {
    return this.requestNumberArray('GetPlaybackSignalPeak')
  }

  getClippedSamples(): Promise<number> {
    return this.requestNumber('GetClippedSamples')
  }

  /**
   * Native on 4.1.3 (no emulation needed — verified live). If a future build
   * dropped the command, the fallback would be to snapshot getClippedSamples()
   * as a client-side baseline and subtract it from subsequent reads; that path
   * is intentionally not wired because the real command works.
   */
  async resetClippedSamples(): Promise<void> {
    await this.request('ResetClippedSamples')
  }

  getBufferLevel(): Promise<number> {
    return this.requestNumber('GetBufferLevel')
  }

  getVolume(): Promise<number> {
    return this.requestNumber('GetVolume')
  }

  async setVolume(db: number): Promise<void> {
    await this.request('SetVolume', { SetVolume: db })
  }

  getMute(): Promise<boolean> {
    return this.requestBool('GetMute')
  }

  async setMute(muted: boolean): Promise<void> {
    await this.request('SetMute', { SetMute: muted })
  }

  /** Stop processing. NOTE: on 4.1.3 (no --wait) this also exits the process. */
  async stop(): Promise<void> {
    await this.terminatingCommand('Stop')
  }

  /** Shut CamillaDSP down. The socket drops right after; that is expected here. */
  async exit(): Promise<void> {
    await this.terminatingCommand('Exit')
  }

  private async terminatingCommand(command: string): Promise<void> {
    this.reconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      await this.request(command)
    } catch (err) {
      // The process going away (disconnect) or not acking before it dies
      // (timeout) is the success case for a shutdown command.
      if (err instanceof CdspError && (err.kind === 'disconnected' || err.kind === 'timeout')) return
      throw err
    }
  }
}
