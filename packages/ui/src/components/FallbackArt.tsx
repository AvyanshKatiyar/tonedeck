/**
 * FallbackArt — deterministic dark-duotone tile for albums with no cached
 * artwork (donda-2, vultures-1, yeezus). A stable hash of the slug picks 2 of 6
 * hand-chosen muted hues; the album initials sit on top. Meant to look
 * deliberate, like a record-shop placeholder sleeve — not a broken image.
 */

// Six muted, dark "record shop at midnight" hues.
const HUES = ['#3a2f3f', '#2f3a3a', '#3f352f', '#2f3340', '#363f2f', '#3f2f33']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Two distinct hue hexes derived deterministically from a slug. */
export function duotone(slug: string): [string, string] {
  const h = hash(slug)
  const a = h % HUES.length
  const b = (a + 1 + (Math.floor(h / HUES.length) % (HUES.length - 1))) % HUES.length
  return [HUES[a], HUES[b]]
}

/** Up to two initials from a title (words → first letters, else first 2 chars). */
export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  const w = words[0] ?? '?'
  return w.slice(0, 2).toUpperCase()
}

export function FallbackArt({
  slug,
  title,
  fontSize = 28,
}: {
  slug: string
  title: string
  fontSize?: number
}) {
  const [c1, c2] = duotone(slug)
  return (
    <div
      className="fallback-art"
      aria-label={title}
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
    >
      <span className="fallback-art__initials" style={{ fontSize }}>
        {initials(title)}
      </span>
    </div>
  )
}

import { useState } from 'react'

/**
 * Album artwork that swaps to the deterministic FallbackArt tile if the cached
 * image 404s (donda-2, vultures-1, yeezus) or fails to load.
 */
export function AlbumArt({
  slug,
  title,
  src,
  fontSize = 28,
}: {
  slug: string
  title: string
  src: string
  fontSize?: number
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return <FallbackArt slug={slug} title={title} fontSize={fontSize} />
  return (
    <img
      className="album-art__img"
      src={src}
      alt={title}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
