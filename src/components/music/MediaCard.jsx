import { Pause, Play } from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePlayer } from '../../context/PlayerContext.jsx'
import Artwork from './Artwork.jsx'

// Neo-brutalist Medya Kartı — Şarkı / Albüm / Sanatçı / Playlist
export default function MediaCard({
  item,
  type = 'track',
  to,
  tracks,
  index = 0,
  contextId,
  contextName,
  onMenu,
}) {
  const player = usePlayer()
  const title = item.title || item.name || 'Adsız'
  const subtitle =
    type === 'artist' ? 'SANATÇI'
    : type === 'album' ? (item.artist || 'ALBÜM')
    : type === 'playlist' ? (item.owner || item.description || 'ÇALMA LİSTESİ')
    : (item.artist || 'PARÇA')

  const active = type === 'track' && player.current?.id === item.id

  const handlePlay = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (active) {
      player.toggle()
    } else {
      const trackList = tracks?.length ? tracks : (item.tracks?.length ? item.tracks : [item])
      player.playContext(
        trackList,
        index,
        contextName || title,
        contextId || `${type}-${item.id || title}`,
      )
    }
  }

  return (
    <article className="media-card" onContextMenu={onMenu}>
      <Link
        className="media-card__link"
        to={to}
        aria-label={`${title} (${subtitle}) ayrıntılarını aç`}
      >
        <span className="media-card__art-shell">
          <Artwork
            src={item.cover_url}
            alt={`${title} kapağı`}
            seed={item.id || title}
            shape={type === 'artist' ? 'circle' : 'square'}
          />
        </span>
        <span className="media-card__title" title={title}>
          {title}
        </span>
        <span className="media-card__subtitle">
          {subtitle}
        </span>
      </Link>

      <button
        type="button"
        className={`media-card__play ${active ? 'is-visible' : ''}`}
        onClick={handlePlay}
        aria-label={active && player.playing ? `${title} duraklat` : `${title} çal`}
      >
        {active && player.playing ? (
          <Pause size={22} strokeWidth={3} fill="currentColor" />
        ) : (
          <Play size={22} strokeWidth={3} fill="currentColor" style={{ marginLeft: 2 }} />
        )}
      </button>
    </article>
  )
}