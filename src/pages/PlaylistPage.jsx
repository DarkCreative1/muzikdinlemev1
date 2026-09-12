import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as api from '../lib/api.js'
import { useLibrary } from '../context/LibraryContext.jsx'
import { useUI } from '../context/UIContext.jsx'
import CollectionHero from '../components/music/CollectionHero.jsx'
import TrackTable from '../components/music/TrackTable.jsx'
import StateView from '../components/ui/StateView.jsx'

// Çalma Listesi Detay Sayfası — Çoklu Temaya Uyumlu Hero, Parça Tablosu ve Yönetim
export default function PlaylistPage() {
  const { playlistId } = useParams()
  const navigate = useNavigate()
  const { deletePlaylist, removeFromPlaylist } = useLibrary()
  const { toast } = useUI()
  const [playlist, setPlaylist] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!playlistId) return undefined
    const ctrl = new AbortController()
    setLoading(true)
    setError('')

    api.getPlaylist(playlistId, { signal: ctrl.signal })
      .then((data) => setPlaylist(data))
      .catch((err) => {
        if (!ctrl.signal.aborted) {
          setError(err.message || 'Çalma listesi bulunamadı.')
          setPlaylist(null)
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => ctrl.abort()
  }, [playlistId])

  const handleDelete = async () => {
    try {
      await deletePlaylist(playlistId)
      toast('Çalma listesi silindi.', 'success')
      navigate('/library', { replace: true })
    } catch (err) {
      toast(`Silinemedi: ${err.message}`, 'error')
    }
  }

  const handleRemoveTrack = async (track) => {
    try {
      const updated = await removeFromPlaylist(playlistId, track.id)
      setPlaylist(updated)
      toast(`"${track.title}" listeden çıkarıldı.`, 'success')
    } catch (err) {
      toast(`Parça çıkarılamadı: ${err.message}`, 'error')
    }
  }

  if (loading) {
    return (
      <div aria-busy="true">
        <div className="hero">
          <div className="skeleton" style={{ width: 220, height: 220 }} />
          <div className="hero__body">
            <div className="skeleton skeleton--title" style={{ width: '40%', height: 36 }} />
            <div className="skeleton skeleton--text" style={{ width: '60%' }} />
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

  if (error || !playlist) {
    return (
      <StateView
        kind="error"
        title="Çalma Listesi Bulunamadı"
        text={error || 'Bu çalma listesi silinmiş veya taşınmış olabilir.'}
        actionLabel="Kitaplığa Dön"
        onAction={() => navigate('/library')}
      />
    )
  }

  return (
    <div>
      <CollectionHero
        type="playlist"
        title={playlist.name || 'Adsız Liste'}
        subtitle={playlist.description || 'Özel Çalma Listesi'}
        meta={playlist.created_at ? `Oluşturulma: ${new Date(playlist.created_at).toLocaleDateString('tr-TR')}` : undefined}
        coverUrl={playlist.tracks?.[0]?.cover_url}
        seed={playlist.id}
        tracks={playlist.tracks || []}
        onDelete={handleDelete}
      />

      <div style={{ marginTop: 28 }}>
        <TrackTable
          tracks={playlist.tracks || []}
          contextName={playlist.name}
          contextId={`playlist-${playlist.id}`}
          emptyText="Bu listede henüz parça yok. Parçaların yanındaki menüden ekleyebilirsiniz."
          onRemoveTrack={handleRemoveTrack}
        />
      </div>
    </div>
  )
}