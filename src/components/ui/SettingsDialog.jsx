import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, Palette, Sparkles, X } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext.jsx'
import Button from './Button.jsx'
import IconButton from './IconButton.jsx'

// Ayarlar ve Tema Seçici Modalı
export default function SettingsDialog({ open, onClose }) {
  const { theme, setTheme, themes } = useTheme()
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        className="dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        style={{ maxWidth: 540 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 'var(--border-sub)', paddingBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="eyebrow" style={{ margin: 0 }}>
              <Palette size={14} strokeWidth={2.5} />
              Ayarlar
            </span>
            <h2 className="dialog__title" id="settings-dialog-title" style={{ border: 'none', padding: 0, margin: 0 }}>
              Tema Seçimi
            </h2>
          </div>
          <IconButton label="Kapat" onClick={onClose} className="icon-btn--sm">
            <X size={18} strokeWidth={2.5} />
          </IconButton>
        </div>

        <p className="dialog__text">
          Arayüz tasarım stilini dilediğiniz gibi özelleştirin. Seçiminiz anında uygulanır ve kaydedilir.
        </p>

        {/* Tema Kartları Listesi */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {themes.map((item) => {
            const isActive = item.id === theme

            return (
              <div
                key={item.id}
                onClick={() => setTheme(item.id)}
                style={{
                  padding: 16,
                  border: isActive ? 'var(--border-main)' : 'var(--border-thin)',
                  borderRadius: 'var(--radius-inner)',
                  background: isActive ? 'var(--surface-active)' : 'var(--surface-raised)',
                  boxShadow: isActive ? 'var(--shadow-card)' : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  transition: 'all 120ms ease-out',
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setTheme(item.id)
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                      {item.name}
                    </strong>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        padding: '2px 8px',
                        border: 'var(--border-thin)',
                        borderRadius: 'var(--radius-pill)',
                        background: 'var(--accent)',
                        color: '#FFFFFF',
                      }}
                    >
                      {item.badge}
                    </span>
                  </div>

                  {isActive && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem', fontWeight: 800, color: 'var(--accent-strong)' }}>
                      <Check size={16} strokeWidth={3} />
                      Aktif
                    </span>
                  )}
                </div>

                <p style={{ fontSize: '0.85rem', margin: 0, opacity: 0.85, lineHeight: 1.4 }}>
                  {item.description}
                </p>

                {/* Renk Paleti Önizleme Noktaları */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  {item.palette.map((color, idx) => (
                    <span
                      key={idx}
                      style={{
                        width: 22,
                        height: 22,
                        background: color,
                        border: 'var(--border-thin)',
                        borderRadius: 'var(--radius-pill)',
                        boxShadow: 'var(--shadow-btn)',
                        display: 'inline-block',
                      }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="dialog__actions" style={{ marginTop: 8 }}>
          <Button variant="primary" onClick={onClose}>
            Tamam
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
