import { Heart, ListMusic, ListPlus, Pause, Play, Radio, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlayer } from '../../context/PlayerContext.jsx'
import { useLibrary } from '../../context/LibraryContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import Artwork from '../music/Artwork.jsx'
import IconButton from '../ui/IconButton.jsx'
import RangeSlider from '../ui/RangeSlider.jsx'
import PulseRail from './PulseRail.jsx'
import AddToPlaylistDialog from '../ui/AddToPlaylistDialog.jsx'
import { readFavoriteState } from '../../lib/uiState.js'

// Alt Sabit Oynatıcı Çubuğu (Global Player) — Çoklu Temaya Uyumlu Ses Konsolu
export default function GlobalPlayer() {
  const player = usePlayer()
  const { toggleFavorite, isFavorite } = useLibrary()
  const { toast } = useUI()
  const [dialogTrack, setDialogTrack] = useState(null)

  if (!player.current) return null

  const track = player.current
  const fav = isFavorite(track.id)

  const handleFavoriteToggle = async () => {
    try {
      const data = await toggleFavorite(track)
      toast(readFavoriteState(data) ? 'Favorilere eklendi.' : 'Favorilerden çıkarıldı.', 'success')
    } catch (error) {
      toast(`Favoriler güncellenemedi: ${error.message}`, 'error')
    }
  }

  const volumeIcon = () => {
    if (player.muted || player.volume === 0) return <VolumeX size={19} strokeWidth={2.5} />
    if (player.volume < 0.5) return <Volume1 size={19} strokeWidth={2.5} />
    return <Volume2 size={19} strokeWidth={2.5} />
  }

  return (
    <footer className="player-bar player-bar--desktop" aria-label="Ses Oynatıcısı">
      {/* Sol: Aktif Parça Bilgisi */}
      <div className="player-bar__now">
        <span className="player-bar__art">
          <Artwork src={track.cover_url} alt={`${track.title} kapağı`} seed={track.id} />
        </span>
        <div className="player-bar__meta">
          <Link to={`/track/${encodeURIComponent(track.id)}`} className="player-bar__title text-link">
            {track.title}
          </Link>
          <Link to={`/artist/${encodeURIComponent(track.artist)}`} className="player-bar__artist text-link">
            {track.artist}
          </Link>
        </div>
        <IconButton
          label={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
          active={fav}
          onClick={handleFavoriteToggle}
          className="icon-btn--sm"
          style={{ background: fav ? 'var(--accent)' : 'var(--surface)', color: fav ? '#FFFFFF' : 'var(--text-primary)' }}
        >
          <Heart size={16} strokeWidth={2.5} fill={fav ? 'currentColor' : 'none'} />
        </IconButton>
        <IconButton
          label="Çalma listesine ekle"
          onClick={() => setDialogTrack(track)}
          className="icon-btn--sm"
        >
          <ListPlus size={16} strokeWidth={2.5} />
        </IconButton>
      </div>

      {/* Orta: Kontroller & PulseRail Dalga Biçimi */}
      <div className="player-bar__center">
        <div className="player-bar__controls">
          <IconButton
            label={player.shuffle ? 'Karıştırmayı kapat' : 'Karıştırmayı aç'}
            active={player.shuffle}
            onClick={player.toggleShuffle}
          >
            <Shuffle size={17} strokeWidth={2.5} />
          </IconButton>

          <IconButton
            label="Önceki parça"
            onClick={player.prev}
          >
            <SkipBack size={20} strokeWidth={2.5} fill="currentColor" />
          </IconButton>

          <button
            type="button"
            className="btn btn--primary"
            style={{ width: 48, height: 48, padding: 0, borderRadius: 'var(--radius-pill)' }}
            onClick={player.toggle}
            aria-label={player.playing ? 'Duraklat' : 'Çal'}
          >
            {player.playing ? (
              <Pause size={22} strokeWidth={2.5} fill="currentColor" />
            ) : (
              <Play size={22} strokeWidth={2.5} fill="currentColor" style={{ marginLeft: 2 }} />
            )}
          </button>

          <IconButton
            label="Sonraki parça"
            onClick={player.next}
          >
            <SkipForward size={20} strokeWidth={2.5} fill="currentColor" />
          </IconButton>

          <IconButton
            label={
              player.repeat === 'off' ? 'Tekrar: kapalı'
              : player.repeat === 'context' ? 'Tekrar: liste'
              : 'Tekrar: parça'
            }
            active={player.repeat !== 'off'}
            onClick={player.cycleRepeat}
          >
            {player.repeat === 'track' ? (
              <Repeat1 size={17} strokeWidth={2.5} />
            ) : (
              <Repeat size={17} strokeWidth={2.5} />
            )}
          </IconButton>
        </div>

        <PulseRail />
      </div>

      {/* Sağ: Radyo, Sıra / Panel, Ses Kontrolleri */}
      <div className="player-bar__side">
        <IconButton
          label="Benzer parçalar radyosu başlat"
          onClick={() => player.playRadio(track)}
        >
          <Radio size={18} strokeWidth={2.5} />
        </IconButton>

        <IconButton
          label={player.nowPlayingPanel ? 'Sıra ve paneli gizle' : 'Sıra ve paneli göster'}
          active={player.nowPlayingPanel}
          onClick={player.toggleNowPlaying}
        >
          <ListMusic size={19} strokeWidth={2.5} />
        </IconButton>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
          <IconButton
            label={player.muted ? 'Sesi aç' : 'Sesi kapat'}
            onClick={player.toggleMute}
            className="icon-btn--sm"
          >
            {volumeIcon()}
          </IconButton>

          <div style={{ flex: 1 }}>
            <RangeSlider
              value={player.muted ? 0 : player.volume}
              max={1}
              step={0.01}
              label="Ses seviyesi"
              onChange={player.setVolume}
            />
          </div>
        </div>
      </div>

      <AddToPlaylistDialog
        open={Boolean(dialogTrack)}
        track={dialogTrack}
        onClose={() => setDialogTrack(null)}
      />
    </footer>
  )
}
