/**
 * Unit tests for CdspClient against an in-process mock CamillaDSP websocket
 * server (the `ws` package) — no real camilladsp binary required.
 *
 * The mock mirrors the 4.1.3 frame shapes discovered during smoke development:
 *  - success: {"<Cmd>":{"result":"Ok","value":...}}  (value omitted when none)
 *  - failure: {"<Cmd>":{"result":{"ConfigReadError":"..."},"value":"..."}}
 *  - invalid: {"Invalid":{"error":"..."}}
 */
import { afterEach, describe, expect, it } from 'vitest'
import { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket as WS } from 'ws'
import { CdspClient, CdspError } from '../src/cdsp.js'

type Handler = (cmd: string, payload: unknown, socket: WS) => unknown | 'NO_REPLY'

/** Spin up a mock server. `handler` returns the value for a command, the
 * sentinel 'NO_REPLY' to stay silent (to exercise timeouts), or an object
 * {__error} / {__invalid} to force the failure envelopes. */
async function startMock(handler: Handler): Promise<{ wss: WebSocketServer; port: number }> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
  wss.on('connection', (socket) => {
    socket.on('message', (data) => {
      const parsed = JSON.parse(data.toString())
      const cmd = typeof parsed === 'string' ? parsed : Object.keys(parsed)[0]
      const arg = typeof parsed === 'string' ? undefined : parsed[cmd]
      const out = handler(cmd, arg, socket)
      if (out === 'NO_REPLY') return
      if (out && typeof out === 'object' && '__invalid' in out) {
        socket.send(JSON.stringify({ Invalid: { error: (out as { __invalid: string }).__invalid } }))
        return
      }
      if (out && typeof out === 'object' && '__error' in out) {
        const e = out as { __error: string }
        socket.send(JSON.stringify({ [cmd]: { result: { ConfigReadError: e.__error }, value: e.__error } }))
        return
      }
      const body: Record<string, unknown> = { result: 'Ok' }
      if (out !== undefined) body.value = out
      socket.send(JSON.stringify({ [cmd]: body }))
    })
  })
  const port = (wss.address() as AddressInfo).port
  return { wss, port }
}

const servers: WebSocketServer[] = []
const clients: CdspClient[] = []
function track<T extends WebSocketServer | CdspClient>(x: T): T {
  if (x instanceof WebSocketServer) servers.push(x)
  else clients.push(x)
  return x
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {})
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()))
})

describe('CdspClient request/response', () => {
  it('matches a response to its request and decodes the value', async () => {
    const { wss, port } = await startMock((cmd) => (cmd === 'GetVersion' ? '4.1.3' : 'Running'))
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false }))
    await client.connect()
    expect(await client.getVersion()).toBe('4.1.3')
    expect(await client.getState()).toBe('Running')
  })

  it('decodes typed numbers, arrays and booleans', async () => {
    const { wss, port } = await startMock((cmd) => {
      switch (cmd) {
        case 'GetPlaybackSignalRms':
          return [-23.0, -23.0]
        case 'GetClippedSamples':
          return 7
        case 'GetMute':
          return true
        default:
          return undefined
      }
    })
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false }))
    await client.connect()
    expect(await client.getPlaybackSignalRms()).toEqual([-23.0, -23.0])
    expect(await client.getClippedSamples()).toBe(7)
    expect(await client.getMute()).toBe(true)
  })

  it('sends arg commands as single-key objects and resolves void on Ok', async () => {
    const seen: Array<{ cmd: string; arg: unknown }> = []
    const { wss, port } = await startMock((cmd, arg) => {
      seen.push({ cmd, arg })
      return undefined // {"<Cmd>":{"result":"Ok"}} — no value
    })
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false }))
    await client.connect()
    await expect(client.setVolume(-10)).resolves.toBeUndefined()
    await expect(client.setMute(true)).resolves.toBeUndefined()
    expect(seen).toEqual([
      { cmd: 'SetVolume', arg: -10 },
      { cmd: 'SetMute', arg: true },
    ])
  })
})

describe('CdspClient FIFO serialization', () => {
  it('serializes two concurrent calls in order (one in flight at a time)', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const order: string[] = []
    const { wss, port } = await startMock((cmd, _arg, socket) => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      // Reply after a delay; finishing the FIRST later than the second is sent
      // would break FIFO if the client didn't serialize.
      const delay = cmd === 'GetVersion' ? 60 : 10
      setTimeout(() => {
        concurrent -= 1
        order.push(cmd)
        socket.send(JSON.stringify({ [cmd]: { result: 'Ok', value: cmd } }))
      }, delay)
      return 'NO_REPLY'
    })
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false }))
    await client.connect()
    const [a, b] = await Promise.all([client.getVersion(), client.getState()])
    expect(a).toBe('GetVersion')
    expect(b).toBe('GetState')
    expect(maxConcurrent).toBe(1)
    expect(order).toEqual(['GetVersion', 'GetState'])
  })
})

describe('CdspClient error surfacing', () => {
  it('surfaces a camilla_error from a failed-result envelope', async () => {
    const { wss, port } = await startMock(() => ({ __error: 'unknown field `nonsense`' }))
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false }))
    await client.connect()
    await expect(client.setConfig('nonsense: true')).rejects.toMatchObject({
      name: 'CdspError',
      kind: 'camilla_error',
      command: 'SetConfig',
    })
    await expect(client.setConfig('nonsense: true')).rejects.toThrow(/unknown field/)
  })

  it('surfaces a camilla_error from the {"Invalid"} envelope', async () => {
    const { wss, port } = await startMock(() => ({ __invalid: 'unknown variant `Bogus`' }))
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false }))
    await client.connect()
    await expect(client.getState()).rejects.toMatchObject({ kind: 'camilla_error' })
    await expect(client.getState()).rejects.toThrow(/unknown variant/)
  })
})

describe('CdspClient timeout', () => {
  it('rejects with kind=timeout when the server never replies', async () => {
    const { wss, port } = await startMock(() => 'NO_REPLY')
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false, requestTimeoutMs: 120 }))
    await client.connect()
    const err = await client.getState().catch((e) => e)
    expect(err).toBeInstanceOf(CdspError)
    expect(err.kind).toBe('timeout')
    expect(err.command).toBe('GetState')
  })
})

describe('CdspClient disconnect queue flush', () => {
  it('rejects in-flight and queued requests loudly on socket drop', async () => {
    const sockets: WS[] = []
    const { wss, port } = await startMock((_cmd, _arg, socket) => {
      sockets.push(socket)
      return 'NO_REPLY' // hold the requests so they are pending when we drop
    })
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false, requestTimeoutMs: 5000 }))
    await client.connect()
    const p1 = client.getState().catch((e) => e)
    const p2 = client.getVersion().catch((e) => e)
    // Wait until the server has at least the first request in flight.
    await new Promise((r) => setTimeout(r, 40))
    for (const s of sockets) s.terminate()
    const [e1, e2] = await Promise.all([p1, p2])
    expect(e1).toBeInstanceOf(CdspError)
    expect(e1.kind).toBe('disconnected')
    expect(e2).toBeInstanceOf(CdspError)
    expect(e2.kind).toBe('disconnected')
  })

  it('emits a disconnected event when the socket drops', async () => {
    const sockets: WS[] = []
    const { wss, port } = await startMock((_c, _a, s) => {
      sockets.push(s)
      return 'Running'
    })
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false }))
    const seen = new Promise<string>((resolve) => client.once('disconnected', resolve))
    await client.connect()
    await client.getState()
    for (const s of sockets) s.terminate()
    await expect(seen).resolves.toBeTypeOf('string')
    expect(client.isConnected).toBe(false)
  })
})

describe('CdspClient reconnect', () => {
  it('auto-reconnects after a drop and serves requests again', async () => {
    const first = await startMock(() => 'Running')
    track(first.wss)
    const port = first.port
    const client = track(new CdspClient({ port, reconnect: true, connectTimeoutMs: 1000 }))
    const reconnected = new Promise<void>((resolve) => {
      let n = 0
      client.on('connected', () => {
        n += 1
        if (n === 2) resolve()
      })
    })
    await client.connect()
    expect(await client.getState()).toBe('Running')

    // Kill the whole server (terminate live sockets first so close() can settle),
    // then bring an identical one back on the same port.
    for (const s of first.wss.clients) s.terminate()
    await new Promise<void>((r) => first.wss.close(() => r()))

    await new Promise((r) => setTimeout(r, 150))
    const second = new WebSocketServer({ host: '127.0.0.1', port })
    track(second)
    await new Promise<void>((r) => second.once('listening', () => r()))
    second.on('connection', (socket) => {
      socket.on('message', (data) => {
        const cmd = JSON.parse(data.toString())
        socket.send(JSON.stringify({ [cmd]: { result: 'Ok', value: 'Running' } }))
      })
    })

    await reconnected
    expect(client.isConnected).toBe(true)
    expect(await client.getState()).toBe('Running')
  })
})

describe('CdspClient connect/wait helpers', () => {
  it('waitForConnection resolves immediately when already connected', async () => {
    const { wss, port } = await startMock(() => 'Running')
    track(wss)
    const client = track(new CdspClient({ port, reconnect: false }))
    await client.connect()
    await expect(client.waitForConnection(50)).resolves.toBeUndefined()
  })

  it('connect rejects with a timeout when nothing is listening', async () => {
    // Port 1 is privileged/unused — connection should fail fast.
    const client = track(new CdspClient({ port: 1, reconnect: false, connectTimeoutMs: 300 }))
    await expect(client.connect()).rejects.toBeInstanceOf(CdspError)
  })
})
