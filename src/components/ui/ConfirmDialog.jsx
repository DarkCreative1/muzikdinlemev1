import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Button from './Button.jsx'

// Onay diyaloğu — tehlikeli işlemler (playlist silme vb.) için
export default function ConfirmDialog({ open, title, text, confirmLabel = 'Onayla', cancelLabel = 'Vazgeç', danger = false, onConfirm, onCancel }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const target = dialogRef.current?.querySelector('[data-autofocus]')
    if (target) target.focus()
    else dialogRef.current?.querySelector('.dialog__actions button')?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel?.() }}>
      <div className="dialog" ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 className="dialog__title" id="confirm-title">{title}</h2>
        {text && <p className="dialog__text">{text}</p>}
        <div className="dialog__actions">
          <Button variant="ghost" onClick={onCancel} data-autofocus>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}