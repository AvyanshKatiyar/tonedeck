/** Read/write the song catalog at ~/.tonedeck/catalog.json, merging on write. */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mergeCatalog, CatalogEntrySchema, type CatalogEntry } from '@tonedeck/shared'

export const CATALOG_PATH = join(homedir(), '.tonedeck', 'catalog.json')

export async function readCatalog(path = CATALOG_PATH): Promise<CatalogEntry[]> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    const arr = JSON.parse(raw) as unknown[]
    return arr.map((e) => CatalogEntrySchema.parse(e))
  } catch {
    return []
  }
}

/** Merge `incoming` into the on-disk catalog and write it back atomically. */
export async function addToCatalog(
  incoming: CatalogEntry[],
  path = CATALOG_PATH,
): Promise<CatalogEntry[]> {
  const existing = await readCatalog(path)
  const merged = mergeCatalog(existing, incoming)
  await fs.mkdir(join(homedir(), '.tonedeck'), { recursive: true })
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, path)
  return merged
}
