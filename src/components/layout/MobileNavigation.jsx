import { Home, Library, ListMusic, Pause, Play, Search } from 'lucide-react'
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { usePlayer } from '../../context/PlayerContext.jsx'
import Artwork from '../music/Artwork.jsx'
import MobileNowPlaying from '../player/MobileNowPlaying.jsx'

// Mobil alt gezinme çubuğu + Dokunulabilir Mini Oynatıcı (Neo-brutalist)
export default function MobileNavigation() {
  const player = usePlayer()
  const [fullscreenOpen, setFullscreenOpen] = useState(false)

  const linkClass = ({ isActive }) =>
    `mobile-nav__link ${isActive ? 'is-active' : ''}`

  return (
    <>
      {/* Floating Mini Player on Mobile */}
      {player.current && (
        <div
          className="mobile-mini-player"
          onClick={() => setFullscreenOpen(true)}
          role="button"
          tabIndex={0}
          aria-label={`Şu an çalan: ${player.current.title} — Tam ekran aç`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setFullscreenOpen(true)
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <span style={{ width: 44, height: 44, border: '2px solid #000', overflow: 'hidden', flexShrink: 0, background: 'var(--muted)', boxShadow: '2px 2px 0px #000' }}>
              <Artwork src={player.current.cover_url} alt={`${player.current.title} kapağı`} seed={player.current.id} />
            </span>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 900, fontSize: '0.88rem', textTransform: 'uppercase', color: '#000000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {player.current.title}
              </span>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'rgba(0, 0, 0, 0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {player.current.artist}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            {player.playing ? (
              <span className="equalizer" aria-hidden="true">
                <span className="equalizer__bar" style={{ animationDelay: '0s' }} />
                <span className="equalizer__bar" style={{ animationDelay: '0.2s' }} />
                <span className="equalizer__bar" style={{ animationDelay: '0.4s' }} />
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn--primary"
              style={{ width: 40, height: 40, padding: 0, border: '2px solid #000', boxShadow: '2px 2px 0px #000' }}
              onClick={player.toggle}
              aria-label={player.playing ? 'Duraklat' : 'Çal'}
            >
              {player.playing ? <Pause size={20} strokeWidth={3} fill="currentColor" /> : <Play size={20} strokeWidth={3} fill="currentColor" />}
            </button>
          </div>
        </div>
      )}

      {/* Mobil Alt Menü */}
      <nav className="mobile-nav" aria-label="Mobil Ana Gezinme">
        <NavLink to="/" end className={linkClass}>
          <Home size={20} strokeWidth={2.5} />
          <span>Ana sayfa</span>
        </NavLink>
        <NavLink to="/search" className={linkClass}>
          <Search size={20} strokeWidth={2.5} />
          <span>Ara</span>
        </NavLink>
        <NavLink to="/library" end className={linkClass}>
          <Library size={20} strokeWidth={2.5} />
          <span>Kitaplık</span>
        </NavLink>
        <NavLink to="/library?tab=playlists" className={linkClass}>
          <ListMusic size={20} strokeWidth={2.5} />
          <span>Listeler</span>
        </NavLink>
      </nav>

      {/* Tam Ekran Mobil Oynatıcı Modalı */}
      <MobileNowPlaying
        open={fullscreenOpen}
        onClose={() => setFullscreenOpen(false)}
      />
    </>
  )
}
