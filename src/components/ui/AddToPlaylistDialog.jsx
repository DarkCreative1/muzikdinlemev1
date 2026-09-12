import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListPlus } from 'lucide-react'
import { useLibrary } from '../../context/LibraryContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import Button from './Button.jsx'

// Parçayı çalma listesine ekleme diyaloğu
export default function AddToPlaylistDialog({ open, track, onClose }) {
  const { playlists, addToPlaylist, createPlaylist } = useLibrary()
  const { toast } = useUI()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    setName('')
    const timer = setTimeout(() => inputRef.current?.focus(), 30)
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  if (!open || !track) return null

  const add = async (playlistId, playlistName) => {
    setBusy(true)
    try {
      await addToPlaylist(playlistId, track)
      toast(`"${track.title}" → ${playlistName} eklendi`, 'success')
      onClose()
    } catch (error) {
      toast(`Eklenemedi: ${error.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const createAndAdd = async (event) => {
    event.preventDefault()
    const clean = name.trim()
    if (!clean) return
    setBusy(true)
    try {
      const created = await createPlaylist(clean)
      const id = created.playlist?.id || created.id
      if (id) await addToPlaylist(id, track)
      toast(`"${track.title}" → ${clean} eklendi`, 'success')
      onClose()
    } catch (error) {
      toast(`Oluşturulamadı: ${error.message}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-dialog-title">
        <h2 className="dialog__title" id="add-dialog-title">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ListPlus size={18} style={{ color: 'var(--accent)' }} />
            Çalma listesine ekle
          </span>
        </h2>
        <p className="dialog__text" style={{ marginBottom: 14 }}>"{track.title}" — {track.artist}</p>

        {playlists.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto', marginBottom: 16 }}>
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                className="context-menu__item"
                disabled={busy}
                onClick={() => add(playlist.id, playlist.name)}
              >
                {playlist.name}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={createAndAdd}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="new-playlist-name">Yeni liste oluştur</label>
            <input
              id="new-playlist-name"
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder="Liste adı yaz…"
            />
          </div>
          <div className="dialog__actions">
            <Button variant="ghost" type="button" onClick={onClose}>Kapat</Button>
            <Button type="submit" disabled={busy || !name.trim()}>Oluştur ve ekle</Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}