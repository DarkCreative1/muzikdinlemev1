import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import * as api from '../lib/api.js'
import CollectionHero from '../components/music/CollectionHero.jsx'
import TrackTable from '../components/music/TrackTable.jsx'
import StateView from '../components/ui/StateView.jsx'

// Albüm Detay Sayfası — Neo-brutalist Hero + Parça Tablosu
export default function AlbumPage() {
  const { albumId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [tracks, setTracks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!albumId) return undefined
    const ctrl = new AbortController()
    const decodedAlbum = decodeURIComponent(albumId)
    const requestedArtist = searchParams.get('artist')?.trim() || ''
    const searchQuery = requestedArtist ? `${requestedArtist} ${decodedAlbum}` : decodedAlbum
    setLoading(true)
    setError('')

    api.search(searchQuery, 50, { signal: ctrl.signal })
      .then((data) => {
        const rows = (data.results || data.tracks || []).filter(
          (track) => track.album && String(track.album).toLowerCase() === decodedAlbum.toLowerCase(),
        ).filter((track) => !requestedArtist || String(track.artist || '').toLowerCase() === requestedArtist.toLowerCase())
        setTracks(rows)
        if (!rows.length) setError('Bu albüm katalogda bulunamadı.')
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          setError(err.message || 'Albüm bilgisi yüklenemedi.')
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => ctrl.abort()
  }, [albumId, searchParams])

  if (loading) {
    return (
      <div aria-busy="true">
        <div className="hero">
          <div className="skeleton" style={{ width: 220, height: 220 }} />
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
        title="Albüm Bulunamadı"
        text={error}
        actionLabel="Geri Dön"
        onAction={() => navigate(-1)}
      />
    )
  }

  const firstTrack = tracks[0]
  const title = firstTrack?.album || decodeURIComponent(albumId)

  return (
    <div>
      <CollectionHero
        type="album"
        title={title}
        subtitle={firstTrack?.artist}
        coverUrl={firstTrack?.cover_url}
        seed={albumId || title}
        tracks={tracks}
      />

      <div style={{ marginTop: 28 }}>
        <TrackTable
          tracks={tracks}
          contextName={title}
          contextId={`album-${albumId}`}
          emptyText="Bu albümde parça bulunamadı."
        />
      </div>
    </div>
  )
}
