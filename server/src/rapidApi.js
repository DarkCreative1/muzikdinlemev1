// RapidAPI YouTube yedekleri: hesap/çerez gerektirmez, API anahtarıyla çalışır.
// Anahtar koda GÖMÜLMEZ — Render Environment'da RAPIDAPI_KEY olarak verilir.
// Sıra: 1) video-and-shorts-downloader (results[].has_audio) 2) ytstream (adaptiveFormats)
const API_KEY = process.env.RAPIDAPI_KEY || ''
const HOST_DL1 = 'youtube-video-and-shorts-downloader.p.rapidapi.com'
const HOST_DL2 = 'ytstream-download-youtube-videos.p.rapidapi.com'

export const rapidEnabled = () => Boolean(API_KEY)

async function rapidGet(host, apiPath, timeoutMs = 12_000) {
  const res = await fetch(`https://${host}${apiPath}`, {
    headers: {
      Accept: 'application/json',
      'x-rapidapi-host': host,
      'x-rapidapi-key': API_KEY,
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) return null
  return res.json().catch(() => null)
}

// Sağlayıcı 1: { results: [{ has_audio, mime, quality, url }] }
async function viaDownloader1(videoId) {
  const data = await rapidGet(HOST_DL1, `/download.php?id=${encodeURIComponent(videoId)}`)
  const rows = Array.isArray(data?.results) ? data.results : []
  const audio = rows.filter((r) => r?.has_audio && r?.url && /^https?:\/\//u.test(r.url))
  if (!audio.length) return null
  const best = audio.find((r) => /mp4|m4a/u.test(String(r.mime || ''))) || audio[0]
  return { url: best.url, title: String(data?.title || ''), via: 'rapid-dl1' }
}

// Sağlayıcı 2: { adaptiveFormats: [{ mimeType, bitrate, url }], formats: [...] }
async function viaYtstream(videoId) {
  const data = await rapidGet(HOST_DL2, `/dl?id=${encodeURIComponent(videoId)}`)
  const adaptive = Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats : []
  const audioOnly = adaptive
    .filter((f) => f?.url && /^https?:\/\//u.test(f.url) && /^audio\//u.test(String(f.mimeType || '')))
    .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))
  if (audioOnly.length) return { url: audioOnly[0].url, title: String(data?.title || ''), via: 'rapid-dl2' }
  const muxed = (Array.isArray(data?.formats) ? data.formats : [])
    .find((f) => f?.url && /audio/u.test(String(f.mimeType || '')) && /mp4/u.test(String(f.mimeType || '')))
  if (muxed) return { url: muxed.url, title: String(data?.title || ''), via: 'rapid-dl2-muxed' }
  return null
}

// videoId → doğrudan ses URL'si. Sırayla dener, ilk bulan kazanır.
export async function fetchRapidStream(videoId) {
  const id = String(videoId || '').trim()
  if (!rapidEnabled() || !/^[\w-]{11}$/u.test(id)) return null
  try {
    const first = await viaDownloader1(id).catch(() => null)
    if (first?.url) return first
  } catch {}
  try {
    const second = await viaYtstream(id).catch(() => null)
    if (second?.url) return second
  } catch {}
  return null
}
