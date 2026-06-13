/**
 * ws.ts — auto-reconnecting /ws hook.
 *
 * Exposes the latest live meter frame (RMS/peak dBFS + clip count) and fires an
 * `onInvalidate` callback whenever the daemon pushes a `state` or `applied`
 * event, so the store can refetch status. Reconnects with a short backoff; the
 * socket only emits meters while engaged, so silence is normal when OFF.
 */
import { useEffect, useRef, useState } from 'react'
import type { Meters, WsMessage } from './types.js'

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export function useMeters(
  onInvalidate: () => void,
  onAuto: (mode: 'off' | 'armed' | 'yielded', generating?: boolean) => void,
): { meters: Meters | null; connected: boolean } {
  const [meters, setMeters] = useState<Meters | null>(null)
  const [connected, setConnected] = useState(false)
  // Keep the latest callbacks without resubscribing the socket.
  const cb = useRef(onInvalidate)
  cb.current = onInvalidate
  const autoCb = useRef(onAuto)
  autoCb.current = onAuto

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const connect = () => {
      if (closed) return
      socket = new WebSocket(wsUrl())

      socket.onopen = () => setConnected(true)

      socket.onmessage = (ev) => {
        let msg: WsMessage
        try {
          msg = JSON.parse(ev.data as string)
        } catch {
          return
        }
        if (msg.type === 'meters') {
          setMeters({
            rms: msg.rms,
            peak: msg.peak,
            clippedSamples: msg.clippedSamples ?? 0,
          })
        } else if (msg.type === 'state' || msg.type === 'applied') {
          cb.current()
        } else if (msg.type === 'auto') {
          autoCb.current(msg.mode, msg.generating)
        }
      }

      socket.onclose = () => {
        setConnected(false)
        setMeters(null)
        if (!closed) retry = setTimeout(connect, 1500)
      }
      socket.onerror = () => socket?.close()
    }

    connect()
    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [])

  return { meters, connected }
}
