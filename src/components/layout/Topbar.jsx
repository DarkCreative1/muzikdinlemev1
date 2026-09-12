import { ArrowLeft, ArrowRight, CircleUserRound, Menu, PanelRight, Search, Settings, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePlayer } from '../../context/PlayerContext.jsx'
import IconButton from '../ui/IconButton.jsx'
import SettingsDialog from '../ui/SettingsDialog.jsx'

// Üst bar — Geçmiş Gezinme, Arama, Tema Ayarları, Panel ve Profil
export default function Topbar({ compact = false, onOpenMenu }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const player = usePlayer()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const currentQuery = location.pathname === '/search'
    ? new URLSearchParams(location.search).get('q') || ''
    : ''
  const [query, setQuery] = useState(currentQuery)
  const inputRef = useRef(null)

  useEffect(() => {
    setQuery(currentQuery)
  }, [currentQuery])

  const handleSearchSubmit = (event) => {
    event.preventDefault()
    const clean = query.trim()
    navigate(`/search${clean ? `?q=${encodeURIComponent(clean)}` : ''}`)
  }

  const handleClear = () => {
    setQuery('')
    if (location.pathname === '/search') {
      navigate('/search')
    }
    inputRef.current?.focus()
  }

  return (
    <>
      <header className="topbar" aria-label="Üst Başlık Çubuğu">
        <div className="topbar__history">
          {onOpenMenu && (
            <IconButton
              label={compact ? 'Menüyü genişlet' : 'Menüyü daralt'}
              className="md:hidden"
              onClick={onOpenMenu}
            >
              <Menu size={20} strokeWidth={2.5} />
            </IconButton>
          )}
          <IconButton
            label="Geri git"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={19} strokeWidth={2.5} />
          </IconButton>
          <IconButton
            label="İleri git"
            onClick={() => navigate(1)}
          >
            <ArrowRight size={19} strokeWidth={2.5} />
          </IconButton>
        </div>

        <form className="global-search" role="search" onSubmit={handleSearchSubmit}>
          <Search size={19} strokeWidth={2.5} />
          <input
            ref={inputRef}
            name="search-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Şarkı, sanatçı veya albüm ara…"
            aria-label="Müzik kataloğunda ara"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Aramayı temizle"
              style={{ color: 'var(--text-primary)', display: 'grid', placeItems: 'center' }}
            >
              <X size={18} strokeWidth={2.5} />
            </button>
          )}
        </form>

        <div className="topbar__actions">
          <IconButton
            label="Tema ve görünüm ayarları"
            onClick={() => setSettingsOpen(true)}
            title="Ayarlar & Tema Değiştir"
          >
            <Settings size={20} strokeWidth={2.5} />
          </IconButton>

          <IconButton
            label={player.nowPlayingPanel ? 'Şu An Çalıyor panelini gizle' : 'Şu An Çalıyor panelini aç'}
            active={player.nowPlayingPanel}
            onClick={player.toggleNowPlaying}
          >
            <PanelRight size={20} strokeWidth={2.5} />
          </IconButton>

          <button
            type="button"
            className="account-chip"
            onClick={() => navigate('/auth', { state: { from: location.pathname } })}
            aria-label={user ? `${user.display_name} profili` : 'Giriş yap veya kayıt ol'}
          >
            <span className="account-chip__avatar" aria-hidden="true">
              {user ? (user.display_name || user.email || 'U').slice(0, 1).toUpperCase() : <CircleUserRound size={19} strokeWidth={2.5} />}
            </span>
            <strong style={{ fontSize: '0.88rem', fontWeight: 800 }}>
              {user ? (user.display_name || 'Hesabım') : 'Giriş Yap'}
            </strong>
          </button>
        </div>
      </header>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  )
}
