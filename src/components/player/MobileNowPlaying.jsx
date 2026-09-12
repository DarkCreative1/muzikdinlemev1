import { ChevronDown, Heart, ListPlus, Pause, Play, Radio, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { useState, useEffect } from 'react'
import { usePlayer } from '../../context/PlayerContext.jsx'
import { useLibrary } from '../../context/LibraryContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import * as api from '../../lib/api.js'
import Artwork from '../music/Artwork.jsx'
import IconButton from '../ui/IconButton.jsx'
import PulseRail from './PulseRail.jsx'
import QueueList from './QueueList.jsx'
import AddToPlaylistDialog from '../ui/AddToPlaylistDialog.jsx'
import { readFavoriteState } from '../../lib/uiState.js'

// Mobilde Tam Ekran "Şu An Çalıyor" — Çoklu Temaya Uyumlu Modal Görünümü
export default function MobileNowPlaying({ open, onClose }) {
  const player = usePlayer()
  const { toggleFavorite, isFavorite } = useLibrary()
  const { toast } = useUI()
  const [tab, setTab] = useState('player') // 'player' | 'lyrics' | 'queue'
  const [lyrics, setLyrics] = useState('')
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [dialogTrack, setDialogTrack] = useState(null)

  const track = player.current

  useEffect(() => {
    if (tab !== 'lyrics' || !track) {
      setLyrics('')
      return undefined
    }
    let alive = true
    setLyricsLoading(true)
    api.getLyrics(track.title, track.artist, track.duration || 0)
      .then((data) => { if (alive) setLyrics(data?.lyrics || 'Söz bulunamadı.') })
      .catch(() => { if (alive) setLyrics('Sözler şu an alınamıyor.') })
      .finally(() => { if (alive) setLyricsLoading(false) })
    return () => { alive = false }
  }, [tab, track])

  if (!open || !track) return null

  const fav = isFavorite(track.id)

  const handleFavorite = async () => {
    try {
      const data = await toggleFavorite(track)
      toast(readFavoriteState(data) ? 'Favorilere eklendi.' : 'Favorilerden çıkarıldı.', 'success')
    } catch (error) {
      toast(`Favoriler güncellenemedi: ${error.message}`, 'error')
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'var(--canvas)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 20px calc(24px + env(safe-area-inset-bottom))',
        overflowY: 'auto',
        animation: 'fadeIn 120ms ease-out',
        color: 'var(--text-primary)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${track.title} tam ekran oynatıcı`}
    >
      {/* Üst Kapatma ve Sekme Başlığı */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <IconButton label="Oynatıcıyı küçült" onClick={onClose}>
          <ChevronDown size={28} strokeWidth={2.5} />
        </IconButton>

        <div style={{ display: 'flex', gap: 6, background: 'var(--surface-raised)', padding: 4, border: 'var(--border-thin)', borderRadius: 'var(--radius-pill)', boxShadow: 'var(--shadow-btn)' }}>
          <button
            type="button"
            className={`btn btn--sm ${tab === 'player' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setTab('player')}
            style={{ padding: '4px 12px', fontSize: '0.78rem', borderRadius: 'var(--radius-pill)' }}
          >
            Şimdi
          </button>
          <button
            type="button"
            className={`btn btn--sm ${tab === 'lyrics' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setTab('lyrics')}
            style={{ padding: '4px 12px', fontSize: '0.78rem', borderRadius: 'var(--radius-pill)' }}
          >
            Sözler
          </button>
          <button
            type="button"
            className={`btn btn--sm ${tab === 'queue' ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setTab('queue')}
            style={{ padding: '4px 12px', fontSize: '0.78rem', borderRadius: 'var(--radius-pill)' }}
          >
            Sıra
          </button>
        </div>

        <IconButton label="Radyo başlat" onClick={() => player.playRadio(track)}>
          <Radio size={20} strokeWidth={2.5} />
        </IconButton>
      </div>

      {/* Tab: Player */}
      {tab === 'player' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 20 }}>
          {/* Büyük Kapak Görseli */}
          <div style={{ width: '100%', maxWidth: 340, aspectRatio: '1/1', margin: '0 auto', border: 'var(--border-main)', borderRadius: 'var(--radius-main)', overflow: 'hidden', boxShadow: 'var(--shadow-main)', background: 'var(--muted)' }}>
            <Artwork src={track.cover_url} alt={`${track.title} kapağı`} seed={track.id} />
          </div>

          {/* Parça ve Sanatçı Bilgisi + Favori / Ekle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 4px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {track.title}
              </h2>
              <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {track.artist}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <IconButton
                label={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                active={fav}
                onClick={handleFavorite}
                style={{ background: fav ? 'var(--accent)' : 'var(--surface)', color: fav ? '#FFFFFF' : 'var(--text-primary)' }}
              >
                <Heart size={22} strokeWidth={2.5} fill={fav ? 'currentColor' : 'none'} />
              </IconButton>
              <IconButton label="Çalma listesine ekle" onClick={() => setDialogTrack(track)}>
                <ListPlus size={22} strokeWidth={2.5} />
              </IconButton>
            </div>
          </div>

          {/* Seeker / PulseRail */}
          <div>
            <PulseRail />
          </div>

          {/* Oynatma Kontrolleri */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
            <IconButton label="Karıştır" active={player.shuffle} onClick={player.toggleShuffle}>
              <Shuffle size={20} strokeWidth={2.5} />
            </IconButton>
            <IconButton label="Önceki parça" onClick={player.prev}>
              <SkipBack size={26} strokeWidth={2.5} fill="currentColor" />
            </IconButton>
            <button
              type="button"
              className="btn btn--primary"
              style={{ width: 64, height: 64, padding: 0, borderRadius: 'var(--radius-pill)' }}
              onClick={player.toggle}
              aria-label={player.playing ? 'Duraklat' : 'Çal'}
            >
              {player.playing ? <Pause size={28} strokeWidth={2.5} fill="currentColor" /> : <Play size={28} strokeWidth={2.5} fill="currentColor" />}
            </button>
            <IconButton label="Sonraki parça" onClick={player.next}>
              <SkipForward size={26} strokeWidth={2.5} fill="currentColor" />
            </IconButton>
            <IconButton
              label={player.repeat === 'off' ? 'Tekrar: kapalı' : player.repeat === 'context' ? 'Tekrar: liste' : 'Tekrar: parça'}
              active={player.repeat !== 'off'}
              onClick={player.cycleRepeat}
            >
              {player.repeat === 'track' ? <Repeat1 size={20} strokeWidth={2.5} /> : <Repeat size={20} strokeWidth={2.5} />}
            </IconButton>
          </div>
        </div>
      )}

      {/* Tab: Lyrics */}
      {tab === 'lyrics' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 16px', color: 'var(--text-primary)' }}>
            {track.title} Sözleri
          </h3>
          {lyricsLoading ? (
            <div aria-busy="true">
              <div className="skeleton skeleton--text" style={{ marginBottom: 10 }} />
              <div className="skeleton skeleton--text" style={{ width: '85%', marginBottom: 10 }} />
              <div className="skeleton skeleton--text" style={{ width: '70%', marginBottom: 10 }} />
              <div className="skeleton skeleton--text" style={{ width: '90%' }} />
            </div>
          ) : (
            <pre className="now-playing__lyrics" style={{ fontFamily: 'inherit' }}>
              {lyrics}
            </pre>
          )}
        </div>
      )}

      {/* Tab: Queue */}
      {tab === 'queue' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 16px', color: 'var(--text-primary)' }}>
            Sıradaki Parçalar
          </h3>
          <QueueList />
        </div>
      )}

      <AddToPlaylistDialog
        open={Boolean(dialogTrack)}
        track={dialogTrack}
        onClose={() => setDialogTrack(null)}
      />
    </div>
  )
}
