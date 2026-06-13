import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import autoPlugin from '../src/routes/auto.js'

function fakeDj() {
  return {
    mode: 'off' as string,
    arm() { this.mode = 'armed' },
    disarm() { this.mode = 'off' },
    async tick() {},
  }
}

describe('auto routes', () => {
  it('GET returns status', async () => {
    const app = Fastify()
    await app.register(autoPlugin, { autodj: fakeDj() as any, persist: async () => {} })
    const r = await app.inject({ method: 'GET', url: '/api/auto' })
    expect(r.statusCode).toBe(200)
    expect(r.json().mode).toBe('off')
  })
  it('POST {on:true} arms + persists', async () => {
    let saved: boolean | null = null
    const dj = fakeDj()
    const app = Fastify()
    await app.register(autoPlugin, { autodj: dj as any, persist: async (v: boolean) => { saved = v } })
    const r = await app.inject({ method: 'POST', url: '/api/auto', payload: { on: true } })
    expect(r.json().mode).toBe('armed')
    expect(saved).toBe(true)
  })
  it('POST without boolean on -> 422', async () => {
    const app = Fastify()
    await app.register(autoPlugin, { autodj: fakeDj() as any, persist: async () => {} })
    const r = await app.inject({ method: 'POST', url: '/api/auto', payload: {} })
    expect(r.statusCode).toBe(422)
  })
})
