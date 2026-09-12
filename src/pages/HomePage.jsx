import { Clock, Download, Flame, Heart, ListMusic, Play, Radio, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api.js'
import { dedupeTracks, groupSearchResults } from '../lib/catalogSelectors.js'
import { useLibrary } from '../context/LibraryContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'
import MediaShelf from '../components/music/MediaShelf.jsx'
import Artwork from '../components/music/Artwork.jsx'
import StateView from '../components/ui/StateView.jsx'

// Ana Sayfa — Müzik Akışı, Bento Grid & Raflar
export default function HomePage() {
  const { user } = useAuth()
  const { favorites, history, library, loading: libraryLoading } = useLibrary()
  const player = usePlayer()
  const [trending, setTrending] = useState([])
  const [featured, setFeatured] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    const loadHome = async () => {
      try {
        setLoading(true)
        setError('')
        const data = await api.getTrending(30, { signal: ctrl.signal })
        if (ctrl.signal.aborted) return
        const tracks = data.trending_tracks || data.tracks || []
        setTrending(tracks)
        setFeatured(data.featured_playlists || [])
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setError('Öneriler şu an alınamıyor. Sunucunun çalıştığından emin olun.')
        }
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }
    void loadHome()
    return () => ctrl.abort()
  }, [])

  const greeting = (() => {
    const hour = new Date().getHours()
    if (hour < 6) return 'İyi Geceler'
    if (hour < 12) return 'Günaydın'
    if (hour < 18) return 'İyi Günler'
    return 'İyi Akşamlar'
  })()

  const recent = dedupeTracks(history.slice(0, 10))
  const groupedTrending = groupSearchResults(trending)

  const quickTiles = [
    {
      label: 'Beğenilen Şarkılar',
      to: '/library?tab=favorites',
      icon: <Heart size={22} strokeWidth={2.5} fill="currentColor" />,
      tracks: favorites,
      color: 'var(--secondary)',
    },
    {
      label: 'Son Dinlenenler',
      to: '/library?tab=history',
      icon: <Clock size={22} strokeWidth={2.5} />,
      tracks: history,
      color: 'var(--accent)',
    },
    {
      label: 'İndirilen Kitaplık',
      to: '/library?tab=library',
      icon: <Download size={22} strokeWidth={2.5} />,
      tracks: library,
      color: 'var(--muted)',
    },
    {
      label: 'Türkiye Trendleri',
      to: '/search?q=trend',
      icon: <Flame size={22} strokeWidth={2.5} />,
      tracks: trending,
      color: 'var(--cyan)',
    },
  ]

  // İskelet, iki kaynaktan biri yüklenirken gösterilir (ikisi birden beklenmez).
  if (loading || libraryLoading) {
    return (
      <div aria-busy="true">
        <div className="skeleton skeleton--title" style={{ width: 260, height: 36, marginBottom: 20 }} />
        <div className="quick-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ height: 68 }} />
          ))}
        </div>
        <div className="shelf" style={{ marginTop: 36 }}>
          <div className="skeleton skeleton--title" style={{ width: 180, marginBottom: 16 }} />
          <div className="shelf__grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="media-card"><div className="skeleton skeleton--square" /></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error && !trending.length && !history.length) {
    return (
      <StateView
        kind="error"
        title="Bağlantı Kurulamadı"
        text={error}
        actionLabel="Tekrar Dene"
        onAction={loadHome}
      />
    )
  }

  return (
    <div>
      {/* Karşılama Başlığı */}
      <span className="eyebrow">
        <Sparkles size={13} strokeWidth={2.5} />
        Müzik Akışı
      </span>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 5vw, 3.8rem)', margin: '6px 0 4px' }}>
        {greeting}{user?.display_name ? `, ${user.display_name}` : ''}
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: '0.96rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
        Senin için derlenen çalma listeleri, trend parçalar ve son dinlediklerin.
      </p>

      {/* Hızlı Erişim Bento Grid */}
      <div className="quick-grid">
        {quickTiles.map((tile) => (
          <div key={tile.label} className="quick-tile">
            <Link to={tile.to} style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
              <span
                className="quick-tile__art"
                style={{
                  background: tile.color,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#FFFFFF',
                }}
              >
                {tile.icon}
              </span>
              <span className="quick-tile__title">{tile.label}</span>
            </Link>
            {tile.tracks?.length > 0 && (
              <button
                type="button"
                className="quick-tile__play"
                onClick={() => player.playContext(tile.tracks, 0, tile.label, `quick-${tile.label}`)}
                aria-label={`${tile.label} listesini çal`}
              >
                <Play size={17} strokeWidth={2.5} fill="currentColor" style={{ marginLeft: 2 }} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Kaldığın Yerden Devam Et / Son Dinlenenler */}
      {recent.length > 0 && (
        <section className="shelf">
          <div className="shelf__header">
            <h2 className="section-title">
              <Clock size={20} strokeWidth={2.5} />
              Kaldığın Yerden Devam Et
            </h2>
            <Link to="/library?tab=history" className="text-link" style={{ fontSize: '0.88rem' }}>
              Tümünü Gör
            </Link>
          </div>
          <div className="shelf__grid">
            {recent.slice(0, 6).map((track, index) => {
              const active = player.current?.id === track.id
              return (
                <article key={track.id} className="media-card">
                  <Link
                    className="media-card__link"
                    to={`/track/${track.id}`}
                    aria-label={`${track.title} (${track.artist}) ayrıntıları`}
                  >
                    <span className="media-card__art-shell">
                       <Artwork src={track.cover_url} alt={`${track.title} kapağı`} seed={track.id} />
                    </span>
                    <span className="media-card__title" title={track.title}>{track.title}</span>
                    <span className="media-card__subtitle">{track.artist}</span>
                  </Link>
                  <button
                    type="button"
                    className={`media-card__play ${active ? 'is-visible' : ''}`}
                    onClick={() => {
                      if (active) player.toggle()
                      else player.playContext(recent, index, 'Son dinlenenler', 'home-recent')
                    }}
                    aria-label={active && player.playing ? `${track.title} duraklat` : `${track.title} çal`}
                  >
                    <Play size={20} strokeWidth={2.5} fill="currentColor" style={{ marginLeft: 2 }} />
                  </button>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {/* Türkiye'de Trend */}
      <MediaShelf
        title="Türkiye'de Trend"
        subtitle="En çok dinlenen güncel parçalar"
        items={trending}
        type="track"
        horizontal
        contextName="Türkiye'de Trend"
        contextId="home-trending"
        to={(item) => `/track/${item.id}`}
      />

      {/* Popüler Sanatçılar */}
      {groupedTrending.artists.length > 0 && (
        <MediaShelf
          title="Popüler Sanatçılar"
          subtitle="Trendlerde öne çıkan isimler"
          items={groupedTrending.artists.map((artist) => ({
            name: artist.name,
            cover_url: artist.tracks[0]?.cover_url,
            id: artist.name,
            tracks: artist.tracks,
          }))}
          type="artist"
          horizontal
          contextName="Popüler Sanatçılar"
          contextId="home-artists"
          to={(item) => `/artist/${encodeURIComponent(item.name)}`}
        />
      )}

      {/* Popüler Albümler & Mix'ler */}
      {groupedTrending.albums.length > 0 && (
        <MediaShelf
          title="Öne Çıkan Albümler"
          subtitle="Koleksiyonluk albüm kayıtları"
          items={groupedTrending.albums}
          type="album"
          horizontal
          contextName="Öne Çıkan Albümler"
          contextId="home-albums"
          tracks={(item) => item.tracks}
          to={(item) => `/album/${encodeURIComponent(item.title)}?artist=${encodeURIComponent(item.artist || '')}`}
        />
      )}

      {/* Öne Çıkan Çalma Listeleri */}
      {featured.length > 0 && (
        <MediaShelf
          title="Senin İçin Mix'ler"
          subtitle="Ruh haline ve türlere özel seçkiler"
          items={featured}
          type="playlist"
          horizontal
          contextName="Öne Çıkanlar"
          contextId="home-featured"
          to={(item) => `/search?q=${encodeURIComponent(item.title || '')}`}
        />
      )}
    </div>
  )
}
