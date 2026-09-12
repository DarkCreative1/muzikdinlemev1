import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock, Download, Heart, ListMusic, Plus, Trash2 } from 'lucide-react'
import { useLibrary } from '../context/LibraryContext.jsx'
import MediaShelf from '../components/music/MediaShelf.jsx'
import TrackTable from '../components/music/TrackTable.jsx'
import StateView from '../components/ui/StateView.jsx'
import Skeleton from '../components/ui/Skeleton.jsx'
import Button from '../components/ui/Button.jsx'
import PlaylistDialog from '../components/ui/PlaylistDialog.jsx'
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx'

const TABS = [
  { id: 'playlists', label: 'Çalma Listeleri', icon: <ListMusic size={17} strokeWidth={2.5} /> },
  { id: 'favorites', label: 'Beğenilen Şarkılar', icon: <Heart size={17} strokeWidth={2.5} /> },
  { id: 'history', label: 'Son Dinlenenler', icon: <Clock size={17} strokeWidth={2.5} /> },
  { id: 'library', label: 'İndirilenler', icon: <Download size={17} strokeWidth={2.5} /> },
]

// Kitaplık Sayfası — Çoklu Temaya Uyumlu Kişisel Arşiv
export default function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'playlists'
  const { playlists, favorites, history, library, loading, createPlaylist, clearHistory } = useLibrary()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [searchFilter, setSearchFilter] = useState('')

  const activeTab = TABS.some((item) => item.id === tab) ? tab : 'playlists'
  const setTab = (id) => setParams(id === 'playlists' ? {} : { tab: id }, { replace: true })

  const handleCreatePlaylist = async ({ name, description }) => {
    await createPlaylist(name, description)
    setDialogOpen(false)
  }

  const filteredPlaylists = useMemo(() => {
    if (!searchFilter.trim()) return playlists
    return playlists.filter((p) => (p.name || '').toLowerCase().includes(searchFilter.toLowerCase()))
  }, [playlists, searchFilter])

  const filteredFavorites = useMemo(() => {
    if (!searchFilter.trim()) return favorites
    return favorites.filter(
      (t) => (t.title || '').toLowerCase().includes(searchFilter.toLowerCase()) || (t.artist || '').toLowerCase().includes(searchFilter.toLowerCase()),
    )
  }, [favorites, searchFilter])

  const filteredHistory = useMemo(() => {
    if (!searchFilter.trim()) return history
    return history.filter(
      (t) => (t.title || '').toLowerCase().includes(searchFilter.toLowerCase()) || (t.artist || '').toLowerCase().includes(searchFilter.toLowerCase()),
    )
  }, [history, searchFilter])

  const filteredLibrary = useMemo(() => {
    if (!searchFilter.trim()) return library
    return library.filter(
      (t) => (t.title || '').toLowerCase().includes(searchFilter.toLowerCase()) || (t.artist || '').toLowerCase().includes(searchFilter.toLowerCase()),
    )
  }, [library, searchFilter])

  const content = useMemo(() => {
    if (loading) {
      return (
        <div aria-busy="true">
          <div className="shelf__grid">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="media-card"><Skeleton className="skeleton--square" /></div>
            ))}
          </div>
        </div>
      )
    }

    switch (activeTab) {
      case 'favorites':
        return filteredFavorites.length ? (
          <TrackTable
            tracks={filteredFavorites}
            contextName="Beğenilen Şarkılar"
            contextId="library-favorites"
            emptyText="Henüz beğenilen şarkı yok."
          />
        ) : (
          <StateView
            kind="empty"
            title="Henüz Beğendiğin Şarkı Yok"
            text="Şarkıları dinlerken kalp simgesine tıklayarak favorilerine ekleyebilirsin."
          />
        )

      case 'history':
        return filteredHistory.length ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setClearConfirmOpen(true)}
              >
                <Trash2 size={16} strokeWidth={2.5} />
                Geçmişi Temizle
              </Button>
            </div>
            <TrackTable
              tracks={filteredHistory}
              contextName="Son Dinlenenler"
              contextId="library-history"
              emptyText="Henüz çalma geçmişi yok."
            />
          </div>
        ) : (
          <StateView
            kind="empty"
            title="Çalma Geçmişi Boş"
            text="Müzik dinlemeye başladığında geçmişin burada listelenecektir."
          />
        )

      case 'library':
        return filteredLibrary.length ? (
          <TrackTable
            tracks={filteredLibrary}
            contextName="İndirilenler"
            contextId="library-downloaded"
            emptyText="İndirilmiş yerel parça yok."
          />
        ) : (
          <StateView
            kind="empty"
            title="İndirilen Parça Yok"
            text="Dinlediğin şarkıları indirerek çevrimdışı önbelleğe alabilirsin."
          />
        )

      default:
        return filteredPlaylists.length ? (
          <MediaShelf
            title="Çalma Listelerin"
            items={filteredPlaylists}
            type="playlist"
            to={(item) => `/playlist/${item.id}`}
            tracks={(item) => item.tracks || []}
            contextName={(item) => item.name}
          />
        ) : (
          <StateView
            kind="empty"
            title="Henüz Çalma Listesi Yok"
            text="Kendi koleksiyonunu oluşturmak için ilk çalma listeni oluştur."
            actionLabel="+ Yeni Liste Oluştur"
            onAction={() => setDialogOpen(true)}
          />
        )
    }
  }, [loading, activeTab, filteredFavorites, filteredHistory, filteredLibrary, filteredPlaylists])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <span className="eyebrow">
            <ListMusic size={13} strokeWidth={2.5} />
            Kişisel Arşiv
          </span>
          <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 5vw, 3.8rem)', margin: '4px 0 0' }}>
            Kitaplığın
          </h1>
        </div>

        {activeTab === 'playlists' && (
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            <Plus size={19} strokeWidth={2.5} />
            Yeni Çalma Listesi
          </Button>
        )}
      </div>

      {/* Sekmeler ve Filtre Arama */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn btn--sm ${activeTab === item.id ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setTab(item.id)}
              aria-pressed={activeTab === item.id}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ minWidth: 220, maxWidth: 300, flex: 1 }}>
          <input
            type="text"
            placeholder="Kitaplıkta filtrele…"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            style={{
              width: '100%',
              height: 38,
              padding: '0 14px',
              background: 'var(--surface)',
              border: 'var(--border-thin)',
              borderRadius: 'var(--radius-inner)',
              boxShadow: 'var(--shadow-btn)',
              fontSize: '0.88rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
            }}
            aria-label="Kitaplıkta filtreleme yap"
          />
        </div>
      </div>

      {content}

      <PlaylistDialog
        open={dialogOpen}
        mode="create"
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreatePlaylist}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Çalma Geçmişini Temizle?"
        text="Tüm dinleme geçmişiniz silinecektir. Bu işlem geri alınamaz."
        confirmLabel="Geçmişi Temizle"
        danger
        onCancel={() => setClearConfirmOpen(false)}
        onConfirm={() => {
          setClearConfirmOpen(false)
          void clearHistory()
        }}
      />
    </div>
  )
}