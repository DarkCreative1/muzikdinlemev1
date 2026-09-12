// Wavebox API client — token bazlı, 20s timeout, ApiError sözleşmesi
export class ApiError extends Error {
  constructor(message, status = 0, code = 'REQUEST_ERROR') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export const AUTH_TOKEN_KEY = 'wavebox-auth-token'

const getAuthToken = () => {
  try { return localStorage.getItem(AUTH_TOKEN_KEY) || '' } catch { return '' }
}

export function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token)
    else localStorage.removeItem(AUTH_TOKEN_KEY)
  } catch { /* depolama kapalıysa oturum bellek içinde kalmaz, hata fırlatılmaz */ }
}

export const clearAuthToken = () => setAuthToken('')

// Kimlik istekleri uygulamanın kendi alanına gider; backend, D1 Worker'a server-side proxy yapar.
const authRequest = (url, opts) => request(url, opts)

async function request(url, opts = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeout ?? 20_000)
  const external = opts.signal
  const onAbort = () => controller.abort()
  external?.addEventListener('abort', onAbort, { once: true })
  try {
    const token = getAuthToken()
    const headers = {
      ...(opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    }
    const body = headers['Content-Type'] === 'application/json' ? JSON.stringify(opts.body) : opts.body
    const response = await fetch(url, { ...opts, body, headers, signal: controller.signal })
    const type = response.headers.get('content-type') || ''
    const payload = type.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '')
    if (!response.ok) {
      throw new ApiError(payload?.detail || response.statusText || 'İstek başarısız.', response.status, payload?.code)
    }
    return payload
  } catch (error) {
    if (error?.name === 'AbortError') throw new ApiError('İstek zaman aşımına uğradı.', 408, 'TIMEOUT')
    throw error
  } finally {
    clearTimeout(timeout)
    external?.removeEventListener('abort', onAbort)
  }
}

const withQuery = (base, params) => {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (!entries.length) return base
  return `${base}?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
}

// ---- Keşif ----
export const search = (query, limit = 30, opts) => request(withQuery('/api/search', { q: query, limit }), opts)
export const getTrending = (limit = 24, opts) => request(withQuery('/api/trending', { limit }), opts)
export const getSpotifyLink = (url, opts) => request(withQuery('/api/spotify-link', { url }), opts)

// ---- Hesap ----
export const register = (email, password, displayName = '') =>
  authRequest('/api/auth/register', { method: 'POST', body: { email, password, display_name: displayName } })
export const login = (email, password) => authRequest('/api/auth/login', { method: 'POST', body: { email, password } })
export const getMe = (opts) => authRequest('/api/auth/me', opts)
export const logout = (opts) => authRequest('/api/auth/logout', { ...opts, method: 'POST' })

// ---- Parça & oynatma ----
export const getTrack = (id, opts) => request(`/api/track/${encodeURIComponent(id)}`, opts)
export const recordPlay = (id, opts) => request(`/api/play/${encodeURIComponent(id)}`, { ...opts, method: 'POST' })
export const resolveStream = (track, opts) => {
  const params = new URLSearchParams({
    artist: track.artist || '',
    title: track.title || '',
    album: track.album || '',
    cover_url: track.cover_url || '',
    duration: String(track.duration || 0),
    source: track.source || '',
    source_id: track.source_id || '',
    spotify_id: track.spotify_id || '',
  })
  return request(`/api/resolve/${encodeURIComponent(track.id)}?${params}`, opts)
}
export const streamUrl = (id) => `/api/stream/${encodeURIComponent(id)}`
export const downloadTrack = (track, opts) => request('/api/download', { ...opts, method: 'POST', body: track })
export const getDownloadStatus = (id, opts) => request(`/api/status/${encodeURIComponent(id)}`, opts)
export const getDownloadFileUrl = (id) => `/api/download-file/${encodeURIComponent(id)}`

// ---- Kitaplık ----
export const getLibrary = (limit = 50, offset = 0, opts) => request(withQuery('/api/library', { limit, offset }), opts)
export const getFavorites = (limit = 50, offset = 0, opts) => request(withQuery('/api/favorites', { limit, offset }), opts)
export const toggleFavorite = (track, opts = {}) => {
  const item = typeof track === 'string' ? { id: track } : track
  return request(`/api/favorites/${encodeURIComponent(item.id)}`, { ...opts, method: 'POST', body: typeof track === 'string' ? undefined : item })
}
export const getHistory = (limit = 50, offset = 0, opts) => request(withQuery('/api/history', { limit, offset }), opts)
export const clearHistory = (opts) => request('/api/history', { ...opts, method: 'DELETE' })

// ---- Yardımcılar ----
export const getLyrics = (title, artist, duration = 0, opts) =>
  request(withQuery('/api/lyrics', { title, artist, duration }), opts)
export const getRadio = (id, exclude = [], count = 12, opts) =>
  request(withQuery(`/api/radio/${encodeURIComponent(id)}`, { count, exclude: exclude.length ? exclude.join(',') : undefined }), opts)

// ---- Playlistler ----
export const getPlaylists = (opts) => request('/api/playlists', opts)
export const getPlaylist = (id, opts) => request(`/api/playlists/${encodeURIComponent(id)}`, opts)
export const createPlaylist = (data, opts) => request('/api/playlists', { ...opts, method: 'POST', body: data })
export const deletePlaylist = (id, opts) => request(`/api/playlists/${encodeURIComponent(id)}`, { ...opts, method: 'DELETE' })
export const addTrackToPlaylist = (playlistId, trackId, opts) =>
  request(`/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`, { ...opts, method: 'POST' })
export const removeTrackFromPlaylist = (playlistId, trackId, opts) =>
  request(`/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`, { ...opts, method: 'DELETE' })
