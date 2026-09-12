import { Disc, Mic2, Music, Radio, Search, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as api from '../lib/api.js'
import { dedupeTracks, groupSearchResults } from '../lib/catalogSelectors.js'
import { useDebouncedSearch } from '../hooks/useDebouncedSearch.js'
import { usePlayer } from '../context/PlayerContext.jsx'
import MediaShelf from '../components/music/MediaShelf.jsx'
import TrackTable from '../components/music/TrackTable.jsx'
import Artwork from '../components/music/Artwork.jsx'
import StateView from '../components/ui/StateView.jsx'

const GENRE_PILLS = [
  { label: 'Trend', q: 'trend', color: 'var(--secondary)' },
  { label: 'Pop', q: 'pop', color: 'var(--accent)' },
  { label: 'Rock', q: 'rock', color: 'var(--muted)' },
  { label: 'Hip-Hop / Rap', q: 'rap', color: 'var(--cyan)' },
  { label: 'Elektronik', q: 'electronic', color: 'var(--lime)' },
  { label: 'Alternatif', q: 'alternatif', color: 'var(--secondary)' },
  { label: 'Akustik', q: 'akustik', color: 'var(--accent)' },
  { label: 'R&B', q: 'r&b', color: 'var(--muted)' },
]

const MAX_SEARCH_SHELF_ITEMS = 12

// Arama Sayfası — Debounce Arama, Tür Rozetleri ve Gruplu Sonuçlar
export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const player = usePlayer()
  const query = params.get('q') || ''
  const debounced = useDebouncedSearch(query, 300)
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [spotifyError, setSpotifyError] = useState('')
  const [spotifyLoading, setSpotifyLoading] = useState(false)
  const spotifyInputRef = useRef(null)

  useEffect(() => {
    const clean = debounced.trim()
    if (!clean) {
      setResults(null)
      setLoading(false)
      setError('')
      return undefined
    }

    const ctrl = new AbortController()
    setLoading(true)
    setError('')

    const request = clean.toLocaleLowerCase('tr-TR') === 'trend'
      ? api.getTrending(50, { signal: ctrl.signal })
      : api.search(clean, 50, { signal: ctrl.signal })

    request
      .then((data) => {
        const tracks = dedupeTracks(data.trending_tracks || data.results || data.tracks || [])
        setResults(groupSearchResults(tracks))
      })
      .catch((err) => {
        if (err.code !== 'TIMEOUT' && !ctrl.signal.aborted) {
          setError(err.message || 'Arama sırasında hata oluştu.')
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => ctrl.abort()
  }, [debounced])

  const handleSpotifyImport = async (event) => {
    event.preventDefault()
    const url = spotifyInputRef.current?.value.trim()
    if (!url) {
      setSpotifyError('Bir Spotify bağlantısı yapıştırın.')
      return
    }
    setSpotifyError('')
    // Arama yüklenmesiyle paylaşılmaz — debounced arama ile yarışıp
    // birbirinin setLoading(false)'unu ezmesi önlenir.
    setSpotifyLoading(true)

    try {
      const data = await api.getSpotifyLink(url)
      const tracks = dedupeTracks(data.results || data.tracks || [])
      if (!tracks.length) {
        setSpotifyError('Bu bağlantıdan parça çözülemedi.')
      } else {
        setResults(groupSearchResults(tracks))
        if (spotifyInputRef.current) spotifyInputRef.current.value = ''
      }
    } catch (err) {
      setSpotifyError(err.message || 'Spotify bağlantısı çözülemedi.')
    } finally {
      setSpotifyLoading(false)
    }
  }

  const topTrack = results?.tracks?.[0]

  return (
    <div>
      <span className="eyebrow">
        <Search size={13} strokeWidth={2.5} />
        Keşif & Arama
      </span>
      <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 5vw, 3.8rem)', margin: '6px 0 4px' }}>
        Ne Dinlemek İstersin?
      </h1>
      <p style={{ margin: '0 0 20px', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
        Şarkı, sanatçı veya albüm arayın ya da doğrudan Spotify bağlantısı yapıştırın.
      </p>

      {/* Spotify Bağlantısı İçe Aktarımı */}
      <form onSubmit={handleSpotifyImport} style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 580, marginBottom: 20 }}>
        <div className="global-search" style={{ margin: 0, flex: 1 }}>
          <Music size={19} strokeWidth={2.5} />
          <input
            ref={spotifyInputRef}
            placeholder="Spotify parça/albüm/playlist bağlantısı yapıştır…"
            aria-label="Spotify URL"
          />
        </div>
        <button type="submit" className="btn btn--soft" disabled={spotifyLoading}>
          {spotifyLoading ? 'Aktarılıyor…' : 'İçe Aktar'}
        </button>
      </form>
      {spotifyError && (
          <p role="status" aria-live="polite" style={{ color: 'var(--danger)', background: 'var(--danger-soft)', border: 'var(--border-thin)', borderRadius: 'var(--radius-inner)', padding: '6px 12px', fontSize: '0.88rem', fontWeight: 700, margin: '-10px 0 16px', display: 'inline-block' }}>
          {spotifyError}
        </p>
      )}

      {/* Arama Yapılmadığında Tür Hapları */}
      {!query && !results && !loading && (
        <div>
          <h2 className="section-title" style={{ fontSize: '1.25rem', marginBottom: 14 }}>
            Kategorilere Göz At
          </h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 32 }}>
            {GENRE_PILLS.map((pill) => (
              <button
                key={pill.label}
                type="button"
                className="btn btn--sm"
                style={{ background: pill.color, color: '#FFFFFF', borderRadius: 'var(--radius-pill)' }}
                onClick={() => setParams({ q: pill.q })}
              >
                {pill.label}
              </button>
            ))}
          </div>
          <StateView
            kind="search"
            title="Müzik Aramaya Başla"
            text="Yukarıdaki arama kutusuna bir şarkı adı, sanatçı veya albüm yazın."
          />
        </div>
      )}

      {/* Yükleniyor İskeleti */}
      {loading && (
        <div aria-busy="true">
          <div className="shelf__grid">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="media-card"><div className="skeleton skeleton--square" /></div>
            ))}
          </div>
        </div>
      )}

      {/* Hata Durumu */}
      {error && !loading && (
        <StateView
          kind="error"
          title="Arama Yapılamadı"
          text={error}
          actionLabel="Tekrar Dene"
          onAction={() => setParams({ q: query })}
        />
      )}

      {/* Arama Sonuçları */}
      {results && !loading && (
        <>
          {results.tracks.length === 0 && results.artists.length === 0 && results.albums.length === 0 ? (
            <StateView
              kind="search"
              title="Sonuç Bulunamadı"
              text={`"${query}" aramasıyla eşleşen şarkı veya sanatçı bulunamadı. Lütfen farklı anahtar kelimeler deneyin.`}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
              {/* En İyi Sonuç & Öne Çıkan Parçalar */}
              {topTrack && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, alignItems: 'start' }}>
                  {/* En İyi Sonuç Kartı */}
                  <div>
                    <h2 className="section-title" style={{ marginBottom: 14 }}>
                      En İyi Sonuç
                    </h2>
                    <div
                      className="media-card search-best-result-card"
                    >
                      <span style={{ width: 96, height: 96, border: 'var(--border-thin)', borderRadius: 'var(--radius-inner)', overflow: 'hidden', background: 'var(--surface)', boxShadow: 'var(--shadow-btn)' }}>
                        <Artwork src={topTrack.cover_url} alt={`${topTrack.title} kapağı`} seed={topTrack.id} />
                      </span>
                      <div>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 4px', color: 'var(--text-primary)' }}>
                          {topTrack.title}
                        </h3>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.95rem' }}>
                          {topTrack.artist} · <span className="eyebrow" style={{ margin: 0 }}>Şarkı</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn--primary"
                        style={{ alignSelf: 'flex-start', marginTop: 'auto' }}
                        onClick={() => player.playContext(results.tracks, 0, `Arama · ${query}`, `search-${query}`)}
                      >
                        Hemen Çal
                      </button>
                    </div>
                  </div>

                  {/* Öne Çıkan İlk 5 Parça Tablosu */}
                  <div style={{ minWidth: 0 }}>
                    <h2 className="section-title" style={{ marginBottom: 14 }}>
                      Şarkılar
                    </h2>
                    <TrackTable
                      tracks={results.tracks.slice(0, 5)}
                      contextName={`Arama · ${query}`}
                      contextId={`search-${query}`}
                    />
                  </div>
                </div>
              )}

              {/* Sanatçılar */}
              {results.artists.length > 0 && (
                <MediaShelf
                  title="Sanatçılar"
                  subtitle={`Eşleşen sanatçı profilleri${results.artists.length > MAX_SEARCH_SHELF_ITEMS ? ` · İlk ${MAX_SEARCH_SHELF_ITEMS} gösteriliyor` : ''}`}
                  items={results.artists.slice(0, MAX_SEARCH_SHELF_ITEMS).map((artist) => ({
                    name: artist.name,
                    cover_url: artist.tracks[0]?.cover_url,
                    id: artist.name,
                    tracks: artist.tracks,
                  }))}
                  type="artist"
                  horizontal
                  to={(item) => `/artist/${encodeURIComponent(item.name)}`}
                />
              )}

              {/* Albümler */}
              {results.albums.length > 0 && (
                <MediaShelf
                  title="Albümler"
                  subtitle={`Eşleşen albüm kayıtları${results.albums.length > MAX_SEARCH_SHELF_ITEMS ? ` · İlk ${MAX_SEARCH_SHELF_ITEMS} gösteriliyor` : ''}`}
                  items={results.albums.slice(0, MAX_SEARCH_SHELF_ITEMS)}
                  type="album"
                  horizontal
                  tracks={(item) => item.tracks}
                  to={(item) => `/album/${encodeURIComponent(item.title)}?artist=${encodeURIComponent(item.artist || '')}`}
                />
              )}

              {/* Tüm Parça Sonuçları */}
              {results.tracks.length > 5 && (
                <div>
                  <h2 className="section-title" style={{ marginBottom: 14 }}>
                    Tüm Şarkı Sonuçları ({results.tracks.length})
                  </h2>
                  <TrackTable
                    tracks={results.tracks}
                    contextName={`Arama · ${query}`}
                    contextId={`search-${query}`}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
