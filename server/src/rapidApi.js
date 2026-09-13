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
// TÜM ses URL'leri döner (sıralı: m4a öncelikli). Biri IP-kilitli (403) çıkarsa
// sıradaki denenir.
async function viaDownloader1All(videoId) {
  const data = await rapidGet(HOST_DL1, `/download.php?id=${encodeURIComponent(videoId)}`)
  const rows = Array.isArray(data?.results) ? data.results : []
  const audio = rows.filter((r) => r?.has_audio && r?.url && /^https?:\/\//u.test(r.url))
  if (!audio.length) return []
  const title = String(data?.title || '')
  const m4a = audio.filter((r) => /mp4|m4a/u.test(String(r.mime || '')))
  const rest = audio.filter((r) => !/mp4|m4a/u.test(String(r.mime || '')))
  return [...m4a, ...rest].map((r) => ({ url: r.url, title, via: 'rapid-dl1' }))
}

// Sağlayıcı 2: adaptive (ses) + muxed. TÜM adaylar döner.
async function viaYtstreamAll(videoId) {
  const data = await rapidGet(HOST_DL2, `/dl?id=${encodeURIComponent(videoId)}`)
  const out = []
  const title = String(data?.title || '')
  const adaptive = Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats : []
  const audioOnly = adaptive
    .filter((f) => f?.url && /^https?:\/\//u.test(f.url) && /^audio\//u.test(String(f.mimeType || '')))
    .sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))
  for (const f of audioOnly) out.push({ url: f.url, title, via: 'rapid-dl2' })
  for (const f of (Array.isArray(data?.formats) ? data.formats : [])) {
    if (f?.url && /audio/u.test(String(f.mimeType || ''))) out.push({ url: f.url, title, via: 'rapid-dl2-muxed' })
  }
  return out
}

// videoId → doğrudan ses URL ADAYLARI (sıralı). Her biri tek tek denenmelidir:
// biri 403 yerse sıradaki (farklı host/redirector) çalışabilir.
export async function fetchRapidCandidates(videoId) {
  const id = String(videoId || '').trim()
  if (!rapidEnabled() || !/^[\w-]{11}$/u.test(id)) return []
  const out = []
  try {
    for (const c of await viaDownloader1All(id).catch(() => [])) {
      if (!out.some((x) => x.url === c.url)) out.push(c)
    }
  } catch {}
  try {
    for (const c of await viaYtstreamAll(id).catch(() => [])) {
      if (!out.some((x) => x.url === c.url)) out.push(c)
    }
  } catch {}
  return out
}

// videoId → doğrudan ses URL'si. Sırayla dener, ilk bulan kazanır.
export async function fetchRapidStream(videoId) {
  const all = await fetchRapidCandidates(videoId).catch(() => [])
  return all[0] || null
}
