// YouTube arama: yt-dlp alt sürecini atlayıp doğrudan InnerTube (youtubei) uçlarına gider.
// Ölçüm: yt-dlp flatPlaylist ~2050 ms / 6 aday, InnerTube ~660 ms / 20 aday.
// Not: InnerTube "player" ucu artık PO token istediği için ses URL'si buradan ALINAMAZ;
// bu yüzden yalnızca arama/adaylar için kullanılır, indirmeyi yt-dlp yapar.

const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1'
const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const CLIENT = { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'tr', gl: 'TR' }
// hl=tr: YouTube, yükleyici çok dilli başlık girdiyse görüntüleme diline göre ÇEVİRİ
// döndürür (hl=en iken Türkçe videoların adı İngilizce görünüyordu: "Yanlış"→"Wrong").
// hl=tr ile Türkçe içerik orijinal adıyla, İngilizce içerik ise yükleyici çeviri
// eklemediği sürece orijinal İngilizce adıyla döner — hiçbir şey bizim tarafımızdan
// çevrilmez.
const VIDEO_ONLY_PARAMS = 'EgIQAQ%3D%3D'
const CHANNEL_ONLY_PARAMS = 'EgIQAg%3D%3D'
const CHANNEL_VIDEOS_PARAMS = 'EgZ2aWRlb3PyBgQKAjoA'
const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX = 300

const cache = new Map()

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null }
  return hit.items
}

function cacheSet(key, items) {
  cache.set(key, { items, at: Date.now() })
  if (cache.size > CACHE_MAX) {
    for (const staleKey of [...cache.keys()].slice(0, Math.ceil(cache.size * 0.2))) cache.delete(staleKey)
  }
}

function runsToText(node) {
  if (!node) return ''
  if (typeof node.simpleText === 'string') return node.simpleText
  return (node.runs || []).map((run) => run?.text || '').join('')
}

function parseDurationText(text) {
  const parts = String(text || '').trim().split(':').map((part) => Number.parseInt(part, 10))
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

// InnerTube yanıtları render ağaçlarında derine gömülü döner (richItem/grid/section
// farkları); videoRenderer'ları bulmak için ağacı bütünüyle gez.
function collectRenderers(node, kind, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const item of node) collectRenderers(item, kind, out); return out }
  const renderer = node[kind]
  if (renderer && (kind !== 'videoRenderer' || renderer.videoId)) { out.push(renderer); return out }
  for (const value of Object.values(node)) collectRenderers(value, kind, out)
  return out
}

function collectVideoRenderers(payload) {
  return collectRenderers(payload, 'videoRenderer')
}

async function innertube(endpoint, body, timeoutMs) {
  const res = await fetch(`${INNERTUBE_BASE}/${endpoint}?prettyPrint=false&key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': CLIENT.clientVersion,
      Origin: 'https://www.youtube.com',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`YouTube ${endpoint} ${res.status}`)
  return res.json()
}

function videoItem(video) {
  const duration = parseDurationText(video.lengthText?.simpleText)
  return {
    id: video.videoId,
    title: runsToText(video.title),
    channel: runsToText(video.ownerText) || runsToText(video.longBylineText),
    duration,
    is_short: duration > 0 && duration < 30,
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
  }
}

export async function searchYouTubeTracks(query, { limit = 12, timeoutMs = 6_000 } = {}) {
  const key = `v:${String(query || '').trim().toLowerCase()}`
  if (!key.slice(2)) return []
  const cached = cacheGet(key)
  if (cached) return cached.slice(0, limit)

  const data = await innertube('search', { context: { client: CLIENT }, query, params: VIDEO_ONLY_PARAMS }, timeoutMs)
  const items = collectVideoRenderers(data)
    // Canlı yayınların lengthText'i yok; indirilebilir olmadıkları için atlanır.
    .filter((video) => video.lengthText?.simpleText)
    .map(videoItem)
  if (items.length) cacheSet(key, items)
  return items.slice(0, limit)
}

// Kanal araması: "kabileshef" gibi üretici adları video başlıklarında geçmeyebilir;
// kanal bulunup videoları listelenebilir.
export async function searchYouTubeChannels(query, { limit = 3, timeoutMs = 6_000 } = {}) {
  const key = `c:${String(query || '').trim().toLowerCase()}`
  if (!key.slice(2)) return []
  const cached = cacheGet(key)
  if (cached) return cached.slice(0, limit)

  const data = await innertube('search', { context: { client: CLIENT }, query, params: CHANNEL_ONLY_PARAMS }, timeoutMs)
  const items = collectRenderers(data, 'channelRenderer')
    .filter((channel) => channel.channelId && runsToText(channel.title))
    .map((channel) => ({
      channelId: channel.channelId,
      title: runsToText(channel.title),
      handle: channel.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '',
      subscribers: runsToText(channel.subscriberCountText) || '',
      thumbnail: channel.thumbnail?.thumbnails?.at(-1)?.url || '',
    }))
  if (items.length) cacheSet(key, items)
  return items.slice(0, limit)
}

// Kanalın videolar sekmesi: en yeni yüklemeler. Kanal sayfaları videoları
// lockupViewModel olarak döner (videoRenderer yerine): contentId = video ID'si,
// başlık metadata altında, süre thumbnail rozetlerinde/metadata satırlarında.
function collectStrings(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const item of node) collectStrings(item, out); return out }
  for (const [key, value] of Object.entries(node)) {
    // Başlıklar 'content', rozet/süre metinleri 'text' anahtarındadır.
    if ((key === 'content' || key === 'text') && typeof value === 'string') out.push(value)
    else collectStrings(value, out)
  }
  return out
}
function parseDurationString(text) {
  const match = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(text || '').trim())
  if (!match) return 0
  if (match[3]) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  return Number(match[1]) * 60 + Number(match[2])
}
function findFirstKey(node, key) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const item of node) { const found = findFirstKey(item, key); if (found) return found } return null }
  for (const [k, value] of Object.entries(node)) {
    if (k === key) return value
    const found = findFirstKey(value, key)
    if (found) return found
  }
  return null
}
function lockupToVideo(lockup) {
  const id = String(lockup.contentId || '')
  if (!id) return null
  const title = lockup.metadata?.lockupMetadataViewModel?.title?.content
    || findFirstKey(lockup.metadata, 'lockupMetadataViewModel')?.title?.content || ''
  // Süre rozetleri contentImage içinde, metadata satırlarında da olabilir.
  const strings = [...collectStrings(lockup.contentImage), ...collectStrings(lockup.metadata)]
  let duration = 0
  for (const text of strings) { duration = parseDurationString(text); if (duration > 0) break }
  return { id, title: String(title || ''), channel: '', duration, is_short: duration > 0 && duration < 30, url: `https://www.youtube.com/watch?v=${id}` }
}

export async function getChannelVideos(channelId, { limit = 10, timeoutMs = 8_000 } = {}) {
  const key = `cv:${channelId}`
  const cached = cacheGet(key)
  if (cached) return cached.slice(0, limit)

  let items = []
  let channelName = ''
  try {
    const data = await innertube('browse', { context: { client: CLIENT }, browseId: channelId, params: CHANNEL_VIDEOS_PARAMS }, timeoutMs)
    channelName = findFirstKey(data, 'channelMetadataRenderer')?.title || ''
    items = collectVideoRenderers(data).filter((video) => video.lengthText?.simpleText).map(videoItem)
    if (!items.length) {
      // Yeni YouTube arayüzü kanal videolarını lockupViewModel olarak döner.
      items = collectRenderers(data, 'lockupViewModel')
        .filter((lockup) => lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')
        .map(lockupToVideo)
        .filter((item) => item?.id && item.title && item.duration > 0)
    }
  } catch {}
  if (!items.length) {
    // Videos sekmesi parametresi değişmiş olabilir: sekmesiz (ana sayfa) dene.
    try {
      const home = await innertube('browse', { context: { client: CLIENT }, browseId: channelId }, timeoutMs)
      channelName = channelName || findFirstKey(home, 'channelMetadataRenderer')?.title || ''
      items = collectVideoRenderers(home).filter((video) => video.lengthText?.simpleText).map(videoItem)
      if (!items.length) {
        items = collectRenderers(home, 'lockupViewModel')
          .filter((lockup) => lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')
          .map(lockupToVideo)
          .filter((item) => item?.id && item.title && item.duration > 0)
      }
    } catch {}
  }
  for (const item of items) if (!item.channel) item.channel = channelName
  const seen = new Set()
  const unique = items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
  if (unique.length) cacheSet(key, unique)
  return unique.slice(0, limit)
}

// oEmbed: video başlığı ve kanal adı için anahtar/token gerektirmeyen hafif uç.
// Süre dönmüyor (0 kalır) — doğrudan ID ile çalınan parçalar için sorun değil.
export async function getYouTubeVideoMeta(videoId, { timeoutMs = 6_000 } = {}) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.title) return null
    return { title: String(data.title), channel: String(data.author_name || '') }
  } catch { return null }
}

export function clearYouTubeSearchCache() {
  cache.clear()
}
