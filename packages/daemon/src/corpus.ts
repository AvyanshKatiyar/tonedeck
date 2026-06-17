/**
 * Resumable, bounded-concurrency bulk EQ generation. Pure orchestration: all IO
 * (generation, storage, "what already exists") is injected, so this is fully
 * unit-tested without the daemon, claude, or the network. The script
 * scripts/corpus-build.ts wires the real deps.
 */
import type { Preset } from '@tonedeck/shared'

export interface CorpusItem {
  title: string
  artist: string
  album?: string
  /** The preset slug this item will be stored under (slugify(artist, title)). */
  slug: string
}

export interface CorpusProgress {
  done: number
  total: number
  slug: string
  status: 'generated' | 'failed'
  error?: string
}

export interface CorpusBuildOpts {
  items: CorpusItem[]
  /** Slugs already present — these are skipped (resumability). */
  existing: Set<string>
  generate: (item: CorpusItem) => Promise<Preset>
  save: (preset: Preset) => Promise<void>
  concurrency?: number
  onProgress?: (p: CorpusProgress) => void
}

export interface CorpusBuildResult {
  generated: number
  skipped: number
  failed: Array<{ slug: string; error: string }>
}

export async function runCorpusBuild(opts: CorpusBuildOpts): Promise<CorpusBuildResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  const queue = opts.items.filter((it) => !opts.existing.has(it.slug))
  const result: CorpusBuildResult = {
    generated: 0,
    skipped: opts.items.length - queue.length,
    failed: [],
  }
  const total = opts.items.length
  let done = result.skipped
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= queue.length) return
      const item = queue[i]
      try {
        const preset = await opts.generate(item)
        await opts.save(preset)
        result.generated++
        done++
        opts.onProgress?.({ done, total, slug: item.slug, status: 'generated' })
      } catch (e) {
        const error = (e as Error).message
        result.failed.push({ slug: item.slug, error })
        done++
        opts.onProgress?.({ done, total, slug: item.slug, status: 'failed', error })
      }
    }
  }

  const n = Math.min(concurrency, queue.length) || 0
  await Promise.all(Array.from({ length: n }, () => worker()))
  return result
}
