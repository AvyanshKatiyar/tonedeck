/**
 * App — top-level shell. Provides the store, drives the meter websocket, and
 * lays out the TopBar, NowLiveCard hero, grouped deck library, persistent EQ
 * console, add-album modal, toasts, and status footer. Renders a quiet
 * full-screen retry panel when the daemon can't be reached.
 *
 * Console follow logic:
 *   - followingLive (default true): the console auto-tracks the active preset
 *     whenever it changes. Effect fires only when activePreset differs from
 *     the current drawerSlug so there is no re-render loop.
 *   - Clicking ✎ on a NON-active card → sets followingLive=false (console
 *     locks to that preset). A "↩ Live" button in the console header returns
 *     to following.
 *   - Clicking ✎ on the active card → stays/becomes followingLive=true.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
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
  // followingLive: when true the console auto-tracks state.status.activePreset.
  const [followingLive, setFollowingLive] = useState(true)

  // Stable ref so the effect closure never stales over state/actions identity.
  const followingLiveRef = useRef(followingLive)
  followingLiveRef.current = followingLive

  const onAutoWs = useCallback(
    (mode: 'off' | 'armed' | 'yielded', generating?: boolean) => {
      actions.dispatchAuto(mode, generating)
    },
    [actions],
  )

  const { meters } = useMeterFeed(actions.refreshStatus, onAutoWs)

  // Follow-live effect: whenever the active preset changes and we're following,
  // load it into the console. Guard: only call openDrawer when the slug is
  // genuinely different from what's already in the drawer, preventing loops.
  const activePreset = state.status?.activePreset ?? null
  const drawerSlug = state.drawerSlug
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    if (!followingLiveRef.current) return
    if (!activePreset) return
    if (activePreset === drawerSlug) return
    void actionsRef.current.openDrawer(activePreset)
  }, [activePreset, drawerSlug])

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

  const handleEdit = (slug: string) => {
    // If editing the active preset, stay in follow mode. Otherwise unfollow.
    if (slug === activeSlug) {
      setFollowingLive(true)
    } else {
      setFollowingLive(false)
    }
    void actions.openDrawer(slug)
  }

  // Called by PresetDrawer "↩ Live" button.
  const handleReturnToLive = () => {
    setFollowingLive(true)
    if (activeSlug) {
      void actions.openDrawer(activeSlug)
    }
  }

  // Console placeholder when nothing is loaded.
  const consolePlaceholder = (
    <aside className="console console--empty" aria-label="EQ Console">
      <div className="console__placeholder">
        No EQ loaded — play a song or pick one to edit
      </div>
    </aside>
  )

  return (
    <div className="app">
      <TopBar />
      <div className="app__body">
        <div className="app__main">
          {state.status && (
            <NowLiveCard status={state.status} auto={state.auto} meters={meters} />
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
                onEdit={handleEdit}
              />
            ))}
          </main>
        </div>
        <div className="app__console">
          {state.drawerSlug ? (
            <PresetDrawer
              followingLive={followingLive}
              onReturnToLive={handleReturnToLive}
            />
          ) : (
            consolePlaceholder
          )}
        </div>
      </div>
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
