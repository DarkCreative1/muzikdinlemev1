// Parça meta yardımcıları
export function formatDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const minutes = Math.floor(value / 60)
  const remainder = Math.floor(value % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function formatTotalTime(tracks = []) {
  const total = tracks.reduce((sum, track) => sum + Math.max(0, Number(track?.duration) || 0), 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = Math.floor(total % 60)
  return hours ? `${hours} sa ${minutes} dk` : `${minutes} dk ${seconds} sn`
}

export function isCurrentTrack(track, player) {
  return Boolean(player?.current && track?.id && player.current.id === track.id)
}

export function trackKey(track) {
  return track?.id || `${track?.title}|${track?.artist}`
}