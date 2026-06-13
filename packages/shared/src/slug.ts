/** Deterministic preset slug from arbitrary parts. Matches PresetSchema's
 *  /^[a-z0-9][a-z0-9-]*$/ rule. Empty/garbage inputs collapse safely. */
export function slugify(...parts: Array<string | undefined | null>): string {
  const raw = parts.filter(Boolean).join(' ')
  const s = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks (U+0300-U+036F)
    .replace(/['‘’‛ʼ]/g, '') // strip apostrophes/curly-quotes (merges word parts)
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumerics -> hyphen
    .replace(/^-+|-+$/g, '') // trim edge hyphens
    .replace(/-{2,}/g, '-') // safety net — the non-alphanumeric replace already collapses runs
    .slice(0, 64)
  return s.replace(/^-+|-+$/g, '') || 'preset'
}
