import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from './Button.jsx'
import { canSubmitPlaylistName } from '../../lib/uiState.js'

// Playlist oluşturma / yeniden adlandırma diyaloğu
export default function PlaylistDialog({ open, mode = 'create', initialName = '', initialDescription = '', onClose, onSubmit }) {
  const nameRef = useRef(null)
  const descriptionRef = useRef(null)
  const [name, setName] = useState(initialName)

  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  useEffect(() => {
    if (!open) return undefined
    const timer = setTimeout(() => nameRef.current?.focus(), 30)
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  if (!open) return null

  const submit = (event) => {
    event.preventDefault()
    const cleanName = nameRef.current?.value.trim()
    if (!canSubmitPlaylistName(cleanName)) {
      nameRef.current?.focus()
      return
    }
    onSubmit({ name: cleanName, description: descriptionRef.current?.value.trim() || '' })
  }

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-dialog-title" onSubmit={submit}>
        <h2 className="dialog__title" id="playlist-dialog-title">
          {mode === 'create' ? 'Yeni çalma listesi' : 'Çalma listesini düzenle'}
        </h2>
        <div className="field">
          <label htmlFor="playlist-name">Ad</label>
          <input
            id="playlist-name"
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder="Çalma listesi adı"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="playlist-desc">Açıklama</label>
          <input id="playlist-desc" ref={descriptionRef} defaultValue={initialDescription} maxLength={400} placeholder="Ne içeriyor?" />
        </div>
        <div className="dialog__actions">
          <Button variant="ghost" type="button" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" disabled={!canSubmitPlaylistName(name)}>{mode === 'create' ? 'Oluştur' : 'Kaydet'}</Button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
