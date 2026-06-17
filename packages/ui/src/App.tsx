/**
 * App — Spotify-style three-pane shell. Left: Your Library sidebar. Centre:
 * scrollable main with a green-tinted top gradient behind the Now-Live hero and
 * the album grid. Right: the Now-Playing view (the persistent EQ console). A
 * full-width player bar spans the bottom.
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
import { Sidebar } from './components/Sidebar.js'
import { NowLiveCard } from './components/NowLiveCard.js'
import { ArtistSection } from './components/ArtistSection.js'
import { PresetDrawer } from './components/PresetDrawer.js'
import { NowPlayingBar } from './components/NowPlayingBar.js'
import { AddAlbumModal } from './components/AddAlbumModal.js'
import { Toasts } from './components/Toasts.js'

function RetryPanel() {
  return (
    <div className="retry">
      <div className="retry__inner">
        <div className="retry__mark">ToneDeck</div>
        <span className="pill pill--status pill--offline" role="status">
          Offline
        </span>
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
  // Right Now-Playing panel visibility (toggled from the TopBar).
  const [nowPlayingOpen, setNowPlayingOpen] = useState(true)
  const mainScrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const scrollMain = (dir: number) =>
    mainScrollRef.current?.scrollBy({ top: dir * window.innerHeight * 0.8, behavior: 'smooth' })
  const focusSearch = () => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    searchRef.current?.focus()
  }

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
    <aside className="console console--empty" aria-label="Now playing view">
      <div className="console__placeholder">
        Nothing loaded.
        <br />
        Play a song or pick one to tune.
      </div>
    </aside>
  )

  return (
    <div className={`app${nowPlayingOpen ? '' : ' app--no-right'}`}>
      <Sidebar
        groups={groups}
        activeSlug={activeSlug}
        onApply={handleApply}
        onEdit={handleEdit}
        onAdd={() => actions.setAddOpen(true)}
        onSearch={focusSearch}
      />

      <div className="main">
        <TopBar
          onBack={() => scrollMain(-1)}
          onForward={() => scrollMain(1)}
          onToggleNowPlaying={() => setNowPlayingOpen((o) => !o)}
          nowPlayingOpen={nowPlayingOpen}
        />
        <div className="main__scroll" ref={mainScrollRef}>
          <div className="main__wash">
            {state.status && (
              <NowLiveCard status={state.status} auto={state.auto} meters={meters} />
            )}
          </div>
          <main className="library">
            <div className="library__toolbar">
              <input
                ref={searchRef}
                className="library__search"
                type="search"
                placeholder="Search your tuned albums and songs"
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
      </div>

      {nowPlayingOpen && (
        <aside className="rightpanel">
          {state.drawerSlug ? (
            <PresetDrawer followingLive={followingLive} onReturnToLive={handleReturnToLive} />
          ) : (
            consolePlaceholder
          )}
        </aside>
      )}

      <NowPlayingBar meters={meters} />

      {state.addOpen && <AddAlbumModal />}
      <Toasts />
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
