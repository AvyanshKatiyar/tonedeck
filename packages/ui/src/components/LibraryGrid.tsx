/**
 * LibraryGrid — responsive album grid (min 180px columns). Renders one
 * AlbumCard per preset and a trailing AddAlbumCard ("+") tile that opens the
 * add-album flow.
 */
import { useStore } from '../store.js'
import { AlbumCard } from './AlbumCard.js'

function AddAlbumCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="card card--add" onClick={onClick}>
      <span className="card--add__plus">+</span>
      <span className="card--add__label">Add an album</span>
    </button>
  )
}

export function LibraryGrid() {
  const { state, actions } = useStore()
  const { presets, status, applyingSlug } = state

  return (
    <main className="grid">
      {presets.map((p) => (
        <AlbumCard
          key={p.slug}
          preset={p}
          active={status?.activePreset === p.slug && (status?.engaged ?? false)}
          applying={applyingSlug === p.slug}
          onApply={() => actions.applyPreset(p.slug)}
          onTune={() => actions.openDrawer(p.slug)}
        />
      ))}
      <AddAlbumCard onClick={() => actions.setAddOpen(true)} />
    </main>
  )
}
