// Kapak görseli yoksa kullanılacak gradient paleti — deterministik (id/title seed)
const PALETTE = [
  ['#4de8d6', '#0c2b28'],
  ['#8b6cff', '#22154f'],
  ['#f4a05c', '#4a2410'],
  ['#e86ca8', '#4a1533'],
  ['#5fa8f0', '#142c4f'],
  ['#7ad66f', '#1c3d15'],
  ['#f0d05f', '#45390f'],
  ['#c77bff', '#341a4f'],
  ['#6fcec4', '#143a36'],
  ['#f0786f', '#4a1712'],
  ['#8fa8d9', '#1d2b49'],
  ['#d99f6f', '#4a2d14'],
  ['#a8c46f', '#333d14'],
  ['#7fb2e8', '#142a4a'],
  ['#e88cd0', '#451a3d'],
  ['#6fb7a8', '#143a33'],
]

const paletteIndex = (value) => {
  const number = Number(value)
  if (Number.isInteger(number) && number >= 0) return number % PALETTE.length
  let hash = 0
  for (const char of String(value ?? '')) hash = (hash * 31 + char.codePointAt(0)) | 0
  return Math.abs(hash) % PALETTE.length
}

export const gradient = (value) => {
  const [from, to] = PALETTE[paletteIndex(value)]
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`
}

export const accent = (value) => PALETTE[paletteIndex(value)][0]
export const accentOf = accent

export const formatTime = formatDuration

export function formatDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const minutes = Math.floor(value / 60)
  const remainder = Math.floor(value % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export const formatTotal = (tracks = []) => {
  const total = tracks.reduce((sum, track) => sum + Math.max(0, Number(track?.duration) || 0), 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = Math.floor(total % 60)
  return hours ? `${hours} sa ${minutes} dk` : `${minutes} dk ${seconds} sn`
}