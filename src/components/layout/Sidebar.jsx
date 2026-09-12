import { Clock, Download, Heart, Home, Library, ListMusic, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useLibrary } from '../../context/LibraryContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import Brand from './Brand.jsx'
import IconButton from '../ui/IconButton.jsx'
import PlaylistDialog from '../ui/PlaylistDialog.jsx'
import SettingsDialog from '../ui/SettingsDialog.jsx'

// Sol kenar çubuğu — Ana Gezinme, Kitaplık, Playlist Yönetimi ve Ayarlar
export default function Sidebar({ compact = false, onToggleCompact }) {
  const { playlists, createPlaylist } = useLibrary()
  const { toast } = useUI()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [isMobile, setIsMobile] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(media.matches)
    update()
    if (media.addEventListener) media.addEventListener('change', update)
    else media.addListener(update)
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update)
      else media.removeListener(update)
    }
  }, [])

  const submit = async ({ name, description }) => {
    try {
      const data = await createPlaylist(name, description)
      const id = data?.playlist?.id || data?.id
      setDialogOpen(false)
      toast(`"${name}" oluşturuldu.`, 'success')
      if (id) navigate(`/playlist/${id}`)
    } catch (error) {
      toast(`Oluşturulamadı: ${error.message}`, 'error')
    }
  }

  const filteredPlaylists = playlists.filter((item) =>
    (item.name || '').toLowerCase().includes(filterQuery.toLowerCase()),
  )

  const isCurrentTab = (path, tab) => {
    if (!location.pathname.startsWith(path)) return false
    const search = new URLSearchParams(location.search)
    return search.get('tab') === tab
  }

  const navLinkClass = ({ isActive }) =>
    `sidebar__link ${isActive ? 'is-active' : ''}`

  const dialogs = (
    <>
      <PlaylistDialog
        open={dialogOpen}
        mode="create"
        onClose={() => setDialogOpen(false)}
        onSubmit={submit}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  )

  // Mobilde kenar çubuğu mobil navigasyonla değişir: aside hiç render edilmez.
  // (aria-hidden + inert içinde odaklanabilir NavLink kalması klavye tuzağıydı.)
  if (isMobile) return dialogs

  return (
    <>
      <aside
        className={`sidebar ${compact ? 'sidebar--rail' : ''}`}
        aria-label="Ana Gezinme ve Kitaplık"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <Brand compact={compact} />
          {onToggleCompact && (
            <IconButton
              label={compact ? 'Kenar çubuğunu genişlet' : 'Kenar çubuğunu daralt'}
              onClick={onToggleCompact}
              className="icon-btn--sm"
            >
              {compact ? <PanelLeftOpen size={18} strokeWidth={2.5} /> : <PanelLeftClose size={18} strokeWidth={2.5} />}
            </IconButton>
          )}
        </div>

        {/* Ana Navigasyon */}
        <nav className="sidebar__nav" aria-label="Ana Bölümler">
          <NavLink to="/" end className={navLinkClass} title={compact ? 'Ana sayfa' : undefined}>
            <Home size={20} strokeWidth={2.5} />
            <span>Ana sayfa</span>
          </NavLink>
          <NavLink to="/search" className={navLinkClass} title={compact ? 'Ara' : undefined}>
            <Search size={20} strokeWidth={2.5} />
            <span>Ara</span>
          </NavLink>
          <NavLink to="/library" end className={navLinkClass} title={compact ? 'Kitaplık' : undefined}>
            <Library size={20} strokeWidth={2.5} />
            <span>Kitaplık</span>
          </NavLink>
        </nav>

        {/* Hızlı Erişim Kısayolları */}
        {!compact && (
          <nav className="sidebar__nav" aria-label="Kitaplık Kısayolları" style={{ gap: 4 }}>
            <NavLink
              to="/library?tab=favorites"
              className={`sidebar__link ${isCurrentTab('/library', 'favorites') ? 'is-active' : ''}`}
            >
              <Heart size={18} strokeWidth={2.5} fill={isCurrentTab('/library', 'favorites') ? 'var(--accent)' : 'none'} />
              <span>Beğenilen Şarkılar</span>
            </NavLink>
            <NavLink
              to="/library?tab=history"
              className={`sidebar__link ${isCurrentTab('/library', 'history') ? 'is-active' : ''}`}
            >
              <Clock size={18} strokeWidth={2.5} />
              <span>Son Dinlenenler</span>
            </NavLink>
            <NavLink
              to="/library?tab=library"
              className={`sidebar__link ${isCurrentTab('/library', 'library') ? 'is-active' : ''}`}
            >
              <Download size={18} strokeWidth={2.5} />
              <span>İndirilenler</span>
            </NavLink>
          </nav>
        )}

        {/* Çalma Listeleri Bölümü */}
        <div className="sidebar__library">
          <div className="sidebar__library-head">
            {!compact && (
              <span className="eyebrow" style={{ margin: 0, fontSize: '0.68rem' }}>
                Listeler
              </span>
            )}
            <IconButton
              label="Yeni çalma listesi oluştur"
              onClick={() => setDialogOpen(true)}
              className="icon-btn--sm"
              style={{ background: 'var(--secondary)', color: 'var(--text-primary)' }}
            >
              <Plus size={18} strokeWidth={2.5} />
            </IconButton>
          </div>

          {!compact && playlists.length > 5 && (
            <div style={{ padding: '0 2px', marginBottom: 4 }}>
              <input
                type="text"
                placeholder="Listelerde filtrele…"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                style={{
                  width: '100%',
                  height: 32,
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  padding: '0 8px',
                  background: 'var(--surface)',
                  border: 'var(--border-thin)',
                  borderRadius: 'var(--radius-inner)',
                  color: 'var(--text-primary)',
                }}
                aria-label="Çalma listelerini filtrele"
              />
            </div>
          )}

          <div className="sidebar__library-list">
            {playlists.length === 0 ? (
              !compact && (
                <p style={{ padding: '8px', fontSize: 12, fontWeight: 600, lineHeight: 1.4, color: 'var(--text-muted)' }}>
                  Henüz liste yok. + butonuna tıklayarak ilk listeni oluştur.
                </p>
              )
            ) : (
              filteredPlaylists.map((playlist) => (
                <NavLink
                  key={playlist.id}
                  to={`/playlist/${playlist.id}`}
                  className={({ isActive }) => `sidebar__playlist ${isActive ? 'is-active' : ''}`}
                  title={playlist.name}
                >
                  <span className="sidebar__playlist-title">
                    {playlist.name}
                  </span>
                  {!compact && (
                    <span style={{ fontSize: 11, fontWeight: 800, background: 'var(--surface)', border: 'var(--border-thin)', borderRadius: 'var(--radius-inner)', padding: '0 5px', flexShrink: 0 }}>
                      {playlist.tracks?.length || 0}
                    </span>
                  )}
                </NavLink>
              ))
            )}
          </div>
        </div>

        {/* Alt Ayarlar Butonu */}
        <button
          type="button"
          className="sidebar__link"
          onClick={() => setSettingsOpen(true)}
          style={{ marginTop: 'auto', border: 'var(--border-thin)' }}
          title={compact ? 'Tema Ayarları' : undefined}
        >
          <Settings size={18} strokeWidth={2.5} />
          <span>Tema Ayarları</span>
        </button>
      </aside>

      {dialogs}
    </>
  )
}
