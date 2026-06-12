#!/usr/bin/env node
import { Command } from 'commander'

const program = new Command()

program
  .name('tonedeck')
  .description('Per-album EQ for macOS via CamillaDSP')
  .version('0.1.0')

program
  .command('health')
  .description('Check daemon health (daemon must be running on 127.0.0.1:5056)')
  .action(async () => {
    try {
      const res = await fetch('http://127.0.0.1:5056/api/health')
      if (!res.ok) {
        console.error(`Daemon returned HTTP ${res.status}`)
        process.exit(1)
      }
      const data: unknown = await res.json()
      console.log(JSON.stringify(data, null, 2))
    } catch (err) {
      console.error('Daemon unreachable:', (err as Error).message)
      process.exit(1)
    }
  })

program.parse()
