/**
 * LibraryGrid — the preset library: a toolbar (search + kind filter chips)
 * over sectioned responsive grids (Albums / Songs / Genres & moods), with a
 * trailing "+" tile that opens the add flow. Filtering/grouping logic lives
 * in library.ts (pure, unit-tested).
 */
import { useState } from 'react'
import { useStore } from '../store.js'
import { kindCounts, organizeLibrary, type KindFilter } from '../library.js'
import { AlbumCard } from './AlbumCard.js'

function AddCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="card card--add" onClick={onClick}>
      <span className="card--add__plus">+</span>
      <span className="card--add__label">Add music</span>
    </button>
  )
}

const CHIPS: { key: KindFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'album', label: 'Albums' },
  { key: 'track', label: 'Songs' },
  { key: 'other', label: 'Moods' },
]

export function LibraryGrid() {
  const { state, actions } = useStore()
  const { presets, status, applyingSlug } = state
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')

  const counts = kindCounts(presets)
  const sections = organizeLibrary(presets, query.trim(), kind)
  const empty = sections.length === 0

  return (
    <main className="library">
      <div className="library__toolbar">
        <input
          className="library__search"
          type="search"
          placeholder="Filter by title or artist"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter presets"
        />
        <div className="library__chips" role="tablist" aria-label="Preset kind">
          {CHIPS.filter((c) => c.key === 'all' || counts[c.key] > 0).map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={kind === c.key}
              className={`mode-chip ${kind === c.key ? 'mode-chip--on' : ''}`}
              onClick={() => setKind(c.key)}
            >
              {c.label} <span className="mode-chip__count">{counts[c.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {empty && (
        <div className="library__empty">
          Nothing matches{query.trim() ? ` “${query.trim()}”` : ''}.
        </div>
      )}

      {sections.map((section, i) => (
        <section key={section.title ?? 'only'}>
          {section.title && <h2 className="library__section">{section.title}</h2>}
          <div className="grid">
            {section.presets.map((p) => (
              <AlbumCard
                key={p.slug}
                preset={p}
                active={status?.activePreset === p.slug && (status?.engaged ?? false)}
                applying={applyingSlug === p.slug}
                onApply={() => actions.applyPreset(p.slug)}
                onTune={() => actions.openDrawer(p.slug)}
              />
            ))}
            {i === sections.length - 1 && <AddCard onClick={() => actions.setAddOpen(true)} />}
          </div>
        </section>
      ))}

      {empty && (
        <div className="grid">
          <AddCard onClick={() => actions.setAddOpen(true)} />
        </div>
      )}
    </main>
  )
}
