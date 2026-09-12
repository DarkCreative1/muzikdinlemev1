import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext.jsx'
import { useUI } from '../../context/UIContext.jsx'
import Button from './Button.jsx'

const MESSAGE = 'Bu özelliği kullanabilmeniz için giriş yapmanız gerekmektedir.'

export default function AuthRequiredDialog() {
  const { authPromptOpen, closeAuthPrompt } = useUI()
  const { theme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!authPromptOpen) return undefined
    dialogRef.current?.querySelector('[data-autofocus]')?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') closeAuthPrompt()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [authPromptOpen, closeAuthPrompt])

  if (!authPromptOpen) return null

  const goToLogin = () => {
    closeAuthPrompt()
    navigate('/auth', { state: { from: location.pathname } })
  }

  return (
    <div
      className={`dialog-backdrop auth-required-backdrop auth-required-backdrop--${theme}`}
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) closeAuthPrompt() }}
    >
      <div
        className="dialog auth-required-dialog"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="auth-required-title"
      >
        <h2 className="dialog__title" id="auth-required-title">Kişisel Radyo</h2>
        <p className="dialog__text">{MESSAGE}</p>
        <div className="dialog__actions">
          <Button variant="ghost" onClick={closeAuthPrompt} data-autofocus>Tamam</Button>
          <Button variant="primary" onClick={goToLogin}>Giriş Yap</Button>
        </div>
      </div>
    </div>
  )
}
