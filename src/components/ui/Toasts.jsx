import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useUI } from '../../context/UIContext.jsx'

const icons = {
  success: <CheckCircle2 size={19} strokeWidth={3} style={{ color: '#000000', flexShrink: 0 }} />,
  error: <AlertTriangle size={19} strokeWidth={3} style={{ color: '#000000', flexShrink: 0 }} />,
  info: <Info size={19} strokeWidth={3} style={{ color: '#000000', flexShrink: 0 }} />,
}

export default function Toasts() {
  const { toasts } = useUI()
  if (!toasts.length) return null
  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          {icons[toast.kind] || icons.info}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}