import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as api from '../lib/api.js'
import { groupSearchResults } from '../lib/catalogSelectors.js'
import CollectionHero from '../components/music/CollectionHero.jsx'
import TrackTable from '../components/music/TrackTable.jsx'
import MediaShelf from '../components/music/MediaShelf.jsx'
import StateView from '../components/ui/StateView.jsx'

const albumHref = (item) => `/album/${encodeURIComponent(item.title)}?artist=${encodeURIComponent(item.artist || '')}`

// Sanatçı Detay Sayfası — Sanatçı Başlığı & Diskografi
export default function ArtistPage() {
  const { artistId } = useParams()
  const navigate = useNavigate()
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!artistId) return undefined
    const ctrl = new AbortController()
    const artistName = decodeURIComponent(artistId)
    setLoading(true)
    setError('')

    api.search(artistName, 50, { signal: ctrl.signal })
      .then((data) => {
        const rows = (data.results || data.tracks || []).filter((track) => {
          const name = String(track.artist || '').toLowerCase()
          return name.includes(artistName.toLowerCase()) || artistName.toLowerCase().includes(name)
        })
        setTracks(rows.length ? rows : (data.results || data.tracks || []))
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          setError(err.message || 'Sanatçı profili yüklenemedi.')
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => ctrl.abort()
  }, [artistId])

  if (loading) {
    return (
      <div aria-busy="true">
        <div className="hero">
          <div className="skeleton" style={{ width: 220, height: 220, borderRadius: '50%' }} />
          <div className="hero__body">
            <div className="skeleton skeleton--title" style={{ width: '45%', height: 36 }} />
            <div className="skeleton skeleton--text" style={{ width: '30%' }} />
          </div>
        </div>
        <div style={{ marginTop: 24 }}>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} style={{ display: 'flex', gap: 12, padding: '10px 0' }}>
              <div className="skeleton" style={{ width: 40, height: 40 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton skeleton--title" style={{ width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error && !tracks.length) {
    return (
      <StateView
        kind="error"
        title="Sanatçı Bulunamadı"
        text={error}
        actionLabel="Geri Dön"
        onAction={() => navigate(-1)}
      />
    )
  }

  const name = decodeURIComponent(artistId)
  const grouped = groupSearchResults(tracks)

  return (
    <div>
      <CollectionHero
        type="artist"
        title={name}
        subtitle="Doğrulanmış Sanatçı"
        coverUrl={tracks[0]?.cover_url}
        seed={name}
        tracks={tracks}
      />

      {/* Popüler Şarkılar */}
      <div style={{ marginTop: 28 }}>
        <h2 className="section-title" style={{ marginBottom: 14 }}>
          Popüler Şarkılar
        </h2>
        <TrackTable
          tracks={tracks.slice(0, 8)}
          contextName={name}
          contextId={`artist-${name}`}
          emptyText="Bu sanatçının parçası bulunamadı."
        />
      </div>

      {/* Albümler */}
      {grouped.albums.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <MediaShelf
            title="Diskografi & Albümler"
            items={grouped.albums}
            type="album"
            horizontal
            tracks={(item) => item.tracks}
            to={albumHref}
          />
        </div>
      )}
    </div>
  )
}
