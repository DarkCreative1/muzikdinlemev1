export function readFavoriteState(data) {
  return data?.favorite ?? data?.is_favorite ?? false
}

export function canSubmitPlaylistName(name) {
  return String(name ?? '').trim().length > 0
}
