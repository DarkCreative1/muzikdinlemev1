import crypto from 'node:crypto'
import { SEARCH_CACHE_TTL_MS, TRENDING_CACHE_TTL_MS } from './config.js'
import { searchSoundCloudTracks } from './soundcloudService.js'
import { searchYouTubeTracks, searchYouTubeChannels, getChannelVideos, getYouTubeVideoMeta } from './youtubeSearch.js'
import { isChannelIntent, isLikelyMusicVideo } from './searchFilters.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
const DEFAULT_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80'
const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/
const EMBED_TOKEN_PAGE = 'https://open.spotify.com/embed/track/0VjIjW4GlUZAMYd2vXMi3b'
const embedPageUrl = (id) => `https://open.spotify.com/embed/track/${id}`

function normalize(value) { return String(value || '').normalize('NFKC').trim() }
function generateTrackId(source, sourceId, artist, title, album = '') {
  const identity = sourceId
    ? `${source}:${sourceId}`
    : `${source}:${normalize(artist).toLowerCase()}|${normalize(title).toLowerCase()}|${normalize(album).toLowerCase()}`
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)
}
function formatDuration(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}
function compactDisplayTitle(value) {
  const cleaned = normalize(value)
    .replace(/\s*[#＃](?:shorts?|ytshorts?|music|song|viral|fyp)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned.length > 96 ? `${cleaned.slice(0, 93).trimEnd()}…` : cleaned
}
// Arama kutusuna yapıştırılabilecek YouTube adres biçimleri:
// youtube.com/watch?v=ID, youtu.be/ID, youtube.com/@handle, /channel/UC...
function parseYouTubeUrl(raw) {
  const text = String(raw || '').trim()
  let match = /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/watch\?(?:[^#\s]*&)?v=([\w-]{11})/i.exec(text)
  if (match) return { videoId: match[1] }
  match = /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/shorts\/([\w-]{11})/i.exec(text)
  if (match) return { videoId: match[1], isShort: true }
  match = /^https?:\/\/youtu\.be\/([\w-]{11})/i.exec(text)
  if (match) return { videoId: match[1] }
  match = /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/@([\w.-]+)/i.exec(text)
  if (match) return { handle: match[1] }
  match = /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/channel\/(UC[\w-]+)/i.exec(text)
  if (match) return { channelId: match[1] }
  return null
}
async function fetchJson(url, opts = {}, timeoutMs = 6000) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...opts, signal: ctrl.signal })
    if (!response.ok) return null
    return await response.json()
  } catch { return null } finally { clearTimeout(timer) }
}
async function fetchText(url, opts = {}, timeoutMs = 6000) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...opts, signal: ctrl.signal })
    if (!response.ok) return null
    return await response.text()
  } catch { return null } finally { clearTimeout(timer) }
}
function spotifyTrack(item, fallbackCover = '', fallbackAlbum = '') {
  if (!item || item.type && item.type !== 'track') return null
  const title = normalize(item.name)
  const artist = (item.artists || []).map((a) => normalize(a?.name)).filter(Boolean).join(', ')
  if (!title || !artist) return null
  const album = normalize(item.album?.name || fallbackAlbum || 'Single')
  const duration = Math.max(0, Math.floor(Number(item.duration_ms || 0) / 1000))
  const sourceId = normalize(item.id)
  return {
    id: generateTrackId('spotify', sourceId, artist, title, album), source: 'spotify', source_id: sourceId,
    spotify_id: sourceId || null, title, artist, album, duration, duration_str: formatDuration(duration),
    cover_url: item.album?.images?.[0]?.url || fallbackCover || '', preview_url: item.preview_url || '',
    release_date: normalize(item.album?.release_date).slice(0, 10),
    spotify_url: sourceId ? `https://open.spotify.com/track/${sourceId}` : '',
    is_playable: item.is_playable !== false && !item.is_local,
  }
}

class SpotifyService {
  constructor() {
    this._token = null; this._tokenExpiresAt = 0; this._tokenPromise = null
    this._trendingCache = null; this._trendingCacheTime = 0; this._trendingPromise = null
    this._searchCache = new Map(); this._searchInflight = new Map(); this._searchStats = { hits: 0, stale: 0, misses: 0 }
  }
  async _scrapeEmbedToken() {
    const html = await fetchText(EMBED_TOKEN_PAGE, { headers: { 'User-Agent': UA } }, 8000)
    const match = html?.match(/"accessToken":"([^"]+)"/)
    return match ? match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/') : null
  }
  async _getSpotifyToken() {
    const now = Date.now() / 1000
    if (this._token && now < this._tokenExpiresAt - 60) return this._token
    if (this._tokenPromise) return this._tokenPromise
    this._tokenPromise = (async () => {
      const clientId = process.env.SPOTIFY_CLIENT_ID; const secret = process.env.SPOTIFY_CLIENT_SECRET
      // En güvenilir yol: client credentials (geliştirici kimliği). Web player/embed
      // token'ları api.spotify.com için geçersiz (403/429) – kimlik varken önce bu denenir.
      if (clientId && secret) {
        const auth = await fetchJson('https://accounts.spotify.com/api/token', {
          method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
        })
        if (auth?.access_token) {
          this._token = auth.access_token; this._tokenExpiresAt = now + (Number(auth.expires_in) || 3600)
          return this._token
        }
      }
      const headers = { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://open.spotify.com/', Origin: 'https://open.spotify.com', 'app-platform': 'WebPlayer' }
      const publicData = await fetchJson('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', { headers })
      if (publicData?.accessToken) {
        this._token = publicData.accessToken
        this._tokenExpiresAt = (publicData.accessTokenExpirationTimestampMs || Date.now() + 3600_000) / 1000
        return this._token
      }
      const scrapedToken = await this._scrapeEmbedToken()
      if (scrapedToken) {
        this._token = scrapedToken
        this._tokenExpiresAt = now + 3300
        return this._token
      }
      return null
    })().finally(() => { this._tokenPromise = null })
    return this._tokenPromise
  }
  _normalizeSearchQuery(query) {
    return normalize(query).replace(/\bhardystyle\b/gi, 'hardstyle').replace(/\bspeed up\b/gi, 'sped up').replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()
  }
  async search(rawQuery, limit = 25) {
    const query = normalize(rawQuery)
    if (!query) return []
    const cacheKey = `${query.toLowerCase()}|${Math.min(50, Math.max(5, limit))}`
    const cached = this._searchCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) { this._searchStats.hits += 1; return cached.value }
    const inflight = this._searchInflight.get(cacheKey)
    if (inflight) return inflight
    const promise = this._searchUncached(query, limit)
      .then((value) => {
        this._searchCache.set(cacheKey, { value, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS })
        while (this._searchCache.size > 256) this._searchCache.delete(this._searchCache.keys().next().value)
        return value
      })
      .finally(() => this._searchInflight.delete(cacheKey))
    this._searchInflight.set(cacheKey, promise)
    if (cached) { this._searchStats.stale += 1; return cached.value }
    this._searchStats.misses += 1
    return promise
  }

  async _searchUncached(query, limit = 25) {
    if (/^https:\/\/(?:www\.)?open\.spotify\.com\//i.test(query)) {
      const info = await this.parseSpotifyUrl(query)
      return info?.track ? [info.track] : info?.tracks || []
    }
    // YouTube bağlantısı/handle yapıştırldıysa doğrudan çöz: video linki → oEmbed ile
    // tek sonuç; kanal handle'ı → kanalın yüklemeleri. Kullanıcı "linki yapıştır,
    // çalsın" akışını bekliyor.
    const ytUrl = parseYouTubeUrl(query)
    if (ytUrl?.videoId) {
      const meta = await getYouTubeVideoMeta(ytUrl.videoId)
      if (meta) {
        const track = youtubeTrack({ id: ytUrl.videoId, title: meta.title, channel: meta.channel, duration: 0 })
        if (track) return [track]
      }
      return []
    }
    if (ytUrl?.handle || ytUrl?.channelId) {
      let channelId = ytUrl.channelId
      if (!channelId) {
        const channels = await searchYouTubeChannels(ytUrl.handle, { limit: 3 }).catch(() => [])
        channelId = channels[0]?.channelId
      }
      if (channelId) {
        const videos = await getChannelVideos(channelId, { limit: 10 }).catch(() => [])
        const results = videos.map(youtubeTrack).filter(Boolean)
        if (results.length) return results.slice(0, limit)
      }
    }
    // Sonuçlar Spotify (resmi katalog) + YouTube + SoundCloud birleşiminden oluşur:
    // resmi olmayan sürümler, cover/remix'ler ve yalnızca bu platformlarda olan
    // parçalar da aramada görünür. Aynı parça iki kaynaktan geliyorsa tekilleştirilir.
    const cleanQuery = this._normalizeSearchQuery(query)
    let spotifyError = null
    let results = []
    try {
      results = await this._searchSpotify(query, Math.min(50, limit))
    } catch (error) { spotifyError = error }
    if (cleanQuery && cleanQuery.toLowerCase() !== query.toLowerCase() && results.length < Math.min(5, limit)) {
      const extra = await this._searchSpotify(cleanQuery, 10).catch(() => [])
      results = results.concat(extra)
    }
    const [scRaw, ytRaw, channels] = await Promise.all([
      searchSoundCloudTracks(cleanQuery || query, { limit: Math.min(15, limit) }).catch(() => []),
      searchYouTubeTracks(cleanQuery || query, { limit: 15, timeoutMs: 6_000 }).catch(() => []),
      // Üretici araması: "kabileshef" gibi sorgular video başlıklarında geçmez ama
      // kanal adı/handle ile bulanık eşleşir; kanalın yüklemeleri sonuç başına gelir.
      searchYouTubeChannels(query.replace(/^@/, '').trim(), { limit: 3, timeoutMs: 5_000 }).catch(() => []),
    ])
    const scResults = scRaw.map(soundcloudTrack).filter(Boolean)
    // Müzik aramasında kısa videolar başlık gürültüsü ve eksik parça üretir;
    // kullanıcı doğrudan Shorts bağlantısı yapıştırırsa üstteki URL çözümü çalışır.
    const ytResults = ytRaw.filter((item) => isLikelyMusicVideo(item, cleanQuery || query)).map(youtubeTrack).filter(Boolean)
    let channelResults = []
    // Kanal niyeti güçlü ise (ör. "kabile şefi") kanal kesitleri müzik sonuçlarıyla
    // birlikte gösterilir; "duman" gibi kısmi sanatçı eşleşmeleri kanal sayılmaz.
    const matchedChannel = (channels || []).find((channel) => isChannelIntent(query, channel))
    if (matchedChannel) {
      const videos = await getChannelVideos(matchedChannel.channelId, { limit: 10 }).catch(() => [])
      channelResults = videos.filter((item) => isLikelyMusicVideo(item, query)).map(youtubeTrack).filter(Boolean)
    }
    const seen = new Set()
    // titleKey'ler kaynak bazlı tutulur: YouTube aynaları (aynı şarkının resmi YT
    // yüklemesi) Spotify sonucuyla birlikte GÖRÜNÜR — kullanıcı YT sürümünü seçebilsin;
    // aynı kaynağın kendi içindeki tekrarlar ve SoundCloud'un Spotify kopyaları elenir.
    const spotifyTitles = new Set()
    const ytTitles = new Set()
    const scTitles = new Set()
    const out = []
    const titleKeyOf = (track) => `${track.artist.toLocaleLowerCase('tr-TR')}|${track.title.toLocaleLowerCase('tr-TR')}`
    const push = (track) => {
      if (!track?.title || !track?.artist) return
      const key = track.source_id ? `${track.source}:${track.source_id}` : `${track.artist.toLowerCase()}|${track.title.toLowerCase()}|${track.album.toLowerCase()}`
      if (seen.has(key)) return
      const titleKey = titleKeyOf(track)
      if (track.source === 'youtube') {
        if (ytTitles.has(titleKey)) return
        ytTitles.add(titleKey)
      } else if (track.source === 'soundcloud') {
        if (spotifyTitles.has(titleKey) || scTitles.has(titleKey)) return
        scTitles.add(titleKey)
      } else {
        if (spotifyTitles.has(titleKey)) return
        spotifyTitles.add(titleKey)
      }
      seen.add(key); out.push(track)
    }
    // Üretici eşleştiyse onun yüklemeleri en üstte: arama niyeti odur.
    for (const track of channelResults) push(track)
    for (const track of results) push(track)
    for (const track of ytResults.slice(0, 8)) push(track)
    for (const track of scResults) push(track)
    // Spotify erişilemiyorsa bile YouTube/SoundCloud sonuçları dönsün; hepsi boşsa hatayı yükselt.
    if (!out.length && spotifyError && !scResults.length && !ytResults.length) throw spotifyError
    return out.slice(0, limit)
  }

  async _searchSpotify(query, limit) {
    let token = await this._getSpotifyToken()
    if (!token) {
      // Sessiz boş sonuç "sonuç yok" ile karışır; açık hata daha dürüst (trending kendi
      // fallback'ine allSettled ile düşer, arama uçları 502 döner).
      const error = new Error('Spotify arama şu anda kullanılamıyor (erişim belirteci alınamadı).')
      error.statusCode = 502; error.code = 'SPOTIFY_UNAVAILABLE'
      throw error
    }
    const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${Math.min(50, limit)}`
    let data = await fetchJson(searchUrl, { headers: { Authorization: `Bearer ${token}` } }, 6000)
    if (!data) {
      this._token = null; this._tokenExpiresAt = 0
      token = await this._getSpotifyToken()
      if (token) data = await fetchJson(searchUrl, { headers: { Authorization: `Bearer ${token}` } }, 6000)
    }
    return (data?.tracks?.items || []).map((item) => spotifyTrack(item)).filter(Boolean)
  }
  async parseSpotifyUrl(rawUrl) {
    let url; try { url = new URL(rawUrl) } catch { return { type: 'unknown', error: 'Geçersiz Spotify linki' } }
    if (url.protocol !== 'https:' || !['open.spotify.com', 'www.open.spotify.com'].includes(url.hostname)) return { type: 'unknown', error: 'Geçersiz Spotify linki' }
    const [type, id] = url.pathname.split('/').filter(Boolean).slice(-2)
    if (!['track', 'album', 'playlist'].includes(type) || !SPOTIFY_ID_RE.test(id || '')) return { type: 'unknown', error: 'Geçersiz Spotify linki' }
    if (type === 'track') return this._getSpotifyTrackInfo(id)
    if (type === 'album') return this._getSpotifyAlbumInfo(id)
    return this._getSpotifyPlaylistInfo(id)
  }
async _getSpotifyTrackInfo(id) {
    const token = await this._getSpotifyToken()
    if (token) {
      const item = await fetchJson(`https://api.spotify.com/v1/tracks/${id}?market=TR`, { headers: { Authorization: `Bearer ${token}` } }, 6000)
      const track = spotifyTrack(item); if (track) return { type: 'track', track }
    }
    const embedTrack = await this._getSpotifyEmbedTrackInfo(id)
    if (embedTrack) return { type: 'track', track: embedTrack }
    const data = await fetchJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`, {}, 5000)
    if (!data?.title) return { type: 'unknown', error: 'Spotify parçası çözülemedi' }
    const titleFull = normalize(data.title); const split = titleFull.lastIndexOf(' by ')
    const title = split > 0 ? titleFull.slice(0, split) : titleFull; const artist = split > 0 ? titleFull.slice(split + 4) : 'Spotify Artist'
    return { type: 'track', track: { id: generateTrackId('spotify', id, artist, title), source: 'spotify', source_id: id, spotify_id: id, title, artist, album: 'Spotify Track', duration: 0, duration_str: '0:00', cover_url: data.thumbnail_url || '', preview_url: '', release_date: '', spotify_url: `https://open.spotify.com/track/${id}` } }
  }
  async _getSpotifyEmbedTrackInfo(id) {
    const html = await fetchText(embedPageUrl(id), { headers: { 'User-Agent': UA } }, 8000)
    const match = html?.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s)
    if (!match) return null
    try {
      const entity = JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity || {}
      const title = normalize(entity.name); if (!title) return null
      const artist = Array.isArray(entity.artists) ? entity.artists.map((a) => normalize(a?.name)).filter(Boolean).join(', ') : 'Spotify Artist'
      const rawDuration = Number(entity.duration || 0)
      const duration = rawDuration > 10_000 ? Math.floor(rawDuration / 1000) : Math.floor(rawDuration)
const image = Array.isArray(entity.visualIdentity?.image) ? entity.visualIdentity.image : []
      const cover = image.at(-1)?.url || image[0]?.url || ''
      const preview = typeof entity.audioPreview?.url === 'string' ? entity.audioPreview.url.replace(/\\u0026/g, '&').replace(/\\\//g, '/') : ''
      return { id: generateTrackId('spotify', id, artist, title), source: 'spotify', source_id: id, spotify_id: id, title, artist, album: 'Spotify Track', duration, duration_str: formatDuration(duration), cover_url: cover, preview_url: preview, release_date: normalize(entity.releaseDate?.isoString).slice(0, 10), spotify_url: `https://open.spotify.com/track/${id}` }
    } catch { return null }
  }
  async _getAllSpotifyPages(firstUrl, token, limit = 500) {
    const items = []; let url = firstUrl
    while (url && items.length < limit) {
      const data = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } }, 7000)
      if (!data) break
      items.push(...(data.items || [])); url = data.next
    }
    return items.slice(0, limit)
  }
  async _getSpotifyAlbumInfo(id) {
    const token = await this._getSpotifyToken()
    if (!token) return this._getSpotifyEmbedFallback('album', id)
    const data = await fetchJson(`https://api.spotify.com/v1/albums/${id}?market=TR`, { headers: { Authorization: `Bearer ${token}` } }, 7000)
    if (!data?.name) return this._getSpotifyEmbedFallback('album', id)
    const cover = data.images?.[0]?.url || ''; const artist = (data.artists || []).map((a) => normalize(a?.name)).filter(Boolean).join(', ')
    let raw = data.tracks?.items || []
    if (data.tracks?.next) raw = raw.concat(await this._getAllSpotifyPages(data.tracks.next, token))
    const tracks = raw.map((item) => spotifyTrack({ ...item, album: { name: data.name, images: data.images, release_date: data.release_date } }, cover, data.name)).filter((t) => t?.is_playable !== false)
    return { type: 'album', spotify_id: id, title: normalize(data.name), artist, cover_url: cover, release_date: normalize(data.release_date).slice(0, 10), track_count: tracks.length, tracks }
  }
  async _getSpotifyPlaylistInfo(id) {
    const token = await this._getSpotifyToken()
    if (!token) return this._getSpotifyEmbedFallback('playlist', id)
    const data = await fetchJson(`https://api.spotify.com/v1/playlists/${id}?market=TR`, { headers: { Authorization: `Bearer ${token}` } }, 7000)
    if (!data?.name) return this._getSpotifyEmbedFallback('playlist', id)
    let entries = data.tracks?.items || []
    if (data.tracks?.next) entries = entries.concat(await this._getAllSpotifyPages(data.tracks.next, token))
    const tracks = entries.map((entry) => spotifyTrack(entry?.track, data.images?.[0]?.url || '', data.name)).filter((t) => t?.is_playable !== false)
    return { type: 'playlist', spotify_id: id, title: normalize(data.name), description: normalize(data.description), owner: normalize(data.owner?.display_name), cover_url: data.images?.[0]?.url || '', track_count: tracks.length, tracks }
  }
  async _getSpotifyEmbedFallback(type, id) {
    const html = await fetchText(`https://open.spotify.com/embed/${type}/${id}`, { headers: { 'User-Agent': UA } }, 6000)
    const match = html?.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s)
    if (!match) return { type: 'unknown', error: `Spotify ${type} çözülemedi` }
    try {
      const entity = JSON.parse(match[1])?.props?.pageProps?.state?.data?.entity || {}
      const title = normalize(entity.name); if (!title) throw new Error('missing entity')
      const cover = entity.images?.[0]?.url || entity.coverArt?.sources?.[0]?.url || ''
      const tracks = (entity.trackList || entity.tracks?.items || []).map((entry) => {
        const item = entry?.track || entry; const trackTitle = normalize(item?.name || item?.title)
        const artist = Array.isArray(item?.artists) ? item.artists.map((a) => normalize(a?.name)).filter(Boolean).join(', ') : normalize(item?.subtitle || 'Various Artists')
        const sourceId = normalize(item?.id || item?.uri).replace(/^spotify:track:/, '')
        if (!trackTitle || !artist) return null
        const rawDuration = Number(item?.duration_ms ?? item?.duration ?? 0); const duration = rawDuration > 10_000 ? Math.floor(rawDuration / 1000) : Math.floor(rawDuration)
        return { id: generateTrackId('spotify', sourceId, artist, trackTitle, title), source: 'spotify', source_id: sourceId, spotify_id: sourceId || null, title: trackTitle, artist, album: title, duration, duration_str: formatDuration(duration), cover_url: cover, spotify_url: sourceId ? `https://open.spotify.com/track/${sourceId}` : '' }
      }).filter(Boolean)
      return { type, spotify_id: id, title, cover_url: cover, track_count: tracks.length, tracks }
    } catch { return { type: 'unknown', error: `Spotify ${type} çözülemedi` } }
  }
  async getTrending() {
    const now = Date.now()
    if (this._trendingCache && now - this._trendingCacheTime < TRENDING_CACHE_TTL_MS) return this._trendingCache
    if (this._trendingCache) {
      if (!this._trendingPromise) this._trendingPromise = this._refreshTrending().finally(() => { this._trendingPromise = null })
      return this._trendingCache
    }
    return this._refreshTrending()
  }

  async _refreshTrending() {
    const now = Date.now()
    const seeds = ['Türkiye Top Hits', 'Global Top Hits', 'Türkçe rock']
    const groups = await Promise.allSettled(seeds.map((q) => this.search(q, 8)))
    const seen = new Set(); const tracks = []
    for (const group of groups) for (const track of group.value || []) if (!seen.has(track.id)) { seen.add(track.id); tracks.push(track) }
    if (!tracks.length) {
      const curated = [
        ['Zamansız', 'Manifest'], ['Antidepresan', 'Mert Demir, Mabel Matiz'], ['Blinding Lights', 'The Weeknd'], ['As It Was', 'Harry Styles'],
      ]
      for (const [title, artist] of curated) tracks.push({ id: generateTrackId('curated', '', artist, title), source: 'curated', source_id: null, spotify_id: null, title, artist, album: 'Öne Çıkanlar', duration: 0, duration_str: '0:00', cover_url: DEFAULT_COVER, spotify_url: '' })
    }
    const featured = [
      { id: 'top_50_turkey', title: 'Türkiye Top Hits', description: 'Türkiye için öne çıkan parçalar.', search: 'Türkiye Top Hits', cover_url: DEFAULT_COVER },
      { id: 'top_50_global', title: 'Global Top Hits', description: 'Dünya genelinden öne çıkan parçalar.', search: 'Global Top Hits', cover_url: DEFAULT_COVER },
      { id: 'turkce_rock', title: 'Türkçe Rock & Alternatif', description: 'Türkçe rock ve alternatif seçkisi.', search: 'Türkçe rock', cover_url: DEFAULT_COVER },
    ]
    this._trendingCache = { trending_tracks: tracks.slice(0, 20), featured_playlists: featured, source: tracks[0]?.source === 'curated' ? 'curated' : 'live-search', updated_at: new Date().toISOString() }
    this._trendingCacheTime = now
    return this._trendingCache
  }

  clearTrendingCache() { this._trendingCache = null; this._trendingCacheTime = 0; this._trendingPromise = null }
  getStats() { return { search: { ...this._searchStats, cacheEntries: this._searchCache.size }, trendingCached: Boolean(this._trendingCache) } }
}

// SoundCloud arama sonucunu uygulamanın parça biçimine çevirir. id, kaynak+SC ID'sinden
// üretilir; böylece çalındığında eşleşme yok, doğrudan o SC kaydı akıtılır.
function soundcloudTrack(item) {
  if (!item?.id || !item?.title) return null
  const title = normalize(item.title)
  const artist = normalize(item.user) || 'SoundCloud'
  const duration = Math.max(0, Math.round(Number(item.duration) || 0))
  const sourceId = String(item.id)
  return {
    id: generateTrackId('soundcloud', sourceId, artist, title), source: 'soundcloud', source_id: sourceId,
    spotify_id: null, title, artist, album: 'SoundCloud', duration, duration_str: formatDuration(duration),
    cover_url: item.artwork_url || '', preview_url: '', release_date: '', spotify_url: '',
    is_playable: true,
  }
}

// YouTube başlıkları "Sanatçı - Şarkı (Official Video)" biçimindedir; sanatçı ve şarkı
// adı buradan ayrıştırılır. Ayraç yoksa kanal adı ("X - Topic", "XVEVO" temizlenmiş)
// sanatçı olur. Kapak olarak video küçük resmi (mqdefault: 16:9, bantsız) kullanılır.
function parseYouTubeTitle(rawTitle, channel) {
  let text = normalize(rawTitle)
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  const pipeCut = text.split(/\s+\|\s+/)[0].trim()
  if (pipeCut.length >= 3) text = pipeCut
  let artist = ''
  let title = text
  const parts = text.split(/\s+[-–—]\s+/)
  if (parts.length >= 2 && parts[0].trim().length >= 2) {
    artist = parts[0].trim()
    title = parts.slice(1).join(' - ').trim()
  }
  title = title
    .replace(/\((?:[^()]*\b(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visualizer|visualiser|MV|HD|4K)\b[^()]*)\)/gi, '')
    .replace(/\[(?:[^\[\]]*\b(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visualizer|visualiser|MV|HD|4K)\b[^\[\]]*)\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[#＃](?:shorts?|ytshorts?|music|song|viral|fyp)\b/gi, '')
    .replace(/\s+#\w+(?:\s+#\w+)*$/u, '')
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
    .trim()
  if (!artist) {
    artist = normalize(channel)
      .replace(/\s*-\s*Topic$/i, '')
      .replace(/VEVO$/i, '')
      .replace(/\s*\bofficial\b.*$/i, '')
      .trim() || 'YouTube'
  }
  if (!title) title = text
  return { artist, title }
}

function youtubeTrack(item) {
  if (!item?.id || !item?.title) return null
  const sourceId = String(item.id)
  const { artist, title } = parseYouTubeTitle(item.title, item.channel)
  const duration = Math.max(0, Math.round(Number(item.duration) || 0))
  return {
    id: generateTrackId('youtube', sourceId, artist, title), source: 'youtube', source_id: sourceId,
    spotify_id: null, title, display_title: compactDisplayTitle(title), artist, album: 'YouTube', duration, is_short: Boolean(item.is_short || (duration > 0 && duration < 30)), duration_str: formatDuration(duration),
    cover_url: `https://i.ytimg.com/vi/${sourceId}/mqdefault.jpg`, preview_url: '', release_date: '', spotify_url: '',
    is_playable: true,
  }
}

export const spotifyService = new SpotifyService()
