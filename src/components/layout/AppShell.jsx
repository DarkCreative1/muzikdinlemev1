import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { usePlayer } from '../../context/PlayerContext.jsx'
import Sidebar from './Sidebar.jsx'
import Topbar from './Topbar.jsx'
import MobileNavigation from './MobileNavigation.jsx'
import GlobalPlayer from '../player/GlobalPlayer.jsx'
import NowPlayingPanel from '../player/NowPlayingPanel.jsx'
import ContextMenu from '../ui/ContextMenu.jsx'
import Toasts from '../ui/Toasts.jsx'
import AuthRequiredDialog from '../ui/AuthRequiredDialog.jsx'

// Ana Uygulama İskeleti — Sol Sidebar + Üstbar + Ana İçerik + Sağ Panel + Alt Oynatıcı
export default function AppShell() {
  const player = usePlayer()
  const location = useLocation()
  const [compact, setCompact] = useState(false)

  // Sayfa / rota değişince ana içeriği en üste kaydır
  useEffect(() => {
    const main = document.getElementById('main-content')
    if (main) main.scrollTop = 0
  }, [location.pathname])

  const shellClass = [
    'app-shell',
    player.nowPlayingPanel ? 'app-shell--panel' : '',
    compact ? 'app-shell--rail' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={shellClass}>
      <Sidebar
        compact={compact}
        onToggleCompact={() => setCompact((value) => !value)}
      />
      <Topbar
        compact={compact}
        onOpenMenu={() => setCompact((value) => !value)}
      />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <div className="app-main__inner">
          <Outlet />
        </div>
      </main>
      {player.nowPlayingPanel && <NowPlayingPanel />}
      <GlobalPlayer />
      <MobileNavigation />
      <ContextMenu />
      <Toasts />
      <AuthRequiredDialog />
    </div>
  )
}
