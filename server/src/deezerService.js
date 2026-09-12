import fs from 'node:fs'
import path from 'node:path'
import { DEEZER_ARL, DEEZER_ARL_FILE } from './config.js'

const GW_BASE = 'https://www.deezer.com/ajax/gw-light.php'
const MEDIA_URL = 'https://media.deezer.com/v1/get_url'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

let cachedArl = DEEZER_ARL || ''
if (!cachedArl && DEEZER_ARL_FILE) {
  try { cachedArl = fs.readFileSync(DEEZER_ARL_FILE, 'utf8').trim() } catch {}
}

export function getDeezerArl() {
  return cachedArl
}

export function hasDeezerAuth() {
  return Boolean(cachedArl)
}

async function gwCall(method, body, { apiToken = 'null', cookies = '' } = {}) {
  const url = `${GW_BASE}?api_version=1.0&input=3&output=3&api_token=${apiToken}&method=${method}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Deezer gw-light ${res.status}`)
  return res.json()
}

const SESSION_TTL_MS = 20 * 60_000
let sessionCache = null
let sessionPromise = null

async function createSession() {
  const home = await fetch('https://www.deezer.com/', { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  const setCookies = home.headers.getSetCookie?.() || []
  const sid = setCookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('sid='))
  const cookies = [sid, `arl=${cachedArl}`].filter(Boolean).join('; ')
  const data = await gwCall('deezer.getUserData', {}, { cookies })
  const results = data?.results || {}
  const apiToken = results.checkForm || ''
  const licenseToken = results.USER?.OPTIONS?.license_token || ''
  if (!apiToken || !licenseToken) throw new Error('Deezer oturumu alınamadı (ARL geçersiz veya süresi dolmuş olabilir).')
  return { apiToken, licenseToken, cookies, createdAt: Date.now() }
}

async function getSession({ force = false } = {}) {
  if (!force && sessionCache && Date.now() - sessionCache.createdAt < SESSION_TTL_MS) return sessionCache
  if (force) { sessionCache = null; sessionPromise = null }
  if (!sessionPromise) {
    sessionPromise = createSession()
      .then((session) => { sessionCache = session; return session })
      .catch((error) => { sessionCache = null; throw error })
      .finally(() => { sessionPromise = null })
  }
  return sessionPromise
}

export function invalidateDeezerSession() {
  sessionCache = null
  sessionPromise = null
}

export async function getDeezerTrackStream(sngId, { retryOnAuthFail = true } = {}) {
  let session
  try { session = await getSession() } catch (error) { if (!retryOnAuthFail) throw error; session = await getSession({ force: true }) }
  const { apiToken, licenseToken, cookies } = session
  const trackData = await gwCall('song.getData', { sng_id: sngId }, { apiToken, cookies })
  const track = trackData?.results
  const trackToken = track?.TRACK_TOKEN
  if (!trackToken) throw new Error('Deezer parça belirteci alınamadı.')
  // Free hesap: MP3_128 (Deezer free hesabın izin verdiği maksimum kalite, premium yok)
  const body = {
    license_token: licenseToken,
    media: [{ type: 'FULL', formats: [{ cipher: 'BF_CBC_STRIPE', format: 'MP3_128' }] }],
    track_tokens: [trackToken],
  }
  const res = await fetch(MEDIA_URL, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json', Cookie: cookies, Referer: 'https://www.deezer.com/' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  // Track token / lisans bayatladığında medya API 4xx döner: oturumu zorla yenile,
  // bir kez daha dene. İkinci deneme de başarısızsa üst katman YouTube'a düşer.
  if (!res.ok) {
    if (retryOnAuthFail && [400, 401, 403, 404].includes(res.status)) {
      invalidateDeezerSession()
      return getDeezerTrackStream(sngId, { retryOnAuthFail: false })
    }
    throw new Error(`Deezer medya API ${res.status}`)
  }
  const json = await res.json()
  return extractMedia(json, track)
}

function extractMedia(json, track) {
  const media = json?.data?.[0]?.media?.[0]
  const url = media?.sources?.[0]?.url
  if (!url) throw new Error('Deezer akış URL alınamadı.')
  return { url, filesize: Number(media.filesize) || 0, duration: Math.round(Number(track?.DURATION) || 0), title: track?.SNG_TITLE || '' }
}

export async function searchDeezerTracks(query, { limit = 10 } = {}) {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Deezer arama ${res.status}`)
  const data = await res.json()
  return (data.data || []).filter((t) => t?.id && t?.title).map((t) => ({
    id: String(t.id),
    title: t.title,
    user: t.artist?.name || '',
    contributors: (t.contributors || []).map((c) => c.name).filter(Boolean),
    duration: Math.round(Number(t.duration) || 0),
    filesize320: Number(t.filesize_mp3_320) || 0,
  }))
}
