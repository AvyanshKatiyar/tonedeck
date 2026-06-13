/**
 * App — top-level shell. Provides the store, drives the meter websocket, and
 * lays out the TopBar, NowLiveCard hero, grouped deck library, drawer,
 * add-album modal, toasts, and status footer. Renders a quiet full-screen
 * retry panel when the daemon can't be reached.
 */
import { useCallback, useState } from 'react'
import { StoreProvider, useMeterFeed, useStore } from './store.js'
import { groupByArtist } from './library.js'
import { TopBar } from './components/TopBar.js'
import { NowLiveCard } from './components/NowLiveCard.js'
import { ArtistSection } from './components/ArtistSection.js'
import { PresetDrawer } from './components/PresetDrawer.js'
import { AddAlbumModal } from './components/AddAlbumModal.js'
import { Toasts, StatusFooter } from './components/Toasts.js'

function RetryPanel() {
  return (
    <div className="retry">
      <div className="retry__inner">
        <div className="retry__mark">ToneDeck</div>
        <p className="retry__msg">Can't reach the audio daemon.</p>
        <p className="retry__sub">Make sure the ToneDeck daemon is running, then try again.</p>
        <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
          Retry
        </button>
      </div>
    </div>
  )
}

function Shell() {
  const { state, actions } = useStore()
  const [query, setQuery] = useState('')
  const [expandedAlbum, setExpandedAlbum] = useState<string | null>(null)

  const onAutoWs = useCallback(
    (mode: 'off' | 'armed' | 'yielded', generating?: boolean) => {
      actions.dispatchAuto(mode, generating)
    },
    [actions],
  )

  useMeterFeed(actions.refreshStatus, onAutoWs)

  if (state.phase === 'unreachable') return <RetryPanel />
  if (state.phase === 'loading') {
    return (
      <div className="retry">
        <div className="retry__inner">
          <div className="retry__mark retry__mark--pulse">ToneDeck</div>
        </div>
      </div>
    )
  }

  const groups = groupByArtist(state.presets, query)
  const activeSlug = state.status?.activePreset ?? null

  const handleToggle = (album: string) => {
    setExpandedAlbum((prev) => (prev === album ? null : album))
  }

  const handleApply = (slug: string) => {
    void actions.applyPreset(slug)
  }

  return (
    <div className="app">
      <TopBar />
      {state.status && (
        <NowLiveCard status={state.status} auto={state.auto} />
      )}
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
        </div>
        {groups.length === 0 && (
          <div className="library__empty">
            {query.trim() ? `Nothing matches "${query.trim()}".` : 'No presets yet — add some music.'}
          </div>
        )}
        {groups.map((group) => (
          <ArtistSection
            key={group.artist}
            group={group}
            expandedAlbum={expandedAlbum}
            activeSlug={activeSlug}
            onToggle={handleToggle}
            onApply={handleApply}
          />
        ))}
      </main>
      {state.drawerSlug && <PresetDrawer />}
      {state.addOpen && <AddAlbumModal />}
      <Toasts />
      <StatusFooter />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
