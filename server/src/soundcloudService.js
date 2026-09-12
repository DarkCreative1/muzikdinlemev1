import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SOUNDCLOUD_CLIENT_ID, SOUNDCLOUD_COOKIE, SOUNDCLOUD_COOKIES_FILE } from './config.js'

const API_BASE = 'https://api-v2.soundcloud.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const CLIENT_ID_CACHE_TTL_MS = 60 * 60_000

let cachedClientId = SOUNDCLOUD_CLIENT_ID || ''
let cachedClientIdAt = 0
let clientIdPromise = null
let cachedOauthToken = null

function cookieText() {
  if (SOUNDCLOUD_COOKIE) return SOUNDCLOUD_COOKIE
  if (!SOUNDCLOUD_COOKIES_FILE) return ''
  try { return fs.readFileSync(SOUNDCLOUD_COOKIES_FILE, 'utf8') } catch { return '' }
}

function cookiePairs() {
  const pairs = {}
  for (const chunk of cookieText().split(';')) {
    const idx = chunk.indexOf('=')
    if (idx > 0) pairs[chunk.slice(0, idx).trim()] = chunk.slice(idx + 1).trim()
  }
  if (SOUNDCLOUD_COOKIES_FILE) {
    const text = cookieText()
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('\t')) continue
      const parts = line.split('\t')
      if (parts.length >= 7) pairs[parts[5]] = parts[6]
    }
  }
  return pairs
}

export function getSoundCloudCookieHeader() {
  if (SOUNDCLOUD_COOKIE) return SOUNDCLOUD_COOKIE
  if (!SOUNDCLOUD_COOKIES_FILE) return ''
  const text = cookieText()
  const list = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('\t')).map((l) => {
    const parts = l.split('\t')
    return parts.length >= 7 ? `${parts[5]}=${parts[6]}` : ''
  }).filter(Boolean)
  return list.join('; ')
}

export function getSoundCloudOAuthToken() {
  if (cachedOauthToken !== null) return cachedOauthToken
  cachedOauthToken = cookiePairs().oauth_token || ''
  return cachedOauthToken
}

function cookieFilePath() {
  const candidates = [
    path.join(os.homedir(), '.cache', 'yt-dlp', 'soundcloud', 'client_id.json'),
    path.join(os.homedir(), '.config', 'yt-dlp', 'soundcloud', 'client_id.json'),
    path.join(os.homedir(), 'AppData', 'Local', 'yt-dlp', 'soundcloud', 'client_id.json'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'yt-dlp', 'soundcloud', 'client_id.json'),
  ]
  return candidates.find((c) => { try { return fs.existsSync(c) } catch { return false } }) || null
}

async function fetchText(url, timeoutMs = 10_000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/javascript,*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) return null
  return res.text()
}

// client_id SoundCloud'un JS bundle'larında gömülüdür ve zamanla değişir; sayfadaki
// asset script'leri taranıp en son bulunandan çıkarılır. Cookie dosyası yoksa
// veya ENV'de verilmemişse bu yol sayesinde arama/akış yine çalışır.
// Bundle'lar PARALEL taranır: ilk eşleşme kazanır, toplam üst sınır ~15sn.
// (Önceki seri sürüm 8×10sn = 80sn'ye kadar sarkıp geri dönüş bütçesini yiyordu.)
async function discoverClientId() {
  const html = await fetchText('https://soundcloud.com/', 10_000)
  if (!html) return null
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
  const targets = scripts.reverse().slice(0, 8)
  if (!targets.length) return null
  return new Promise((resolve) => {
    let pending = targets.length
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => done(null), 15_000)
    timer.unref?.()
    for (const assetUrl of targets) {
      fetchText(assetUrl, 10_000).then((js) => {
        const match = js && js.match(/client_id\s*[:=]\s*"([A-Za-z0-9]{20,50})"/)
        if (match) done(match[1])
        else if (--pending === 0) done(null)
      }).catch(() => { if (--pending === 0) done(null) })
    }
  })
}

async function getClientId() {
  if (cachedClientId && Date.now() - cachedClientIdAt < CLIENT_ID_CACHE_TTL_MS) return cachedClientId
  const file = cookieFilePath()
  if (file) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (data?.data) { cachedClientId = data.data; cachedClientIdAt = Date.now(); return cachedClientId }
    } catch {}
  }
  if (!clientIdPromise) {
    clientIdPromise = discoverClientId()
      .then((id) => { clientIdPromise = null; if (id) { cachedClientId = id; cachedClientIdAt = Date.now() } return id })
      .catch(() => { clientIdPromise = null; return null })
  }
  return clientIdPromise
}

function authHeaders() {
  const headers = { 'User-Agent': UA, Accept: 'application/json' }
  const oauth = getSoundCloudOAuthToken()
  if (oauth) headers.Authorization = `OAuth ${oauth}`
  return headers
}

async function apiGet(url, timeoutMs = 10_000) {
  const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`SoundCloud API ${res.status}`)
  return res.json()
}

export function hasSoundCloudAuth() {
  return Boolean(getSoundCloudOAuthToken())
}

export async function searchSoundCloudTracks(query, { limit = 10, timeoutMs = 8_000 } = {}) {
  const key = String(query || '').trim()
  if (!key) return []
  const clientId = await getClientId()
  if (!clientId) return []
  const url = `${API_BASE}/search/tracks?q=${encodeURIComponent(key)}&limit=${limit}&client_id=${clientId}`
  const data = await apiGet(url, timeoutMs)
  return (data.collection || []).filter((t) => t?.title && t?.id).map((t) => ({
    id: String(t.id),
    title: t.title,
    user: t.user?.username || '',
    duration: Math.round((Number(t.duration) || 0) / 1000),
    permalink: t.permalink_url || '',
    artwork_url: t.artwork_url || '',
  }))
}

// Tam parça akışı: transcodings içinden kırpılmamış (snipped olmayan) olanı seçilir.
// progressive protokol doğrudan ses URL'i verir (indirme daha basit/güvenilir);
// yoksa HLS çalma listesi kullanılır — yt-dlp ikisini de indirir.
export async function getSoundCloudFullStream(trackId, { timeoutMs = 10_000 } = {}) {
  const clientId = await getClientId()
  if (!clientId) return null
  const track = await apiGet(`${API_BASE}/tracks/${trackId}?client_id=${clientId}`, timeoutMs)
  const transcodings = Array.isArray(track.media?.transcodings) ? track.media.transcodings : []
  const full = transcodings.find((t) => !t.snipped && t.format?.protocol === 'progressive')
    || transcodings.find((t) => !t.snipped && t.format?.protocol === 'hls')
  if (!full) return null
  const meta = await apiGet(`${full.url}?client_id=${clientId}`, timeoutMs)
  if (!meta?.url) return null
  return { url: meta.url, protocol: full.format?.protocol, duration: Math.round((Number(track.duration) || 0) / 1000) }
}
