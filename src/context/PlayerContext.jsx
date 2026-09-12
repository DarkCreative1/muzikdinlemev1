import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import * as api from '../lib/api.js'
import { waitForDownloadReady } from '../lib/streamAvailability.js'
import { createInitialPlayerState, playerReducer } from '../store/playerReducer.js'
import { useAuth } from './AuthContext.jsx'
import { useUI } from './UIContext.jsx'

const PlayerContext = createContext(null)

const loadPrefs = () => {
  try { return JSON.parse(localStorage.getItem('wavebox-player-prefs') || '{}') } catch { return {} }
}

const classifyRadioSkip = (progress, duration) => {
  const played = Math.max(0, Number(progress) || 0)
  const total = Math.max(0, Number(duration) || 0)
  if (!total || played <= 0) return null
  if (total - played <= 20) return 'late'
  if (played <= 20 || played / total <= 0.2) return 'early'
  return null
}

export function PlayerProvider({ children }) {
  const prefs = useRef(loadPrefs()).current
  const [state, dispatch] = useReducer(playerReducer, undefined, () => createInitialPlayerState())
  const [resolveNonce, setResolveNonce] = useState(0)
  const [loadingNote, setLoadingNote] = useState('')
  const [nowPlayingPanel, setNowPlayingPanel] = useState(false)
  const audioRef = useRef(null)
  const requestRef = useRef(0)
  // resolve effect [current?.id] ile çalışır; playing kapanış değeri bayatlar —
  // hızlı parça değiştirmede yanlış play/pause senkronunu önlemek için ref aynası.
  const playingRef = useRef(false)
  playingRef.current = state.playing
  const retryRef = useRef(0)
  const playedRef = useRef('')
  const tickSecRef = useRef(-1)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const radioRequestRef = useRef(0)
  const auth = useAuth()
  const { toast, openAuthPrompt } = useUI()

  const current = state.index >= 0 && state.index < state.queue.length ? state.queue[state.index] : null

  if (!audioRef.current && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
    audioRef.current.preload = 'auto'
  }

  // Tercihleri yükle (ses, tekrar, karıştırma) — kullanıcı etkileşiminden bağımsız
  useEffect(() => {
    if (typeof prefs.volume === 'number') dispatch({ type: 'VOLUME', value: prefs.volume })
    if (typeof prefs.muted === 'boolean') dispatch({ type: 'SET_MUTED', value: prefs.muted })
    // Kayıtlı tekrar değeri birebir geri yüklenir (CYCLE_REPEAT döngü hatası düzeltildi).
    if (['off', 'context', 'track'].includes(prefs.repeat)) dispatch({ type: 'SET_REPEAT', value: prefs.repeat })
    if (prefs.shuffle === true) dispatch({ type: 'TOGGLE_SHUFFLE' })
  }, [])

  // Tercihleri sakla
  useEffect(() => {
    try {
      localStorage.setItem('wavebox-player-prefs', JSON.stringify({
        volume: state.volume,
        muted: state.muted,
        repeat: state.repeat,
        shuffle: state.shuffle,
      }))
    } catch { /* gizlilik modunda sessiz */ }
  }, [state.volume, state.muted, state.repeat, state.shuffle])

  // Sıradaki parçaları önceden indir (kesintisiz çalma)
  useEffect(() => {
    if (!state.playing) return
    const next = state.queue[state.index + 1]
    const after = state.queue[state.index + 2]
    if (next) api.downloadTrack(next).catch(() => {})
    if (after) api.downloadTrack(after).catch(() => {})
  }, [state.playing, state.queue, state.index])

  // Parça değişince akışı çöz ve yükle
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !current) {
      if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
      return undefined
    }
    const ctrl = new AbortController()
    const requestId = ++requestRef.current
    dispatch({ type: 'CLEAR_ERROR' })
    playedRef.current = ''
    tickSecRef.current = -1
    api.resolveStream(current, { signal: ctrl.signal })
      .then(async (result) => {
        if (requestId !== requestRef.current) return
        try {
          await waitForDownloadReady(api.getDownloadStatus, current.id, { signal: ctrl.signal, timeoutMs: 4000 }).catch(() => {})
        } catch { /* akış yine de oynatılabilir */ }
        if (requestId !== requestRef.current) return
        audio.src = result.url
        audio.currentTime = 0
        audio.load()
        if (playingRef.current) {
          audio.play().catch(() => { /* autoplay engeli toggle'da ele alınır */ })
        }
      })
      .catch((error) => {
        if (requestId !== requestRef.current || ctrl.signal.aborted) return
        // Son çare: çözümleyici başarısız olursa doğrudan akış ucunu dene
        try {
          audio.src = api.streamUrl(current.id)
          audio.currentTime = 0
          audio.load()
          if (playingRef.current) audio.play().catch(() => {})
          dispatch({ type: 'CLEAR_ERROR' })
          return
        } catch { /* fallback de başarısız — aşağıda raporla */ }
        dispatch({ type: 'SET_ERROR', message: error.message })
        toast(`Oynatma bağlantısı alınamadı: ${error.message}`, 'error')
      })
    return () => ctrl.abort()
  }, [current?.id, resolveNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // Oynat/duraklat senkronu
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!state.playing) {
      if (!audio.paused) audio.pause()
      return
    }
    if (!audio.src) return
    if (audio.paused) {
      audio.play().catch((error) => {
        dispatch({ type: 'SET_ERROR', message: error.message || 'Oynatma başlatılamadı.' })
        toast('Tarayıcı oynatmayı engelledi veya akış kullanılamıyor.', 'error')
      })
    }
  }, [state.playing, toast])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = state.muted ? 0 : state.volume
  }, [state.volume, state.muted])

  // İndirme durumu bildirimi — "neden başlamıyor" hissi olmasın
  useEffect(() => {
    if (!current || state.error) { setLoadingNote(''); return }
    let alive = true
    const tick = async () => {
      try {
        const st = await api.getDownloadStatus(current.id, { timeout: 5000 })
        if (!alive) return
        if (st.status === 'downloading' && Number.isFinite(st.progress)) setLoadingNote(`İndiriliyor · %${Math.min(99, Math.round(st.progress))}`)
        else if (st.status === 'queued') setLoadingNote('Sırada bekliyor…')
        else if (st.status === 'idle') setLoadingNote('Kaynak aranıyor…')
        else if (st.status === 'completed') setLoadingNote('Neredeyse hazır…')
        else setLoadingNote('')
      } catch { /* durum yoksa sessiz geç */ }
    }
    void tick()
    const timer = setInterval(tick, 1500)
    return () => { alive = false; clearInterval(timer) }
  }, [current?.id, state.error])

  // Web Audio Analyser — PulseRail için gerçek dalga verisi
  const ensureAnalyser = useCallback(() => {
    try {
      const audio = audioRef.current
      if (!audio || typeof AudioContext === 'undefined') return null
      if (analyserRef.current) {
        // Autoplay politikasında askıda kalmış context'i uyandır.
        if (audioContextRef.current?.state === 'suspended') void audioContextRef.current.resume().catch(() => {})
        return analyserRef.current
      }
      // Aynı elemente ikinci kez kaynak bağlamak exception atar — bayrakla korunur.
      if (audio._waveboxSource) return null
      const context = new AudioContext()
      const source = context.createMediaElementSource(audio)
      audio._waveboxSource = true
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.82
      source.connect(analyser)
      analyser.connect(context.destination)
      if (context.state === 'suspended') void context.resume().catch(() => {})
      audioContextRef.current = context
      analyserRef.current = analyser
      return analyser
    } catch {
      return null
    }
  }, [])

  // Analyser varsa zaman-alanı (dalga) verisi döndür, yoksa null
  const getWaveData = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return null
    try {
      const buffer = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(buffer)
      return buffer
    } catch { return null }
  }, [])

  const getFrequencyData = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return null
    try {
      const buffer = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(buffer)
      return buffer
    } catch { return null }
  }, [])

  // Radyo: kişisel sinyallere göre yeni bir öneri paketi getir ve mevcut sıranın arkasına ekle.
  const extendRadio = useCallback(async (track, { autoAdvance = false, initial = false } = {}) => {
    if (auth.loading || !auth.user) {
      if (autoAdvance) dispatch({ type: 'NEXT' })
      return
    }
    const requestId = ++radioRequestRef.current
    try {
      const exclude = [...new Set([
        track?.id,
        ...state.queue.map((item) => item.id),
        ...(state.radio?.seenIds || []),
      ].filter(Boolean))]
      const data = await api.getRadio(track.id, exclude, 24, { timeout: 15000 })
      if (requestId !== radioRequestRef.current) return
      const tracks = (data.tracks || []).filter(Boolean)
      if (!tracks.length) {
        if (autoAdvance) dispatch({ type: 'NEXT' })
        return
      }
      dispatch({ type: 'RADIO_APPEND', tracks, autoAdvance })
      toast(`${initial ? 'Kişisel radyo başladı' : 'Radyo devam ediyor'} · ${Math.min(12, tracks.length)} öneri sıraya eklendi`)
    } catch {
      if (requestId === radioRequestRef.current && autoAdvance) dispatch({ type: 'NEXT' })
    }
  }, [auth.loading, auth.user, state.queue, state.radio?.seenIds, toast])

  // Audio olayları
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return undefined
    const onTime = () => {
      const second = Math.floor(audio.currentTime)
      if (second !== tickSecRef.current) {
        tickSecRef.current = second
        dispatch({ type: 'SET_PROGRESS', value: audio.currentTime })
      }
    }
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) dispatch({ type: 'SET_DURATION', value: audio.duration })
    }
    const onPlay = () => {
      dispatch({ type: 'SET_PLAYING', value: true })
    }
    const onPause = () => {
      if (audio.ended) return
      dispatch({ type: 'SET_PLAYING', value: false })
    }
    const onEnded = () => {
      const loopsSameTrack = state.repeat === 'track' || (state.repeat === 'context' && state.queue.length <= 1)
      if (loopsSameTrack) {
        // Tek parça döngüsü: başa sar ve çalmaya devam et.
        // NEXT dispatch edilmez — reducer zaten repeat==='track' durumunu korur.
        try { audio.currentTime = 0 } catch { /* sessiz */ }
        tickSecRef.current = 0
        dispatch({ type: 'SET_PROGRESS', value: 0 })
        audio.play().catch(() => {})
        return
      }
      const atLastTrack = state.index >= state.queue.length - 1
      if (state.repeat === 'off' && atLastTrack && state.queue[state.index]) {
        if (auth.loading || !auth.user) {
          dispatch({ type: 'SET_PLAYING', value: false })
          return
        }
        if (!state.radio?.active) dispatch({ type: 'START_RADIO', seed: state.queue[state.index] })
        dispatch({ type: 'SET_PLAYING', value: false })
        void extendRadio(state.queue[state.index], { autoAdvance: true, initial: !state.radio?.active })
        return
      }
      dispatch({ type: 'NEXT' })
    }
    const onPlaying = () => {
      const track = state.queue[state.index]
      if (!track) return
      const key = `${track.id}:${requestRef.current}`
      if (playedRef.current !== key) {
        playedRef.current = key
        api.recordPlay(track.id).catch(() => {})
      }
      retryRef.current = 0
      dispatch({ type: 'CLEAR_ERROR' })
      dispatch({ type: 'SET_PLAYING', value: true })
      if (!analyserRef.current) ensureAnalyser()
    }
    const onError = () => {
      if (retryRef.current < 1 && state.queue[state.index]) {
        retryRef.current += 1
        setResolveNonce((n) => n + 1)
        return
      }
      const message = audio.error?.message || 'Ses akışı yüklenemedi.'
      dispatch({ type: 'SET_ERROR', message })
      toast(message, 'error')
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('error', onError)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('error', onError)
    }
  }, [state.queue, state.index, state.repeat, extendRadio, ensureAnalyser, toast])

  // Media Session — sistem medya tuşları, kilit ekranı, bildirimler
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return undefined
    // Kuyruk boşaldıysa eski şarkı kilit ekranında kalmasın.
    if (!current) {
      try {
        navigator.mediaSession.metadata = null
        for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']) {
          navigator.mediaSession.setActionHandler(action, null)
        }
      } catch { /* media session desteklenmiyorsa sessiz */ }
      return undefined
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist,
        album: current.album || '',
        artwork: current.cover_url ? [{ src: current.cover_url, sizes: '512x512', type: 'image/jpeg' }] : [],
      })
      navigator.mediaSession.setActionHandler('play', () => dispatch({ type: 'SET_PLAYING', value: true }))
      navigator.mediaSession.setActionHandler('pause', () => dispatch({ type: 'SET_PLAYING', value: false }))
      navigator.mediaSession.setActionHandler('previoustrack', () => dispatch({ type: 'PREV' }))
      navigator.mediaSession.setActionHandler('nexttrack', () => dispatch({ type: 'NEXT' }))
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        // Yalnızca reducer'a yazmak sesi oynatmaz — audio elementine de yazılır.
        if (Number.isFinite(details.seekTime)) {
          const audio = audioRef.current
          if (audio) {
            try { audio.currentTime = Number(details.seekTime) } catch { /* sessiz */ }
          }
          dispatch({ type: 'SEEK', value: details.seekTime })
        }
      })
    } catch { /* media session desteklenmiyorsa sessiz */ }
    return undefined
  }, [current])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try { navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused' } catch { /* sessiz */ }
  }, [state.playing])

  // ---- Kontroller ----
  const playContext = useCallback((tracks, startIndex = 0, contextName = '', contextId = null) => {
    ensureAnalyser()
    dispatch({
      type: 'PLAY_CONTEXT',
      tracks,
      startIndex,
      contextName,
      contextId,
      shuffle: false,
    })
  }, [ensureAnalyser])

  const playShuffled = useCallback((tracks, contextName = '', contextId = null) => {
    ensureAnalyser()
    dispatch({ type: 'PLAY_CONTEXT', tracks, startIndex: 0, contextName, contextId, shuffle: true })
  }, [ensureAnalyser])

  const recordRadioSkip = useCallback((track = current) => {
    if (!state.radio?.active || !track) return
    const kind = classifyRadioSkip(state.progress, state.duration)
    if (kind) dispatch({ type: 'RADIO_FEEDBACK', kind, artist: track.artist })
  }, [current, state.duration, state.progress, state.radio?.active])

  const jump = useCallback((index) => {
    if (Number(index) !== state.index) recordRadioSkip()
    dispatch({ type: 'SET_CURRENT', index, playing: true })
  }, [recordRadioSkip, state.index])

  const next = useCallback(() => {
    recordRadioSkip()
    const atLastTrack = state.index >= 0 && state.index >= state.queue.length - 1
    if (state.radio?.active && atLastTrack && current) {
      dispatch({ type: 'SET_PLAYING', value: false })
      void extendRadio(current, { autoAdvance: true })
      return
    }
    dispatch({ type: 'NEXT' })
  }, [current, extendRadio, recordRadioSkip, state.index, state.queue.length, state.radio?.active])
  const prev = useCallback(() => dispatch({ type: 'PREV' }), [])
  const toggle = useCallback(() => dispatch({ type: 'TOGGLE_PLAY' }), [])
  const seek = useCallback((value) => {
    const audio = audioRef.current
    if (audio && Number.isFinite(Number(value))) {
      try { audio.currentTime = Number(value) } catch { /* sessiz */ }
    }
    dispatch({ type: 'SEEK', value })
  }, [])
  const setVolume = useCallback((value) => {
    dispatch({ type: 'VOLUME', value })
    if (audioRef.current) audioRef.current.volume = value
  }, [])
  const toggleMute = useCallback(() => dispatch({ type: 'TOGGLE_MUTE' }), [])
  const cycleRepeat = useCallback(() => dispatch({ type: 'CYCLE_REPEAT' }), [])
  const toggleShuffle = useCallback(() => dispatch({ type: 'TOGGLE_SHUFFLE' }), [])
  const moveQueueItem = useCallback((from, to) => dispatch({ type: 'MOVE_QUEUE_ITEM', from, to }), [])
  const removeFromQueue = useCallback((index) => dispatch({ type: 'REMOVE_FROM_QUEUE', index }), [])
  const clearQueue = useCallback(() => dispatch({ type: 'RESET' }), [])
  const toggleNowPlaying = useCallback(() => setNowPlayingPanel((open) => !open), [])
  const openNowPlaying = useCallback(() => setNowPlayingPanel(true), [])
  const closeNowPlaying = useCallback(() => setNowPlayingPanel(false), [])

  const playRadio = useCallback((track) => {
    if (auth.loading) return
    if (!auth.user) {
      openAuthPrompt()
      return
    }
    ensureAnalyser()
    if (!track) return
    dispatch({ type: 'START_RADIO', seed: track })
    void extendRadio(track, { initial: true })
  }, [auth.loading, auth.user, ensureAnalyser, extendRadio, openAuthPrompt])

  const value = useMemo(() => ({
    ...state,
    current,
    loading: Boolean(state.error || !current),
    loadingNote,
    nowPlayingPanel,
    playContext,
    playShuffled,
    jump,
    next,
    prev,
    toggle,
    seek,
    setVolume,
    toggleMute,
    cycleRepeat,
    toggleShuffle,
    moveQueueItem,
    removeFromQueue,
    clearQueue,
    toggleNowPlaying,
    openNowPlaying,
    closeNowPlaying,
    playRadio,
    getWaveData,
    getFrequencyData,
  }), [state, current, loadingNote, nowPlayingPanel, playContext, playShuffled, jump, next, prev, toggle, seek, setVolume, toggleMute, cycleRepeat, toggleShuffle, moveQueueItem, removeFromQueue, clearQueue, toggleNowPlaying, openNowPlaying, closeNowPlaying, playRadio, getWaveData, getFrequencyData])

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside PlayerProvider')
  return value
}
