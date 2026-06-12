// NOTE: This placeholder daemon binds port 5056 deliberately.
// Port 5055 belongs to the legacy CamillaDSP switcher until cutover;
// tonedeck will take over 5055 as part of the production migration (task K).

import { VERSION } from '@tonedeck/shared'
import Fastify from 'fastify'
import { fileURLToPath } from 'url'
import { resolve } from 'path'

export async function buildServer() {
  const server = Fastify({ logger: false })

  server.get('/api/health', async () => {
    return { ok: true, version: VERSION }
  })

  return server
}

// Only bind when executed directly — not when imported by tests or other packages.
const isMain =
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')

if (isMain) {
  const server = await buildServer()
  await server.listen({ host: '127.0.0.1', port: 5056 })
  console.log(`tonedeck daemon listening on http://127.0.0.1:5056`)
}
