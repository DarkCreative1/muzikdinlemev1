// Katalog seçicileri — gerçek varlık projeksiyonları, sahte veri yok
const PLACEHOLDER_LABELS = new Set(['', 'undefined', 'null', 'unknown', 'unknown artist'])

const meaningfulLabel = (value) => {
  const label = String(value ?? '').trim()
  return PLACEHOLDER_LABELS.has(label.toLowerCase()) ? '' : label
}

export function dedupeTracks(rows = []) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

export function groupSearchResults(rows = []) {
  const tracks = []
  const artistMap = new Map()
  const albumMap = new Map()
  const seen = new Set()

  for (const row of rows) {
    if (!row?.id) continue
    if (seen.has(row.id)) continue
    seen.add(row.id)
    tracks.push(row)

    const artistName = meaningfulLabel(row.artist)
    if (artistName && !artistMap.has(artistName)) {
      artistMap.set(artistName, { name: artistName, tracks: [] })
    }
    artistMap.get(artistName)?.tracks.push(row)

    const albumName = meaningfulLabel(row.album)
    const source = String(row.source || '').toLowerCase()
    const isSourceLabel = (source === 'youtube' && albumName.toLowerCase() === 'youtube')
      || (source === 'soundcloud' && albumName.toLowerCase() === 'soundcloud')
    const albumKey = `${albumName}|${artistName}`
    if (albumName && !isSourceLabel && !albumMap.has(albumKey)) {
      albumMap.set(albumKey, {
        title: albumName,
        artist: artistName,
        cover_url: row.cover_url,
        id: row.album_id || albumKey,
        tracks: [],
      })
    }
    if (!isSourceLabel) albumMap.get(albumKey)?.tracks.push(row)
  }

  return {
    tracks,
    artists: [...artistMap.values()],
    albums: [...albumMap.values()],
  }
}
