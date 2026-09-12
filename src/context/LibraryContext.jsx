import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api.js'
import { readFavoriteState } from '../lib/uiState.js'
import { useUI } from './UIContext.jsx'

const LibraryContext = createContext(null)

// Kitaplık verisinin tek sağlayıcısı: playlistler, favoriler, geçmiş, kitaplık parçaları
export function LibraryProvider({ children }) {
  const { toast } = useUI()
  const [playlists, setPlaylists] = useState([])
  const [favorites, setFavorites] = useState([])
  const [history, setHistory] = useState([])
  const [library, setLibrary] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [playlistData, favoriteData, historyData, libraryData] = await Promise.allSettled([
        api.getPlaylists({ timeout: 8000 }),
        api.getFavorites(50, 0, { timeout: 8000 }),
        api.getHistory(50, 0, { timeout: 8000 }),
        api.getLibrary(50, 0, { timeout: 8000 }),
      ])
      if (playlistData.status === 'fulfilled') setPlaylists(playlistData.value.playlists || [])
      if (favoriteData.status === 'fulfilled') setFavorites(favoriteData.value.favorites || [])
      if (historyData.status === 'fulfilled') setHistory(historyData.value.history || [])
      if (libraryData.status === 'fulfilled') setLibrary(libraryData.value.tracks || [])
    } catch {
      // ayrıntılar yukarıda zaten yakalandı
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const createPlaylist = useCallback(async (name, description = '') => {
    const data = await api.createPlaylist({ name, description })
    await refresh()
    return data
  }, [refresh])

  const deletePlaylist = useCallback(async (id) => {
    const data = await api.deletePlaylist(id)
    await refresh()
    return data
  }, [refresh])

  const addToPlaylist = useCallback(async (playlistId, track) => {
    const trackId = typeof track === 'string' ? track : track?.id
    if (!trackId) return
    const data = await api.addTrackToPlaylist(playlistId, trackId)
    await refresh()
    return data
  }, [refresh])

  const removeFromPlaylist = useCallback(async (playlistId, trackId) => {
    const data = await api.removeTrackFromPlaylist(playlistId, trackId)
    await refresh()
    return data
  }, [refresh])

  const toggleFavorite = useCallback(async (track) => {
    const trackId = typeof track === 'string' ? track : track?.id
    if (!trackId) return
    const data = await api.toggleFavorite(track)
    const nowFav = Boolean(readFavoriteState(data))
    setFavorites((current) => {
      if (nowFav) {
        if (current.some((item) => item.id === trackId)) return current
        return [track, ...current]
      }
      return current.filter((item) => item.id !== trackId)
    })
    return { ...data, favorite: nowFav }
  }, [])

  const isFavorite = useCallback((trackId) => favorites.some((item) => item.id === trackId), [favorites])

  const clearHistory = useCallback(async () => {
    try {
      await api.clearHistory()
      setHistory([])
      toast('Çalma geçmişi temizlendi.', 'success')
    } catch (error) {
      toast(`Geçmiş temizlenemedi: ${error.message}`, 'error')
    }
  }, [toast])

  const value = useMemo(
    () => ({
      playlists,
      favorites,
      history,
      library,
      loading,
      refresh,
      createPlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      toggleFavorite,
      isFavorite,
      clearHistory,
    }),
    [playlists, favorites, history, library, loading, refresh, createPlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist, toggleFavorite, isFavorite, clearHistory],
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary() {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('useLibrary must be used inside LibraryProvider')
  return value
}
