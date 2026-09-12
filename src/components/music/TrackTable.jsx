import { Heart, Info, ListPlus, MoreHorizontal, Pause, Play, Radio, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayer } from '../../context/PlayerContext.jsx'
import { useLibrary } from '../../context/LibraryContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import Artwork from './Artwork.jsx'
import AddToPlaylistDialog from '../ui/AddToPlaylistDialog.jsx'
import { formatTime } from '../../data/catalog.js'
import { mediaKey } from '../../lib/mediaKey.js'
import { readFavoriteState } from '../../lib/uiState.js'

// Parça Listesi Tablosu — Çoklu Temaya Uyumlu Veri Tablosu
export default function TrackTable({
  tracks = [],
  contextId,
  contextName,
  loading = false,
  emptyText = 'Henüz parça yok.',
  onRemoveTrack,
}) {
  const player = usePlayer()
  const { toggleFavorite, isFavorite } = useLibrary()
  const { toast, menu, openMenu, closeMenu } = useUI()
  const navigate = useNavigate()
  const [dialogTrack, setDialogTrack] = useState(null)

  if (loading) {
    return (
      <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 14px',
              border: 'var(--border-sub)',
              borderRadius: 'var(--radius-inner)',
              background: 'var(--surface)',
              boxShadow: 'var(--shadow-btn)',
            }}
          >
            <div className="skeleton" style={{ width: 28, height: 16 }} />
            <div className="skeleton" style={{ width: 42, height: 42 }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton skeleton--title" style={{ width: '40%', marginBottom: 6 }} />
              <div className="skeleton skeleton--text" style={{ width: '25%' }} />
            </div>
            <div className="skeleton skeleton--text" style={{ width: 44 }} />
          </div>
        ))}
      </div>
    )
  }

  if (!tracks?.length) {
    return (
      <p style={{ padding: '36px 12px', textAlign: 'center', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
        {emptyText}
      </p>
    )
  }

  const handleFavoriteToggle = async (track) => {
    try {
      const data = await toggleFavorite(track)
      toast(readFavoriteState(data) ? 'Favorilere eklendi.' : 'Favorilerden çıkarıldı.', 'success')
    } catch (error) {
      toast(`Favoriler güncellenemedi: ${error.message}`, 'error')
    }
  }

  const handleContextMenu = (event, track, index) => {
    const isCurrentActive = player.current?.id === track.id
    const fav = isFavorite(track.id)

    const menuItems = [
      {
        label: isCurrentActive && player.playing ? 'DURAKLAT' : 'ÇAL',
        icon: isCurrentActive && player.playing ? <Pause size={16} strokeWidth={2.5} /> : <Play size={16} strokeWidth={2.5} />,
        onClick: () => {
          if (isCurrentActive) player.toggle()
          else player.playContext(tracks, index, contextName, contextId)
        },
      },
      {
        label: fav ? 'FAVORİLERDEN ÇIKAR' : 'FAVORİLERE EKLE',
        icon: <Heart size={16} strokeWidth={2.5} fill={fav ? 'var(--accent)' : 'none'} />,
        onClick: () => handleFavoriteToggle(track),
      },
      {
        label: 'RADYO BAŞLAT',
        icon: <Radio size={16} strokeWidth={2.5} />,
        onClick: () => player.playRadio(track),
      },
      {
        label: 'PARÇA DETAYINA GİT',
        icon: <Info size={16} strokeWidth={2.5} />,
        onClick: () => navigate(`/track/${track.id}`),
      },
      { separator: true },
      {
        label: 'ÇALMA LİSTESİNE EKLE',
        icon: <ListPlus size={16} strokeWidth={2.5} />,
        onClick: () => setDialogTrack(track),
      },
    ]

    if (onRemoveTrack) {
      menuItems.push({
        label: 'LİSTEDEN ÇIKAR',
        icon: <Trash2 size={16} strokeWidth={2.5} />,
        danger: true,
        onClick: () => onRemoveTrack(track),
      })
    }

    openMenu(event.clientX, event.clientY, menuItems, event.currentTarget)
  }

  return (
    <>
      <div className="track-table-surface">
        <div className="track-table-wrap">
          <table className="track-table">
          <thead>
            <tr>
              <th style={{ width: 50, textAlign: 'center' }}>#</th>
              <th>Başlık</th>
              <th style={{ width: 120 }}>Süre</th>
              <th style={{ width: 90, textAlign: 'right' }}>İşlemler</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track, index) => {
              const active = player.current?.id === track.id
              const fav = isFavorite(track.id)

              return (
                <tr
                  key={mediaKey(track, 'track', index)}
                  className={`track-row ${active ? 'is-active' : 'track-row--hover'}`}
                  onDoubleClick={() => {
                    if (active) player.toggle()
                    else player.playContext(tracks, index, contextName, contextId)
                  }}
                >
                  {/* Sıra / Çal Butonu */}
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="track-row__play"
                      aria-label={active && player.playing ? `${track.title} duraklat` : `${track.title} çal`}
                      onClick={() => {
                        if (active) player.toggle()
                        else player.playContext(tracks, index, contextName, contextId)
                      }}
                    >
                      {active && player.playing ? (
                        <span className="equalizer" aria-hidden="true">
                          <span className="equalizer__bar" style={{ animationDelay: '0s' }} />
                          <span className="equalizer__bar" style={{ animationDelay: '0.2s' }} />
                          <span className="equalizer__bar" style={{ animationDelay: '0.4s' }} />
                        </span>
                      ) : (
                        <span style={{ fontWeight: 800 }}>{index + 1}</span>
                      )}
                    </button>
                  </td>

                  {/* Parça Başlığı & Sanatçı */}
                  <td>
                    <div className="track-row__cell">
                      <span className="track-row__art">
                        <Artwork src={track.cover_url} alt={`${track.title} kapağı`} seed={track.id} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <span className="track-row__title" style={{ display: 'block' }}>
                          {track.title}
                        </span>
                        <span className="track-row__sub" style={{ display: 'block' }}>
                          {track.artist}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Süre */}
                  <td>
                    <span className="track-row__duration">
                      {formatTime(track.duration)}
                    </span>
                  </td>

                  {/* Butonlar & Menü */}
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm"
                        aria-label={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                        onClick={() => handleFavoriteToggle(track)}
                        style={{ background: fav ? 'var(--accent)' : 'var(--surface)', color: fav ? '#FFFFFF' : 'var(--text-primary)' }}
                      >
                        <Heart size={15} strokeWidth={2.5} fill={fav ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm"
                        aria-label={`${track.title} için seçenekler`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          if (menu?.trigger === event.currentTarget) {
                            closeMenu()
                            return
                          }
                          handleContextMenu(event, track, index)
                        }}
                      >
                        <MoreHorizontal size={16} strokeWidth={2.5} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          </table>
        </div>
      </div>

      <AddToPlaylistDialog
        open={Boolean(dialogTrack)}
        track={dialogTrack}
        onClose={() => setDialogTrack(null)}
      />
    </>
  )
}
