const NON_MUSIC_RE = /\b(?:vlog|bebek|baby|family|market|alışveriş|challenge|prank|reaction|reaksiyon|podcast|interview|röportaj|shorts?|tiktok|fyp|gameplay|oyun|makyaj|unboxing|routine|günlük|hamile|doğum|ev turu|temizlik|yemek tarifi|bayram vlog|aylık|deniz macerası|gerçek hayat)\b/i
const MUSIC_MARKER_RE = /\b(?:official|music|audio|lyrics?|şarkı|sarkı|klip|remix|cover|acoustic|live|concert|session|performance)\b/i
const STRUCTURED_TITLE_RE = /\s[-–—|]\s/

const normalize = (value) => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('tr-TR')
const compactName = (value) => normalize(value)
  .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
  .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .replace(/[^a-z0-9]/g, '')

const levenshtein = (a, b) => {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let rowIndex = 1; rowIndex <= a.length; rowIndex += 1) {
    const row = [rowIndex]
    for (let columnIndex = 1; columnIndex <= b.length; columnIndex += 1) {
      row[columnIndex] = Math.min(
        previous[columnIndex] + 1,
        row[columnIndex - 1] + 1,
        previous[columnIndex - 1] + (a[rowIndex - 1] === b[columnIndex - 1] ? 0 : 1),
      )
    }
    previous = row
  }
  return previous[b.length]
}

export function isLikelyMusicVideo(item, query = '') {
  const title = normalize(item?.title)
  const channel = normalize(item?.channel)
  const duration = Number(item?.duration) || 0
  if (!title || item?.is_short || (duration > 0 && duration < 30)) return false

  const searchableText = `${title} ${channel}`
  if (NON_MUSIC_RE.test(searchableText)) return false

  const queryText = normalize(query)
  return MUSIC_MARKER_RE.test(searchableText)
    || STRUCTURED_TITLE_RE.test(title)
    || Boolean(queryText && searchableText.includes(queryText))
}

export function isChannelMatch(query, channel) {
  const queryKey = compactName(query)
  if (queryKey.length < 3) return false
  const candidates = [channel?.title, String(channel?.handle || '').replace(/^@/, '')]
    .map(compactName)
    .filter((value) => value.length >= 3)
  return candidates.some((candidate) => {
    if (queryKey === candidate) return true
    const tolerance = Math.max(2, Math.floor(Math.max(queryKey.length, candidate.length) * 0.3))
    return levenshtein(queryKey, candidate) <= tolerance
  })
}

export function isChannelIntent(query, channel) {
  const text = normalize(query)
  const queryKey = compactName(query)
  const handleKey = compactName(String(channel?.handle || '').replace(/^\/?@/, ''))
  if (!isChannelMatch(query, channel)) return false
  return text.startsWith('@') || /\s/.test(text) || Boolean(handleKey && queryKey === handleKey)
}
