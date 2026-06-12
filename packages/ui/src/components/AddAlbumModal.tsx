/**
 * AddAlbumModal — search iTunes (debounced 400ms), pick a result, confirm an
 * editable slug, and POST a starter preset built from the profile's band
 * template (flat gains, preamp 2). On success the card appears and a toast
 * nudges the user to ask Claude Code to tune it.
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { useStore } from '../store.js'
import type { ArtworkResult, Preset } from '../types.js'

/** Title → safe slug matching the preset schema (^[a-z0-9][a-z0-9-]*$, ≤64). */
export function kebab(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
      .replace(/-+$/g, '') || 'album'
  )
}

export function AddAlbumModal() {
  const { state, actions } = useStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ArtworkResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<ArtworkResult | null>(null)
  const [slug, setSlug] = useState('')
  const [creating, setCreating] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!query.trim()) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    timer.current = setTimeout(async () => {
      try {
        setResults(await api.searchArtwork(query))
      } catch (e) {
        actions.toast(e instanceof Error ? e.message : 'search failed', 'error')
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query, actions])

  const pick = (r: ArtworkResult) => {
    setSelected(r)
    setSlug(kebab(r.collectionName))
  }

  const create = async () => {
    if (!selected || !state.profile) return
    setCreating(true)
    const now = new Date().toISOString()
    const preset: Preset = {
      schemaVersion: 1,
      slug,
      kind: 'album',
      title: selected.collectionName,
      artist: selected.artistName,
      profile: state.profile.id,
      preamp: 2,
      bands: state.profile.bandTemplate.map((b) => ({ ...b, gain: 0 })),
      intent: 'starter preset — ask Claude to tune it',
      provenance: { createdBy: 'user', history: [] },
      artwork: { itunesCollectionId: selected.collectionId, url: selected.artworkUrl600 },
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await api.create(preset)
      await actions.refreshPresets()
      actions.toast(`Now ask Claude Code: "tune ${selected.collectionName} for my headphones"`, 'info')
      close()
    } catch (e) {
      actions.toast(e instanceof Error ? e.message : 'create failed', 'error')
    } finally {
      setCreating(false)
    }
  }

  const close = () => {
    setQuery('')
    setResults([])
    setSelected(null)
    setSlug('')
    actions.setAddOpen(false)
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-label="Add an album" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <h2>Add an album</h2>
          <button type="button" className="drawer__close" onClick={close} aria-label="Close">
            ×
          </button>
        </header>

        {!selected ? (
          <>
            <input
              className="modal__search"
              type="text"
              autoFocus
              placeholder="Search albums — e.g. 'Frank Ocean Blonde'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="modal__results">
              {searching && <div className="modal__hint">Searching…</div>}
              {!searching && query.trim() && results.length === 0 && (
                <div className="modal__hint">No matches.</div>
              )}
              {results.map((r) => (
                <button type="button" key={r.collectionId} className="result-row" onClick={() => pick(r)}>
                  <img className="result-row__art" src={r.artworkUrl100} alt="" draggable={false} />
                  <span className="result-row__meta">
                    <span className="result-row__album">{r.collectionName}</span>
                    <span className="result-row__artist">{r.artistName}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="modal__confirm">
            <div className="modal__picked">
              <img className="result-row__art" src={selected.artworkUrl600} alt="" draggable={false} />
              <div>
                <div className="result-row__album">{selected.collectionName}</div>
                <div className="result-row__artist">{selected.artistName}</div>
              </div>
            </div>
            <label className="modal__slug">
              Slug
              <input type="text" value={slug} onChange={(e) => setSlug(kebab(e.target.value))} />
            </label>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                Back
              </button>
              <button type="button" className="btn btn--primary" disabled={creating || !slug} onClick={create}>
                {creating ? 'Creating…' : 'Create starter preset'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
