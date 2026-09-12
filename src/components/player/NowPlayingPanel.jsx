import { Download, Heart, ListPlus, Music, Pause, Play, Radio, User, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePlayer } from '../../context/PlayerContext.jsx'
import { useLibrary } from '../../context/LibraryContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import * as api from '../../lib/api.js'
import Artwork from '../music/Artwork.jsx'
import IconButton from '../ui/IconButton.jsx'
import QueueList from './QueueList.jsx'
import AddToPlaylistDialog from '../ui/AddToPlaylistDialog.jsx'
import { readFavoriteState } from '../../lib/uiState.js'

// Sağ "Şu An Çalıyor" Paneli — Çoklu Temaya Uyumlu Panel, Sözler & Sıra
export default function NowPlayingPanel() {
  const player = usePlayer()
  const { toggleFavorite, isFavorite } = useLibrary()
  const { toast } = useUI()
  const navigate = useNavigate()
  const [tab, setTab] = useState('now') // 'now' | 'lyrics' | 'queue'
  const [lyrics, setLyrics] = useState('')
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [dialogTrack, setDialogTrack] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const eqCanvasRef = useRef(null)
  const downloadCtrl = useRef(null)

  // Panel kapanırsa yarım indirme yoklaması state yazmasın.
  useEffect(() => () => downloadCtrl.current?.abort(), [])

  const track = player.current

  // Canlı Frekans Eşitleyicisi — Temaya Duyarlı Çizim
  useEffect(() => {
    if (!track || tab !== 'now') return undefined
    const canvas = eqCanvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr)
        canvas.height = Math.floor(height * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const computed = getComputedStyle(canvas)
      const accentColor = computed.getPropertyValue('--accent').trim() || '#4de8d6'
      const mutedColor = computed.getPropertyValue('--text-muted').trim() || 'rgba(150, 150, 150, 0.3)'

      const data = player.playing ? player.getFrequencyData() : null
      const bars = 26
      ctx.fillStyle = player.playing ? accentColor : mutedColor

      for (let i = 0; i < bars; i += 1) {
        const raw = data ? (data[Math.floor((i / bars) * data.length * 0.75)] || 0) / 255 : 0.15
        const amp = Math.max(0.1, raw * 0.95)
        const bw = (width / bars) * 0.7
        const x = i * (width / bars) + (width / bars) * 0.15
        const h = Math.max(4, amp * height)
        ctx.fillRect(x, height - h, bw, h)
      }
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [track, tab, player.playing, player.getFrequencyData])

  // Sözler Sekmesi — `/api/lyrics` çağrısı
  useEffect(() => {
    if (tab !== 'lyrics' || !track) {
      setLyrics('')
      return undefined
    }
    let alive = true
    setLyricsLoading(true)
    api.getLyrics(track.title, track.artist, track.duration || 0)
      .then((data) => {
        if (alive) setLyrics(data?.lyrics || 'Bu parça için söz bulunamadı.')
      })
      .catch(() => {
        if (alive) setLyrics('Sözler şu an alınamıyor.')
      })
      .finally(() => {
        if (alive) setLyricsLoading(false)
      })
    return () => { alive = false }
  }, [tab, track])

  if (!track) return null

  const fav = isFavorite(track.id)

  const handleFavoriteToggle = async () => {
    try {
      const data = await toggleFavorite(track)
      toast(readFavoriteState(data) ? 'Favorilere eklendi.' : 'Favorilerden çıkarıldı.', 'success')
    } catch (error) {
      toast(`Favoriler güncellenemedi: ${error.message}`, 'error')
    }
  }

  const handleDownload = async () => {
    if (downloading) return
    downloadCtrl.current?.abort()
    const ctrl = new AbortController()
    downloadCtrl.current = ctrl
    setDownloading(true)
    try {
      const start = await api.downloadTrack(track, { signal: ctrl.signal })
      let ready = start?.status === 'ready'
      if (!ready) {
        for (let attempt = 0; attempt < 6 && !ready; attempt += 1) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 1200)
            ctrl.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
          })
          if (ctrl.signal.aborted) return
          const status = await api.getDownloadStatus(track.id, { signal: ctrl.signal })
          ready = status?.status === 'ready' || status?.status === 'completed'
        }
      }
      if (ctrl.signal.aborted) return
      if (ready) {
        // window.open header taşıyamaz (token gider, 401 yenir) — fetch + blob ile indirilir.
        const token = (() => { try { return localStorage.getItem(api.AUTH_TOKEN_KEY) || '' } catch { return '' } })()
        const response = await fetch(api.getDownloadFileUrl(track.id), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: ctrl.signal,
        })
        if (!response.ok) throw new Error(`Dosya alınamadı (${response.status}).`)
        const blob = await response.blob()
        const objectUrl = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = `${track.artist || 'Artist'} - ${track.title || track.id}.mp3`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
        toast('İndirme tamamlandı.', 'success')
      } else {
        toast('İndirme arka planda devam ediyor.', 'info')
      }
    } catch (error) {
      if (ctrl.signal.aborted || error?.name === 'AbortError') return
      toast(`İndirme başlatılamadı: ${error.message}`, 'error')
    } finally {
      if (!ctrl.signal.aborted) setDownloading(false)
    }
  }

  return (
    <aside className="now-playing" aria-label="Şu An Çalıyor Paneli">
      {/* Sekmeler & Kapat Butonu */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div className="now-playing__tabs" style={{ flex: 1 }}>
          <button
            type="button"
            className={`now-playing__tab ${tab === 'now' ? 'is-active' : ''}`}
            onClick={() => setTab('now')}
          >
            Şimdi
          </button>
          <button
            type="button"
            className={`now-playing__tab ${tab === 'lyrics' ? 'is-active' : ''}`}
            onClick={() => setTab('lyrics')}
          >
            Sözler
          </button>
          <button
            type="button"
            className={`now-playing__tab ${tab === 'queue' ? 'is-active' : ''}`}
            onClick={() => setTab('queue')}
          >
            Sıra
          </button>
        </div>

        <IconButton
          label="Paneli kapat"
          onClick={player.closeNowPlaying}
          className="icon-btn--sm"
        >
          <X size={18} strokeWidth={2.5} />
        </IconButton>
      </div>

      <div className="now-playing__body">
        {/* Tab 1: Şimdi (Overview) */}
        {tab === 'now' && (
          <>
            <div className="now-playing__art">
              <Artwork
                src={track.cover_url}
                alt={`${track.title} kapağı`}
                seed={track.id}
              />
            </div>

            <div>
              <h2 className="now-playing__title">
                <Link className="text-link" to={`/track/${track.id}`}>
                  {track.title}
                </Link>
              </h2>
              <div className="now-playing__artist">
                <Link className="text-link" to={`/artist/${encodeURIComponent(track.artist)}`}>
                  {track.artist}
                </Link>
              </div>
              {track.album && (
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', marginTop: 4 }}>
                  <Link className="text-link" to={`/album/${encodeURIComponent(track.album)}`}>
                    {track.album}
                  </Link>
                </div>
              )}
            </div>

            {/* Aksiyon Butonları */}
            <div className="now-playing__actions">
              <IconButton
                label={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                active={fav}
                onClick={handleFavoriteToggle}
                style={{ background: fav ? 'var(--accent)' : 'var(--surface)', color: fav ? '#FFFFFF' : 'var(--text-primary)' }}
              >
                <Heart size={18} strokeWidth={2.5} fill={fav ? 'currentColor' : 'none'} />
              </IconButton>
              <IconButton
                label="Çalma listesine ekle"
                onClick={() => setDialogTrack(track)}
              >
                <ListPlus size={18} strokeWidth={2.5} />
              </IconButton>
              <IconButton
                label={downloading ? 'İndiriliyor…' : 'Parçayı indir'}
                onClick={handleDownload}
              >
                <Download size={18} strokeWidth={2.5} />
              </IconButton>
              <IconButton
                label="Radyo başlat"
                onClick={() => player.playRadio(track)}
              >
                <Radio size={18} strokeWidth={2.5} />
              </IconButton>
              <button
                type="button"
                className="btn btn--primary"
                style={{ width: 44, height: 44, padding: 0, borderRadius: 'var(--radius-pill)', marginLeft: 'auto' }}
                onClick={player.toggle}
                aria-label={player.playing ? 'Duraklat' : 'Çal'}
              >
                {player.playing ? <Pause size={20} strokeWidth={2.5} fill="currentColor" /> : <Play size={20} strokeWidth={2.5} fill="currentColor" style={{ marginLeft: 2 }} />}
              </button>
            </div>

            {/* Frekans Görselleştirici Tuvali */}
            <div style={{ background: 'var(--surface-raised)', border: 'var(--border-thin)', borderRadius: 'var(--radius-inner)', padding: '10px 14px', boxShadow: 'var(--shadow-btn)' }}>
              <canvas
                ref={eqCanvasRef}
                style={{ width: '100%', height: 36, display: 'block' }}
                aria-hidden="true"
              />
            </div>

            {player.loadingNote && (
              <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: 0, textAlign: 'center', color: 'var(--text-muted)' }}>
                {player.loadingNote}
              </p>
            )}

            {/* Sanatçı Mini Kartı */}
            <div
              style={{
                marginTop: 'auto',
                background: 'var(--surface-raised)',
                border: 'var(--border-thin)',
                borderRadius: 'var(--radius-inner)',
                padding: 14,
                boxShadow: 'var(--shadow-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 38,
                    height: 38,
                    background: 'var(--surface)',
                    border: 'var(--border-thin)',
                    borderRadius: 'var(--radius-inner)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--text-primary)',
                  }}
                >
                  <User size={20} strokeWidth={2.5} />
                </span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                    {track.artist}
                  </div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    Sanatçı Profili
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => navigate(`/artist/${encodeURIComponent(track.artist)}`)}
              >
                Profili Aç
              </button>
            </div>
          </>
        )}

        {/* Tab 2: Sözler (Lyrics) */}
        {tab === 'lyrics' && (
          <div>
            <div className="now-playing__title" style={{ fontSize: '1.15rem', marginBottom: 12 }}>
              {track.title} Sözleri
            </div>
            {lyricsLoading ? (
              <div aria-busy="true">
                <div className="skeleton skeleton--text" style={{ marginBottom: 8 }} />
                <div className="skeleton skeleton--text" style={{ width: '85%', marginBottom: 8 }} />
                <div className="skeleton skeleton--text" style={{ width: '70%', marginBottom: 8 }} />
                <div className="skeleton skeleton--text" style={{ width: '90%' }} />
              </div>
            ) : (
              <pre className="now-playing__lyrics" style={{ fontFamily: 'inherit' }}>
                {lyrics}
              </pre>
            )}
          </div>
        )}

        {/* Tab 3: Sıradaki Parçalar (Queue) */}
        {tab === 'queue' && (
          <div>
            <div className="now-playing__title" style={{ fontSize: '1.15rem', marginBottom: 12 }}>
              Sıradaki Parçalar
            </div>
            <QueueList />
          </div>
        )}
      </div>

      <AddToPlaylistDialog
        open={Boolean(dialogTrack)}
        track={dialogTrack}
        onClose={() => setDialogTrack(null)}
      />
    </aside>
  )
}
