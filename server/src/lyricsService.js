const CACHE_TTL = 24 * 60 * 60_000
const cache = new Map()
const RE_BRACKETS = /\((?:feat\.?|ft\.?|featuring|with)\s+.*?\)|\[.*?\]|\{.*?\}/gi
async function fetchJson(url, timeoutMs = 5000) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try { const response = await fetch(url, { headers: { 'User-Agent': 'MusicApp/1.0' }, signal: ctrl.signal }); return response.ok ? await response.json() : null }
  catch { return null } finally { clearTimeout(timer) }
}
class LyricsService {
  async getLyrics(trackTitle, artist, duration = 0) {
    const cleanTitle = String(trackTitle || '').normalize('NFKC').replace(RE_BRACKETS, '').trim()
    const cleanArtist = String(artist || '').normalize('NFKC').replace(RE_BRACKETS, '').trim()
    if (!cleanTitle || !cleanArtist) return { found: false, synced: false, lyrics: '', plain: '', message: 'Şarkı adı ve sanatçı gerekli.' }
    const key = `${cleanArtist.toLowerCase()}|${cleanTitle.toLowerCase()}|${Math.round(Number(duration) || 0)}`
    const cached = cache.get(key); if (cached && Date.now() - cached.at < CACHE_TTL) return cached.value
    const params = new URLSearchParams({ track_name: cleanTitle, artist_name: cleanArtist })
    if (duration > 0) params.set('duration', String(Math.round(duration)))
    const [lrclib, ovh] = await Promise.all([
      fetchJson(`https://lrclib.net/api/get?${params}`),
      fetchJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`),
    ])
    let result
    if (lrclib?.syncedLyrics || lrclib?.plainLyrics) result = { found: true, synced: Boolean(lrclib.syncedLyrics), lyrics: lrclib.syncedLyrics || lrclib.plainLyrics, plain: lrclib.plainLyrics || '', source: 'LRCLIB' }
    else if (ovh?.lyrics) result = { found: true, synced: false, lyrics: ovh.lyrics, plain: ovh.lyrics, source: 'LyricsOVH' }
    else result = { found: false, synced: false, lyrics: '', plain: '', message: 'Bu parça için şarkı sözü bulunamadı.' }
    cache.set(key, { at: Date.now(), value: result })
    if (cache.size > 500) cache.delete(cache.keys().next().value)
    return result
  }
}
export const lyricsService = new LyricsService()
