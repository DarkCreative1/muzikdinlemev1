import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as api from '../lib/api.js'
import { dedupeTracks } from '../lib/catalogSelectors.js'
import CollectionHero from '../components/music/CollectionHero.jsx'
import TrackTable from '../components/music/TrackTable.jsx'
import MediaShelf from '../components/music/MediaShelf.jsx'
import StateView from '../components/ui/StateView.jsx'
import { formatTime } from '../data/catalog.js'

// Tek Parça Detay Sayfası — Çoklu Temaya Uyumlu Parça Bilgisi ve Benzer Parçalar
export default function TrackPage() {
  const { trackId } = useParams()
  const navigate = useNavigate()
  const [track, setTrack] = useState(null)
  const [related, setRelated] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!trackId) return undefined
    const ctrl = new AbortController()
    setLoading(true)
    setError('')
    setTrack(null)
    setRelated([])

    api.getTrack(trackId, { signal: ctrl.signal })
      .then((trackData) => {
        if (ctrl.signal.aborted) return
        setTrack(trackData)
        setLoading(false)
        return api.getRadio(trackId, [], 12, { signal: ctrl.signal })
          .then((radioData) => {
            if (!ctrl.signal.aborted) setRelated(dedupeTracks((radioData?.tracks || []).filter((item) => item.id !== trackData.id)))
          })
          .catch(() => {
            if (!ctrl.signal.aborted) setRelated([])
          })
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          setError(err.message || 'Parça bulunamadı.')
          setLoading(false)
        }
      })

    return () => ctrl.abort()
  }, [trackId])

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
      </div>
    )
  }

  if (error || !track) {
    return (
      <StateView
        kind="error"
        title="Parça Bulunamadı"
        text={error || 'Bu parça katalogda bulunamadı.'}
        actionLabel="Geri Dön"
        onAction={() => navigate(-1)}
      />
    )
  }

  return (
    <div>
      <CollectionHero
        type="track"
        title={track.title}
        subtitle={track.artist}
        meta={track.album ? `${track.album} · ${formatTime(track.duration)}` : formatTime(track.duration)}
        coverUrl={track.cover_url}
        seed={track.id}
        tracks={[track]}
      />

      <div style={{ marginTop: 28 }}>
        <TrackTable
          tracks={[track]}
          contextName={track.title}
          contextId={`track-${track.id}`}
        />
      </div>

      {related.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <MediaShelf
            title="Benzer Parçalar"
            subtitle={`${track.artist} ve benzer sanatçıların parçaları`}
            items={related}
            type="track"
            horizontal
            contextName={`Radyo · ${track.artist}`}
            contextId={`radio-${track.id}`}
            to={(item) => `/track/${item.id}`}
          />
        </div>
      )}
    </div>
  )
}
