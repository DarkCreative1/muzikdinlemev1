import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import {
  PORT, HOST, DOWNLOADS_DIR, FRONTEND_DIST, MAX_SEARCH_LIMIT, MAX_HISTORY_LIMIT, MAX_LIBRARY_LIMIT, MAX_CONCURRENT_DOWNLOADS,
} from './config.js'
import {
  saveOrUpdateTrack, getTrack, getAllDownloadedTracks, getDownloadedTrackCount,
  recordPlay, getHistory, clearHistory, toggleFavorite, getFavorites, getFavoriteCount, isFavorite,
  listPlaylists, getPlaylist, playlistExists, createPlaylist, deletePlaylist, addPlaylistTrack, removePlaylistTrack,
  createUser, ensureUserRecord, getUserByEmail, getUserBySession, verifyUser, createSession, deleteSession,
} from './db.js'
import { spotifyService } from './spotifyService.js'
import { audioDownloader, activeDownloads, sanitizeFilename } from './audioDownloader.js'
import { lyricsService } from './lyricsService.js'

const app = Fastify({ logger: true, bodyLimit: 1_000_000, routerOptions: { maxParamLength: 256 } })
const allowedOrigins = new Set((process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://[::1]:5173').split(',').map((x) => x.trim()).filter(Boolean))
await app.register(cors, { origin(origin, cb) { cb(null, !origin || allowedOrigins.has(origin)) } })
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body ? Object.fromEntries(new URLSearchParams(body)) : {}))
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body || ''))

if (fs.existsSync(path.join(FRONTEND_DIST, 'assets'))) {
  await app.register(fastifyStatic, { root: path.join(FRONTEND_DIST, 'assets'), prefix: '/assets/', decorateReply: false, index: false, list: false })
}
app.addHook('onSend', async (req, reply) => {
  if (req.url.startsWith('/assets/')) reply.header('Cache-Control', 'public, max-age=31536000, immutable')
  else if (req.url.startsWith('/api/auth/') || req.url.startsWith('/api/library') || req.url.startsWith('/api/favorites') || req.url.startsWith('/api/history') || req.url.startsWith('/api/playlists') || req.url.startsWith('/api/metrics')) reply.header('Cache-Control', 'no-store')
})

const MIME_BY_EXT = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm', '.opus': 'audio/opus', '.wav': 'audio/wav' }
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/u
const rateBuckets = new Map()
const requestMetrics = new Map()
const MAX_RATE_BUCKETS = 10_000
const MAX_METRIC_ROUTES = 1_000

app.addHook('onRequest', async (req, reply) => {
  req.requestStartedAt = process.hrtime.bigint()
  reply.header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'same-origin')
    .header('X-Frame-Options', 'DENY')
    .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
    .header('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: https:; media-src 'self' blob: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self' https:")
  if (process.env.NODE_ENV === 'production' && req.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (!req.url.startsWith('/api/')) return
  const now = Date.now(); const pathname = req.url.split('?')[0]; const rateRoute = req.routeOptions?.url || pathname; const key = `${req.ip}:${rateRoute}`
  const bucket = rateBuckets.get(key) || { start: now, count: 0 }
  if (now - bucket.start > 60_000) { bucket.start = now; bucket.count = 0 }
  bucket.count += 1; rateBuckets.set(key, bucket)
  if (rateBuckets.size > MAX_RATE_BUCKETS) {
    const oldest = [...rateBuckets.entries()].sort((a, b) => a[1].start - b[1].start).slice(0, Math.ceil(rateBuckets.size * 0.1))
    for (const [staleKey] of oldest) rateBuckets.delete(staleKey)
  }
  const authRoute = pathname === '/api/auth/login' || pathname === '/api/auth/register'
  const expensive = /^\/api\/(?:download|resolve|stream|radio|lyrics|spotify-link)(?:\/|$)/u.test(pathname)
  const upstream = /^\/api\/(?:search|trending)(?:\/|$)/u.test(pathname)
  const limit = authRoute ? 12 : expensive ? 30 : upstream ? 60 : 180
  if (bucket.count > limit) return reply.code(429).send({ detail: 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', code: 'RATE_LIMITED' })
})
app.addHook('onResponse', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return
  const route = req.routeOptions?.url || req.url.split('?')[0]
  if (!requestMetrics.has(route) && requestMetrics.size >= MAX_METRIC_ROUTES) return
  const item = requestMetrics.get(route) || { count: 0, errors: 0, totalMs: 0, maxMs: 0 }
  const elapsed = Number(process.hrtime.bigint() - (req.requestStartedAt || process.hrtime.bigint())) / 1e6
  item.count += 1; item.totalMs += elapsed; item.maxMs = Math.max(item.maxMs, elapsed)
  if (reply.statusCode >= 400) item.errors += 1
  requestMetrics.set(route, item)
})
const cleanupRateTimer = setInterval(() => {
  const cutoff = Date.now() - 120_000
  for (const [key, value] of rateBuckets) if (value.start < cutoff) rateBuckets.delete(key)
}, 60_000)
cleanupRateTimer.unref?.()

app.setErrorHandler((error, req, reply) => {
  req.log.error({ err: error }, 'request failed')
  const status = Number(error.statusCode) >= 400 ? Number(error.statusCode) : 500
  // Yukarı akış (Spotify/Deezer) erişilemez hataları dışında 5xx detayı gizlenir.
  const upstream = typeof error.code === 'string' && error.code.endsWith('_UNAVAILABLE')
  const detail = status >= 500 && !upstream ? 'Sunucu isteği tamamlayamadı.' : error.message
  reply.code(status).send({ detail, code: error.code || 'REQUEST_ERROR' })
})
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/downloads/')) return reply.code(404).send({ detail: 'Kaynak bulunamadı.', code: 'NOT_FOUND' })
  return sendIndex(req, reply)
})

function sendIndex(_req, reply) {
  const indexFile = path.join(FRONTEND_DIST, 'index.html')
  if (!fs.existsSync(indexFile)) return reply.code(503).send({ detail: 'Frontend build bulunamadı.', code: 'FRONTEND_NOT_BUILT' })
  return reply.type('text/html; charset=utf-8').send(fs.createReadStream(indexFile))
}
function requireText(value, name, max = 200) {
  const result = String(value ?? '').normalize('NFKC').trim()
  if (!result) { const e = new Error(`${name} gerekli`); e.statusCode = 422; throw e }
  if (result.length > max) { const e = new Error(`${name} en fazla ${max} karakter olabilir`); e.statusCode = 422; throw e }
  if (/[\u0000-\u001f\u007f]/u.test(result)) { const e = new Error(`${name} kontrol karakterleri içeremez`); e.statusCode = 422; throw e }
  return result
}
function requestToken(req) {
  const header = String(req.headers?.authorization || '')
  return /^Bearer\s+([^\s]+)$/i.exec(header)?.[1] || ''
}
const D1_AUTH_API_URL = String(process.env.D1_AUTH_API_URL || '').replace(/\/+$/u, '')
const D1_AUTH_PROXY_KEY = String(process.env.D1_AUTH_PROXY_KEY || '')
const D1_AUTH_PROXY_ENABLED = Boolean(D1_AUTH_API_URL && D1_AUTH_PROXY_KEY)
const d1UserCache = new Map()
const MAX_D1_USER_CACHE = 10_000
function d1CacheKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}
function pruneD1UserCache() {
  const now = Date.now()
  for (const [key, value] of d1UserCache) if (value.expiresAt <= now) d1UserCache.delete(key)
  while (d1UserCache.size > MAX_D1_USER_CACHE) {
    const oldest = d1UserCache.keys().next().value
    if (oldest === undefined) break
    d1UserCache.delete(oldest)
  }
}
async function proxyD1Auth(req, reply, pathname) {
  const headers = { Accept: 'application/json', 'X-Wavebox-Proxy-Key': D1_AUTH_PROXY_KEY }
  const token = requestToken(req)
  if (token) headers.Authorization = `Bearer ${token}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${D1_AUTH_API_URL}${pathname}`, {
      method: req.method,
      headers: { ...headers, ...(req.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: req.method === 'POST' ? JSON.stringify(req.body && typeof req.body === 'object' ? req.body : {}) : undefined,
      signal: controller.signal,
    })
    const raw = await response.text()
    let payload = {}
    try { payload = raw ? JSON.parse(raw) : {} } catch { payload = { detail: raw || 'Kimlik servisi geçersiz yanıt döndürdü.' } }
    return reply.code(response.status).send(payload)
  } catch (error) {
    const proxyError = new Error(error?.name === 'AbortError' ? 'Kimlik servisi zaman aşımına uğradı.' : 'Kimlik servisine ulaşılamadı.')
    proxyError.statusCode = 502
    proxyError.code = 'AUTH_BACKEND_UNAVAILABLE'
    throw proxyError
  } finally {
    clearTimeout(timeout)
  }
}
async function currentUser(req) {
  if (Object.hasOwn(req, 'user')) return req.user
  const token = requestToken(req)
  req.user = getUserBySession(token)
  if (req.user) { ensureUserRecord(req.user); return req.user }
  if (!D1_AUTH_PROXY_ENABLED || !token) return req.user
  const cacheKey = d1CacheKey(token)
  const cached = d1UserCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) { req.user = cached.user; return req.user }
  if (cached) d1UserCache.delete(cacheKey)
  try {
    const response = await fetch(`${D1_AUTH_API_URL}/api/auth/me`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'X-Wavebox-Proxy-Key': D1_AUTH_PROXY_KEY }, signal: AbortSignal.timeout(10_000) })
    const payload = response.ok ? await response.json() : null
    const user = payload?.user || null
    if (user?.id) { d1UserCache.set(cacheKey, { user, expiresAt: Date.now() + 15_000 }); pruneD1UserCache(); req.user = user; ensureUserRecord(user) }
  } catch {}
  return req.user
}
async function requireUser(req) {
  const user = await currentUser(req)
  if (!user) throw authError()
  return user
}
function requireEmail(value) {
  const email = requireText(value, 'email', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(email)) { const e = new Error('Geçerli bir e-posta adresi girin'); e.statusCode = 422; e.code = 'INVALID_EMAIL'; throw e }
  return email
}
function requirePassword(value) {
  const password = String(value ?? '')
  if (password.length < 8 || password.length > 128) { const e = new Error('Şifre 8-128 karakter arasında olmalı'); e.statusCode = 422; e.code = 'INVALID_PASSWORD'; throw e }
  return password
}
function optionalDisplayName(value, email) {
  const name = optionalText(value, 60)
  if (name.length >= 2) return name
  return email.split('@')[0].slice(0, 40)
}
function authError(detail = 'Oturum açmanız gerekiyor.') {
  const error = new Error(detail); error.statusCode = 401; error.code = 'AUTH_REQUIRED'; return error
}
function optionalText(value, max = 1000) {
  const result = String(value ?? '').normalize('NFKC').trim()
  if (result.length > max) { const e = new Error(`Alan en fazla ${max} karakter olabilir`); e.statusCode = 422; throw e }
  if (/[\u0000-\u001f\u007f]/u.test(result)) { const e = new Error('Alan kontrol karakterleri içeremez'); e.statusCode = 422; throw e }
  return result
}
function optionalHttpsUrl(value, name, max = 2000) {
  const result = optionalText(value, max)
  if (!result) return ''
  let parsed
  try { parsed = new URL(result) } catch { const e = new Error(`${name} geçerli bir HTTPS bağlantısı olmalı`); e.statusCode = 422; throw e }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) { const e = new Error(`${name} geçerli bir HTTPS bağlantısı olmalı`); e.statusCode = 422; throw e }
  return parsed.toString()
}
function parseLimit(value, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > max) { const e = new Error(`limit 1-${max} arasında tam sayı olmalı`); e.statusCode = 422; throw e }
  return n
}
function parseDuration(value) {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 86_400) { const e = new Error('duration geçerli bir saniye değeri olmalı'); e.statusCode = 422; throw e }
  return Math.round(n)
}
function requireId(value, name = 'trackId') {
  const id = String(value || '')
  if (!ID_RE.test(id)) { const e = new Error(`${name} biçimi geçersiz`); e.statusCode = 400; throw e }
  return id
}
function publicTrack(track) {
  if (!track) return track
  const { file_path: _filePath, ...safe } = track
  safe.is_downloaded = Boolean(safe.is_downloaded)
  safe.is_favorite = Boolean(safe.is_favorite)
  return safe
}
function publicDownloadState(state) {
  if (!state || typeof state !== 'object') return { status: 'idle', progress: 0, is_downloaded: false }
  const { file_path: _filePath, ...safe } = state
  if (safe.error) safe.error = String(safe.error).replace(/https?:\/\/\S+/giu, '[upstream]').replace(/[A-Za-z]:\\[^\s]+/gu, '[path]').slice(0, 240)
  return safe
}
function enrich(track, userId = '') {
  const cached = audioDownloader.getCachedFile(track.id)
  const favorite = Object.hasOwn(track, 'is_favorite') ? track.is_favorite : (userId ? isFavorite(track.id, userId) : false)
  return publicTrack({ ...track, is_downloaded: Boolean(cached), is_favorite: Boolean(favorite), ...(cached ? { file_url: `/api/stream/${encodeURIComponent(track.id)}` } : {}) })
}
function parseOffset(value) {
  if (value === undefined || value === null || value === '') return 0
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) { const e = new Error('offset 0-1000000 arasında tam sayı olmalı'); e.statusCode = 422; throw e }
  return n
}
function trackPayload(raw) {
  const body = raw && typeof raw === 'object' ? raw : {}
  const payload = {
    title: requireText(body.title, 'title'), artist: requireText(body.artist, 'artist'),
    album: optionalText(body.album, 300), cover_url: optionalHttpsUrl(body.cover_url, 'cover_url'),
    preview_url: optionalHttpsUrl(body.preview_url, 'preview_url'), duration: parseDuration(body.duration),
    source: optionalText(body.source || 'unknown', 40).toLowerCase(), source_id: body.source_id ? optionalText(body.source_id, 200) : null,
    spotify_id: body.spotify_id ? optionalText(body.spotify_id, 200) : null,
  }
  if (body.id) payload.id = requireId(body.id)
  return payload
}

function maybePrewarm(track) {
  try {
    if (!track?.id || !track?.title || !track?.artist) return
    if (audioDownloader.getCachedFile(track.id) || audioDownloader.isDownloadActive(track.id)) return
    if (audioDownloader.activeDownloadCount >= MAX_CONCURRENT_DOWNLOADS || audioDownloader.queuedDownloadCount >= MAX_CONCURRENT_DOWNLOADS * 2) return
    audioDownloader.startBackgroundDownload(track)
  } catch {}
}
function rememberCatalogTracks(tracks = []) {
  for (const track of tracks) {
    try {
      if (track?.id && track?.title && track?.artist) saveOrUpdateTrack(track)
    } catch {
      // Bir arama sonucu veritabanına yazılamasa bile diğer sonuçlar kullanılabilir.
    }
  }
}

app.get('/api/health', { schema: { response: { 200: { type: 'object', additionalProperties: false, properties: { status: { type: 'string' }, timestamp: { type: 'string' } } } } } }, async () => ({ status: 'ok', timestamp: new Date().toISOString() }))
app.post('/api/auth/register', async (req, reply) => {
  if (D1_AUTH_PROXY_ENABLED) return proxyD1Auth(req, reply, '/api/auth/register')
  const email = requireEmail(req.body?.email)
  const password = requirePassword(req.body?.password)
  const displayName = optionalDisplayName(req.body?.display_name || req.body?.displayName, email)
  if (getUserByEmail(email)) return reply.code(409).send({ detail: 'Bu e-posta zaten kayıtlı.', code: 'EMAIL_IN_USE' })
  try {
    const user = createUser({ email, password, displayName })
    const session = createSession(user.id)
    return reply.code(201).send({ user, token: session.token, expires_at: session.expires_at })
  } catch (error) {
    if (String(error?.code || '').includes('SQLITE_CONSTRAINT')) return reply.code(409).send({ detail: 'Bu e-posta zaten kayıtlı.', code: 'EMAIL_IN_USE' })
    throw error
  }
})
app.post('/api/auth/login', async (req, reply) => {
  if (D1_AUTH_PROXY_ENABLED) return proxyD1Auth(req, reply, '/api/auth/login')
  const email = requireEmail(req.body?.email)
  const password = requirePassword(req.body?.password)
  const user = verifyUser(email, password)
  if (!user) return reply.code(401).send({ detail: 'E-posta veya şifre hatalı.', code: 'INVALID_CREDENTIALS' })
  const session = createSession(user.id)
  return { user, token: session.token, expires_at: session.expires_at }
})
app.get('/api/auth/me', async (req, reply) => {
  if (D1_AUTH_PROXY_ENABLED) return proxyD1Auth(req, reply, '/api/auth/me')
  const user = await currentUser(req)
  if (!user) return reply.code(401).send({ detail: 'Oturum açmanız gerekiyor.', code: 'AUTH_REQUIRED' })
  return { user }
})
app.post('/api/auth/logout', async (req, reply) => {
  if (D1_AUTH_PROXY_ENABLED) {
    try { return await proxyD1Auth(req, reply, '/api/auth/logout') }
    finally { const token = requestToken(req); if (token) d1UserCache.delete(d1CacheKey(token)) }
  }
  deleteSession(requestToken(req)); return { logged_out: true }
})
app.get('/api/metrics', async (req) => {
  await requireUser(req)
  const routes = Object.fromEntries([...requestMetrics.entries()].map(([route, item]) => [route, {
    ...item, avgMs: item.count ? Number((item.totalMs / item.count).toFixed(2)) : 0,
  }]))
  return { routes, search: spotifyService.getStats(), downloads: { active: audioDownloader.activeDownloadCount, queued: audioDownloader.queuedDownloadCount, activeStates: activeDownloads.size } }
})
app.get('/api/search', async (req) => {
  const q = requireText(req.query?.q, 'q', 300)
  const limit = parseLimit(req.query?.limit, 20, MAX_SEARCH_LIMIT)
  const rawTracks = await spotifyService.search(q, limit)
  rememberCatalogTracks(rawTracks)
  const user = await currentUser(req)
  const tracks = rawTracks.map((track) => enrich(track, user?.id))
  tracks.slice(0, 2).forEach(maybePrewarm)
  return { query: q, count: tracks.length, results: tracks }
})
app.get('/api/trending', async (req) => {
  const data = await spotifyService.getTrending()
  const trending = data.trending_tracks || []
  rememberCatalogTracks(trending)
  trending.slice(0, 2).forEach(maybePrewarm)
  const user = await currentUser(req)
  return { ...data, trending_tracks: trending.map((track) => enrich(track, user?.id)) }
})
app.get('/api/spotify-link', async (req, reply) => {
  const url = requireText(req.query?.url, 'url', 2000)
  let parsed
  try { parsed = new URL(url) } catch { return reply.code(400).send({ detail: 'Geçersiz Spotify bağlantısı.', code: 'INVALID_SPOTIFY_URL' }) }
  if (parsed.protocol !== 'https:' || parsed.port || !['open.spotify.com', 'www.open.spotify.com'].includes(parsed.hostname)) return reply.code(400).send({ detail: 'Geçersiz Spotify bağlantısı.', code: 'INVALID_SPOTIFY_URL' })
  const result = await spotifyService.parseSpotifyUrl(parsed.toString())
  if (!result || result.type === 'unknown' || result.error) return reply.code(400).send({ detail: result?.error || 'Bağlantı çözülemedi.', code: 'INVALID_SPOTIFY_URL' })
  return result
})
app.get('/api/track/:trackId', async (req, reply) => {
  const id = requireId(req.params.trackId)
  const track = getTrack(id)
  if (!track) return reply.code(404).send({ detail: 'Parça bulunamadı.', code: 'TRACK_NOT_FOUND' })
  return enrich(track, (await currentUser(req))?.id)
})
app.post('/api/download', async (req, reply) => {
  const track = saveOrUpdateTrack(trackPayload(req.body))
  const cached = audioDownloader.getCachedFile(track.id)
  if (cached) return { status: 'ready', message: 'Parça zaten indirilmiş ve hazır.', track_id: track.id, file_url: `/api/stream/${encodeURIComponent(track.id)}` }
  const { started, state } = audioDownloader.startBackgroundDownload(track)
  if (!started && state?.status === 'error') return reply.code(state.code === 'DOWNLOAD_QUEUE_FULL' ? 429 : 503).send({ status: state.status, message: state.error, track_id: track.id, code: state.code || 'DOWNLOAD_UNAVAILABLE' })
  return reply.code(started ? 202 : 200).send({ status: state.status, message: started ? 'İndirme arka planda başlatıldı.' : 'İndirme zaten sürüyor.', track_id: track.id })
})
app.get('/api/status/:trackId', async (req) => {
  const id = requireId(req.params.trackId)
  const cached = audioDownloader.getCachedFile(id)
  if (cached) return { status: 'completed', progress: 100, is_downloaded: true, file_url: `/api/stream/${encodeURIComponent(id)}` }
  return publicDownloadState(activeDownloads.get(id) || { status: 'idle', progress: 0, is_downloaded: false })
})
app.post('/api/play/:trackId', async (req, reply) => {
  const id = requireId(req.params.trackId)
  if (!getTrack(id)) return reply.code(404).send({ detail: 'Parça bulunamadı.', code: 'TRACK_NOT_FOUND' })
  const user = await currentUser(req)
  if (!user) return { track_id: id, recorded: false }
  recordPlay(id, user.id); return { track_id: id, recorded: true }
})
app.get('/api/resolve/:trackId', async (req, reply) => {
  const id = requireId(req.params.trackId)
  const cached = audioDownloader.getCachedFile(id)
  if (cached) return { mode: 'file', url: `/api/stream/${id}`, is_downloaded: true }
  let track = getTrack(id)
  if (!track) {
    const artist = requireText(req.query?.artist, 'artist')
    const title = requireText(req.query?.title, 'title')
    track = saveOrUpdateTrack({ id, artist, title, album: optionalText(req.query?.album, 300), cover_url: optionalHttpsUrl(req.query?.cover_url, 'cover_url'), duration: parseDuration(req.query?.duration), source: optionalText(req.query?.source || 'unknown', 40), source_id: req.query?.source_id ? optionalText(req.query.source_id, 200) : null, spotify_id: req.query?.spotify_id ? optionalText(req.query?.spotify_id, 200) : null })
  }
  const { state } = audioDownloader.startBackgroundDownload(track, { priority: true })
  if (state?.status === 'error') return reply.code(state.code === 'DOWNLOAD_QUEUE_FULL' ? 429 : 503).send({ detail: state.error, code: state.code || 'DOWNLOAD_UNAVAILABLE' })
  return { mode: 'file', url: `/api/stream/${id}`, is_downloaded: false, partial: true }
})
app.get('/api/stream/:trackId', async (req, reply) => {
  const id = requireId(req.params.trackId)
  const file = audioDownloader.getCachedFile(id)
  if (file) {
    const stat = fs.statSync(file); const size = stat.size; const mime = MIME_BY_EXT[path.extname(file).toLowerCase()]
    if (!mime) return reply.code(415).send({ detail: 'Ses biçimi desteklenmiyor.', code: 'UNSUPPORTED_AUDIO' })
    const range = req.headers.range
    if (!range) {
      reply.header('Accept-Ranges', 'bytes').header('Content-Type', mime).header('Cache-Control', 'private, max-age=3600').header('Content-Length', String(size))
      return reply.send(fs.createReadStream(file))
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match) return reply.code(416).header('Content-Range', `bytes */${size}`).send({ detail: 'Geçersiz byte aralığı.', code: 'INVALID_RANGE' })
    let start = match[1] ? Number(match[1]) : null; let end = match[2] ? Number(match[2]) : null
    if (start === null && end !== null) { const suffix = Math.min(end, size); start = size - suffix; end = size - 1 }
    else { start ??= 0; end ??= size - 1 }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return reply.code(416).header('Content-Range', `bytes */${size}`).send({ detail: 'İstenen byte aralığı dosyanın dışında.', code: 'RANGE_NOT_SATISFIABLE' })
    end = Math.min(end, size - 1)
    reply.code(206).header('Accept-Ranges', 'bytes').header('Content-Type', mime).header('Cache-Control', 'private, max-age=3600')
      .header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', String(end - start + 1))
    return reply.send(fs.createReadStream(file, { start, end }))
  }
  if (audioDownloader.isDownloadActive(id) || audioDownloader.getPartialFile(id)) {
    const partial = audioDownloader.getPartialFile(id)
    const ext = partial ? path.extname(partial.replace(/\.part$/, '')).toLowerCase() : '.m4a'
    const mime = MIME_BY_EXT[ext] || 'audio/mpeg'
    const range = req.headers.range
    let start = 0
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && match[2])) return reply.code(416).header('Content-Range', 'bytes */0').send({ detail: 'Geçersiz byte aralığı.', code: 'INVALID_RANGE' })
      start = match[1] ? Number(match[1]) : 0
      if (!Number.isInteger(start) || start < 0) return reply.code(416).header('Content-Range', 'bytes */0').send({ detail: 'İstenen byte aralığı geçersiz.', code: 'INVALID_RANGE' })
    }
    reply.header('Accept-Ranges', 'bytes').header('Content-Type', mime).header('Cache-Control', 'private, no-store')
    return reply.send(audioDownloader.createFollowStream(id, start))
  }
  return reply.code(404).send({ detail: 'Önbellekte ses dosyası bulunamadı.', code: 'AUDIO_NOT_CACHED' })
})
app.get('/api/download-file/:trackId', async (req, reply) => {
  const id = requireId(req.params.trackId); const file = audioDownloader.getCachedFile(id)
  if (!file) return reply.code(404).send({ detail: 'Dosya henüz indirilmemiş.', code: 'AUDIO_NOT_CACHED' })
  const track = getTrack(id); const ext = path.extname(file)
  const base = `${sanitizeFilename(track?.artist) || 'Artist'} - ${sanitizeFilename(track?.title) || id}${ext}`
  const ascii = base.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  reply.header('Cache-Control', 'private, no-store').header('Content-Type', MIME_BY_EXT[ext.toLowerCase()] || 'application/octet-stream')
    .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`)
    .header('Content-Length', String(fs.statSync(file).size))
  return reply.send(fs.createReadStream(file))
})
app.get('/api/library', async (req) => {
  const user = await requireUser(req)
  const limit = parseLimit(req.query?.limit, MAX_LIBRARY_LIMIT, MAX_LIBRARY_LIMIT)
  const offset = parseOffset(req.query?.offset)
  const tracks = getAllDownloadedTracks({ limit, offset }).map((track) => enrich(track, user.id)).filter((t) => t.is_downloaded)
  return { count: tracks.length, total: getDownloadedTrackCount(), limit, offset, tracks }
})
app.get('/api/favorites', async (req) => {
  const user = await requireUser(req)
  const limit = parseLimit(req.query?.limit, MAX_LIBRARY_LIMIT, MAX_LIBRARY_LIMIT)
  const offset = parseOffset(req.query?.offset)
  const favorites = getFavorites({ userId: user.id, limit, offset }).map((track) => enrich(track, user.id))
  return { count: favorites.length, total: getFavoriteCount(user.id), limit, offset, favorites }
})
app.post('/api/favorites/:trackId', async (req, reply) => {
  const user = await requireUser(req)
  const id = requireId(req.params.trackId)
  if (!getTrack(id)) {
    if (!req.body || typeof req.body !== 'object') return reply.code(404).send({ detail: 'Parça bulunamadı.', code: 'TRACK_NOT_FOUND' })
    const payload = trackPayload({ ...req.body, id }); saveOrUpdateTrack(payload)
  }
  return { track_id: id, is_favorite: toggleFavorite(id, user.id) }
})
app.get('/api/history', async (req) => {
  const user = await requireUser(req)
  const limit = parseLimit(req.query?.limit, 30, MAX_HISTORY_LIMIT)
  const offset = parseOffset(req.query?.offset)
  const history = getHistory(user.id, limit, offset).map((track) => enrich(track, user.id))
  return { count: history.length, limit, offset, history }
})
app.delete('/api/history', async (req) => { clearHistory((await requireUser(req)).id); return { cleared: true } })
app.get('/api/lyrics', async (req) => {
  const title = requireText(req.query?.title, 'title'); const artist = requireText(req.query?.artist, 'artist'); const duration = parseDuration(req.query?.duration)
  return lyricsService.getLyrics(title, artist, duration)
})

// Radyo: tohum parçadan "kişinin sevebileceği" sıradaki parçalar. Sinyaller:
// 1) Aynı sanatçının diğer parçaları (her zaman güçlü tercih),
// 2) Dinleme geçmişindeki ortak sanatçılar (yakınlık zamanıyla ağırlıklı —
//    "bu sanatçıyı çalarken şunları da dinliyordun"),
// 3) Favorilenen sanatçılar (+2 ağırlık),
// 4) Havuz yetersizse tohum başlığına benzer arama.
// Fisher-Yates karıştırması crypto.randomInt ile (kaynak denetimini bozmadan).
const shuffleRadio = (arr) => { const c = [...arr]; for (let i = c.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]] } return c }
function artistTokensOf(value) { return new Set(String(value || '').toLocaleLowerCase('tr-TR').split(/[^\p{L}\p{N}]+/u).filter(Boolean)) }
function sameRadioArtist(a, b) {
  const A = artistTokensOf(a); const B = artistTokensOf(b)
  for (const token of A) if (B.has(token)) return true
  return false
}
app.get('/api/radio/:trackId', async (req) => {
  const id = requireId(req.params.trackId)
  const count = parseLimit(req.query?.count, 12, 24)
  const excludeText = optionalText(req.query?.exclude, 1600)
  const exclude = new Set(excludeText.split(',').map((x) => x.trim()).filter(Boolean).map((x) => requireId(x, 'exclude')))
  let seed = getTrack(id)
  if (!seed) {
    const artist = requireText(req.query?.artist, 'artist'); const title = requireText(req.query?.title, 'title')
    seed = { id, artist, title }
  }
  exclude.add(id)
  const pool = []
  const seen = new Set()
  const push = (track) => {
    if (!track?.id || !track?.title || !track?.artist) return
    if (exclude.has(track.id) || seen.has(track.id)) return
    seen.add(track.id); pool.push(track)
  }
  // 1) Aynı sanatçının diğer parçaları (search doğrudan dizi döndürür)
  const artistTracks = await spotifyService.search(seed.artist, 20).catch(() => [])
  for (const track of artistTracks || []) if (sameRadioArtist(track.artist, seed.artist)) push(track)
  // 2) Geçmiş yakınlığı: son çalınanlar (yeniler daha ağır) + favoriler (+2)
  const weights = new Map()
  const bump = (artist, weight) => { const key = String(artist || '').trim(); if (!key || sameRadioArtist(key, seed.artist)) return; weights.set(key, (weights.get(key) || 0) + weight) }
  const user = await currentUser(req)
  const history = user ? getHistory(user.id, 120) : []
  history.forEach((entry, index) => bump(entry.artist, 1 + (history.length - index) / Math.max(1, history.length)))
  if (user) for (const favorite of getFavorites({ userId: user.id, limit: 50 })) bump(favorite.artist, 2)
  const relatedArtists = [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([artist]) => artist)
  // 3) İlgili sanatçıların öne çıkan parçaları (paralel)
  const perArtist = Math.max(2, Math.ceil(count / 3))
  await Promise.allSettled(relatedArtists.map((artist) => spotifyService.search(artist, perArtist).then((tracks) => {
    for (const track of tracks || []) if (sameRadioArtist(track.artist, artist)) push(track)
  })))
  // 4) Havuz yetersizse başlık temelli tamamlayıcı
  if (pool.length < count) {
    const similar = await spotifyService.search(`${seed.artist} ${seed.title}`, 12).catch(() => [])
    for (const track of similar || []) push(track)
  }
  const tracks = shuffleRadio(pool).slice(0, count).map((track) => enrich(track, user?.id))
  return { seed_id: id, seed_artist: seed.artist, count: tracks.length, related_artists: relatedArtists, tracks }
})
app.get('/api/playlists', async (req) => ({ playlists: listPlaylists((await requireUser(req)).id) }))
app.post('/api/playlists', async (req, reply) => {
  const user = await requireUser(req)
  const name = requireText(req.body?.name, 'name', 120)
  return reply.code(201).send(createPlaylist({ userId: user.id, name, description: optionalText(req.body?.description, 1000), cover_url: optionalHttpsUrl(req.body?.cover_url, 'cover_url') }))
})
app.get('/api/playlists/:playlistId', async (req, reply) => { const user = await requireUser(req); const item = getPlaylist(requireId(req.params.playlistId, 'playlistId'), user.id); return item ? { ...item, tracks: item.tracks.map((track) => enrich(track, user.id)) } : reply.code(404).send({ detail: 'Çalma listesi bulunamadı.', code: 'PLAYLIST_NOT_FOUND' }) })
app.delete('/api/playlists/:playlistId', async (req, reply) => { const user = await requireUser(req); return deletePlaylist(requireId(req.params.playlistId, 'playlistId'), user.id) ? { deleted: true } : reply.code(404).send({ detail: 'Çalma listesi bulunamadı.', code: 'PLAYLIST_NOT_FOUND' }) })
app.post('/api/playlists/:playlistId/tracks/:trackId', async (req, reply) => {
  const user = await requireUser(req)
  const playlistId = requireId(req.params.playlistId, 'playlistId'); const trackId = requireId(req.params.trackId)
  if (!playlistExists(playlistId, user.id)) return reply.code(404).send({ detail: 'Çalma listesi bulunamadı.', code: 'PLAYLIST_NOT_FOUND' })
  if (!getTrack(trackId)) return reply.code(404).send({ detail: 'Parça bulunamadı.', code: 'TRACK_NOT_FOUND' })
  const playlist = addPlaylistTrack(playlistId, trackId, user.id)
  return { ...playlist, tracks: playlist.tracks.map((track) => enrich(track, user.id)) }
})
app.delete('/api/playlists/:playlistId/tracks/:trackId', async (req, reply) => {
  const user = await requireUser(req)
  const playlistId = requireId(req.params.playlistId, 'playlistId'); const trackId = requireId(req.params.trackId)
  if (!playlistExists(playlistId, user.id)) return reply.code(404).send({ detail: 'Çalma listesi bulunamadı.', code: 'PLAYLIST_NOT_FOUND' })
  const playlist = removePlaylistTrack(playlistId, trackId, user.id)
  return { ...playlist, tracks: playlist.tracks.map((track) => enrich(track, user.id)) }
})
app.get('/api/dokuman', sendIndex)
app.get('/', sendIndex)
app.get('/*', (req, reply) => {
  // Bilinmeyen API/downloads yolları SPA HTML'i değil tutarlı JSON 404 dönmeli.
  if (req.url.startsWith('/api/') || req.url.startsWith('/downloads/')) return reply.code(404).send({ detail: 'Kaynak bulunamadı.', code: 'NOT_FOUND' })
  return path.extname(req.url.split('?')[0]) ? reply.code(404).send({ detail: 'Kaynak bulunamadı.', code: 'NOT_FOUND' }) : sendIndex(req, reply)
})

let closing = false
async function shutdown(signal) {
  if (closing) return; closing = true; app.log.info({ signal }, 'shutting down')
  clearInterval(cleanupRateTimer); audioDownloader.shutdown(); await app.close()
}
process.once('SIGINT', () => shutdown('SIGINT').finally(() => process.exit(0)))
process.once('SIGTERM', () => shutdown('SIGTERM').finally(() => process.exit(0)))

try {
  await app.listen({ port: PORT, host: HOST })
  const displayHost = HOST.includes(':') && !HOST.startsWith('[') ? `[${HOST}]` : HOST
  app.log.info(`Sunucu çalışıyor: http://${displayHost}:${PORT} (IPv6 aktif)`)
}
catch (error) { app.log.error(error); process.exit(1) }

