import { AlertTriangle, Music2, SearchX, WifiOff } from 'lucide-react'
import Button from './Button.jsx'

const icons = {
  empty: <Music2 size={34} strokeWidth={2.5} />,
  search: <SearchX size={34} strokeWidth={2.5} />,
  error: <WifiOff size={34} strokeWidth={2.5} />,
  alert: <AlertTriangle size={34} strokeWidth={2.5} />,
}

// Yükleme / Boş / Hata / Arama Durumları için Temaya Uyumlu Durum Görünümü
export default function StateView({
  kind = 'empty',
  title,
  text,
  actionLabel,
  onAction,
  children,
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '48px 24px',
        maxWidth: 520,
        margin: '24px auto',
        background: 'var(--surface)',
        border: 'var(--border-main)',
        borderRadius: 'var(--radius-main)',
        boxShadow: 'var(--shadow-main)',
      }}
      role="status"
    >
      <div
        style={{
          width: 68,
          height: 68,
          background: kind === 'error' ? 'var(--danger-soft)' : 'var(--secondary)',
          border: 'var(--border-sub)',
          borderRadius: 'var(--radius-inner)',
          boxShadow: 'var(--shadow-btn)',
          display: 'grid',
          placeItems: 'center',
          color: kind === 'error' ? 'var(--danger)' : 'var(--text-primary)',
          marginBottom: 18,
        }}
        aria-hidden="true"
      >
        {icons[kind] || icons.empty}
      </div>

      <h3 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 8px', color: 'var(--text-primary)' }}>
        {title}
      </h3>

      {text && (
        <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.5 }}>
          {text}
        </p>
      )}

      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}

      {children}
    </div>
  )
}