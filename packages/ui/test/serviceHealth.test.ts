import { describe, it, expect } from 'vitest'
import { serviceHealth } from '../src/serviceHealth.js'
import type { Status } from '../src/types.js'

const baseStatus: Status = {
  engaged: false,
  bypass: false,
  activePreset: null,
  dspState: null,
  clippedSamples: null,
  devices: { current: null, saved: null, outputs: [] },
  dspVersion: null,
  lastEvent: null,
}

describe('serviceHealth', () => {
  it('reports offline when the daemon is unreachable', () => {
    const r = serviceHealth({ phase: 'unreachable', status: null })
    expect(r.health).toBe('offline')
    expect(r.label).toBe('Offline')
  })

  it('reports standby when the daemon is up but the DSP engine is not connected', () => {
    const r = serviceHealth({ phase: 'ready', status: baseStatus })
    expect(r.health).toBe('standby')
    expect(r.label).toBe('Standby')
  })

  it('reports live when CamillaDSP is reporting a state', () => {
    const status: Status = { ...baseStatus, dspState: 'Running', dspVersion: '3.0.0' }
    const r = serviceHealth({ phase: 'ready', status })
    expect(r.health).toBe('live')
    expect(r.detail).toContain('Running')
    expect(r.detail).toContain('3.0.0')
  })

  it('treats a missing status while reachable as standby', () => {
    const r = serviceHealth({ phase: 'loading', status: null })
    expect(r.health).toBe('standby')
  })
})
