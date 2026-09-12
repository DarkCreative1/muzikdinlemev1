import { useState } from 'react'
import { Heart, ListPlus, Play, Shuffle, Trash2 } from 'lucide-react'
import { usePlayer } from '../../context/PlayerContext.jsx'
import { useLibrary } from '../../context/LibraryContext.jsx'
import { readFavoriteState } from '../../lib/uiState.js'
import { useUI } from '../../context/UIContext.jsx'
import Artwork from './Artwork.jsx'
import Button from '../ui/Button.jsx'
import ConfirmDialog from '../ui/ConfirmDialog.jsx'
import AddToPlaylistDialog from '../ui/AddToPlaylistDialog.jsx'

// Koleksiyon Başlığı (Hero) — Albüm, Playlist ve Sanatçı Hero
export default function CollectionHero({
  type = 'album',
  title,
  subtitle,
  meta,
  coverUrl,
  seed,
  tracks = [],
  onDelete,
  onMenu,
}) {
  const player = usePlayer()
  const { toggleFavorite, isFavorite } = useLibrary()
  const { toast, openMenu } = useUI()
  const [dialogTrack, setDialogTrack] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const totalDuration = tracks.reduce((sum, track) => sum + Math.max(0, Number(track?.duration) || 0), 0)
  const hours = Math.floor(totalDuration / 3600)
  const minutes = Math.floor((totalDuration % 3600) / 60)

  const handlePlay = () => {
    if (!tracks.length) return
    player.playContext(tracks, 0, title, `${type}-${seed || title}`)
  }

  const handleShuffle = () => {
    if (!tracks.length) return
    player.playShuffled(tracks, title, `${type}-${seed || title}`)
  }

  const handleFavoriteCollection = async () => {
    if (!tracks.length) return
    const track = tracks[0]
    try {
      const data = await toggleFavorite(track)
      toast(readFavoriteState(data) ? 'Favorilere eklendi.' : 'Favorilerden çıkarıldı.', 'success')
    } catch (error) {
      toast(`Favoriler güncellenemedi: ${error.message}`, 'error')
    }
  }

  const hasFav = tracks.some((track) => isFavorite(track.id))

  const typeLabel =
    type === 'album' ? 'Albüm'
    : type === 'playlist' ? 'Çalma Listesi'
    : type === 'artist' ? 'Sanatçı'
    : 'Parça'

  return (
    <>
      <div className="hero">
        <div className="hero__art">
          <Artwork
            src={coverUrl}
            alt={`${title} kapağı`}
            seed={seed || title}
            shape={type === 'artist' ? 'circle' : 'square'}
          />
        </div>

        <div className="hero__body">
          <span className="eyebrow">{typeLabel}</span>
          <h1 className="hero__title">{title}</h1>
          {subtitle && <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{subtitle}</div>}

          <div className="hero__meta">
            {meta && (
              <span style={{ background: 'var(--surface)', border: 'var(--border-thin)', borderRadius: 'var(--radius-pill)', padding: '3px 10px', boxShadow: 'var(--shadow-btn)' }}>
                {meta}
              </span>
            )}
            {tracks.length > 0 && (
              <span style={{ background: 'var(--secondary)', color: 'var(--text-primary)', border: 'var(--border-thin)', borderRadius: 'var(--radius-pill)', padding: '3px 10px', boxShadow: 'var(--shadow-btn)' }}>
                {tracks.length} Parça · {hours ? `${hours} sa ${minutes} dk` : `${minutes} dk`}
              </span>
            )}
          </div>

          <div className="hero__actions">
            <Button
              variant="primary"
              size="lg"
              onClick={handlePlay}
              disabled={!tracks.length}
              aria-label={`${title} çal`}
            >
              <Play size={20} strokeWidth={2.5} fill="currentColor" />
              Çal
            </Button>

            <Button
              variant="soft"
              size="lg"
              onClick={handleShuffle}
              disabled={!tracks.length}
              aria-label={`${title} karıştırarak çal`}
            >
              <Shuffle size={20} strokeWidth={2.5} />
              Karıştır
            </Button>

            <Button
              variant="ghost"
              onClick={handleFavoriteCollection}
              disabled={!tracks.length}
              aria-label={hasFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
              style={{ background: hasFav ? 'var(--accent)' : 'var(--surface)' }}
            >
              <Heart size={18} strokeWidth={2.5} fill={hasFav ? 'currentColor' : 'none'} />
              {hasFav ? 'Favorilerde' : 'Favori'}
            </Button>

            <Button
              variant="ghost"
              onClick={() => setDialogTrack(tracks[0])}
              disabled={!tracks.length}
              aria-label="Listeye ekle"
            >
              <ListPlus size={18} strokeWidth={2.5} />
              Listeye Ekle
            </Button>

            {onDelete && (
              <Button
                variant="danger"
                onClick={() => setConfirmOpen(true)}
                aria-label="Listeyi sil"
              >
                <Trash2 size={16} strokeWidth={2.5} />
                Sil
              </Button>
            )}

            {onMenu && (
              <Button
                variant="ghost"
                onClick={(event) =>
                  openMenu(event.clientX, event.clientY, [{ label: 'Diğer seçenekler', onClick: onMenu }], event.currentTarget)
                }
                aria-label="Daha fazla seçenek"
              >
                •••
              </Button>
            )}
          </div>
        </div>
      </div>

      <AddToPlaylistDialog
        open={Boolean(dialogTrack)}
        track={dialogTrack}
        onClose={() => setDialogTrack(null)}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="Bu listeyi sil?"
        text={`"${title}" kalıcı olarak silinecektir. Bu işlem geri alınamaz.`}
        confirmLabel="Listeyi Sil"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          onDelete?.()
        }}
      />
    </>
  )
}
