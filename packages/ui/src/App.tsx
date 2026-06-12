/**
 * App — top-level shell. Provides the store, drives the meter websocket, and
 * lays out the NowPlayingBar, LibraryGrid, drawer, add-album modal, toasts, and
 * status footer. Renders a quiet full-screen retry panel when the daemon can't
 * be reached.
 */
import { StoreProvider, useMeterFeed, useStore } from './store.js'
import { NowPlayingBar } from './components/NowPlayingBar.js'
import { LibraryGrid } from './components/LibraryGrid.js'
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
  const { meters } = useMeterFeed(actions.refreshStatus)

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

  return (
    <div className="app">
      <NowPlayingBar meters={meters} />
      <LibraryGrid />
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
