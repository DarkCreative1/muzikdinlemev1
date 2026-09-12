import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import Button from '../components/ui/Button.jsx'

// Giriş ve Kayıt Sayfası — Çoklu Temaya Uyumlu Kimlik Doğrulama Penceresi
export default function AuthPage() {
  const { user, loading, login, register, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user && !loading) {
      const from = location.state?.from
      navigate(from && from !== '/auth' ? from : '/', { replace: true })
    }
  }, [user, loading, navigate, location.state])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password)
      } else {
        await register(form.email.trim(), form.password, form.name.trim())
      }
    } catch (err) {
      setError(err.message || 'İşlem gerçekleştirilemedi.')
    } finally {
      setBusy(false)
    }
  }

  const handleFieldChange = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
  }

  const toggleMode = () => {
    setMode((current) => (current === 'login' ? 'register' : 'login'))
    setError('')
  }

  if (loading) {
    return (
      <main className="auth-page" aria-label="Kimlik doğrulama" aria-busy="true">
        <div className="auth-card" aria-busy="true">
          <div className="skeleton skeleton--title" style={{ width: 180, margin: '0 auto 12px' }} />
          <div className="skeleton skeleton--text" style={{ width: '80%', margin: '0 auto 20px' }} />
          <div className="skeleton skeleton--text" style={{ height: 44, marginBottom: 12 }} />
          <div className="skeleton skeleton--text" style={{ height: 44 }} />
        </div>
      </main>
    )
  }

  return (
    <main className="auth-page" aria-labelledby="auth-title">
      <div className="auth-card">
        <div className="auth-card__brand">
          <span className="sidebar__brand-mark" aria-hidden="true" style={{ width: 44, height: 44 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M3 12h2.5l2.5-7 3.5 14 3.5-9 2 4.5h4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="sidebar__brand-name" style={{ fontSize: '1.5rem' }}>Wavebox</span>
        </div>

        <h1 id="auth-title">{mode === 'login' ? 'Tekrar Hoş Geldiniz' : 'Hesap Oluşturun'}</h1>
        <p className="auth-card__sub">
          {mode === 'login'
            ? 'Kişisel müzik arşivinize ve çalma listelerinize erişin.'
            : 'Sınırsız müzik akışı ve çalma listeleri için hemen katılın.'}
        </p>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="auth-name">Görünen Ad</label>
              <input
                id="auth-name"
                value={form.name}
                onChange={handleFieldChange('name')}
                maxLength={60}
                placeholder="Adınız veya kullanıcı adınız"
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="auth-email">E-posta Adresi</label>
            <input
              id="auth-email"
              type="email"
              value={form.email}
              onChange={handleFieldChange('email')}
              placeholder="ornek@eposta.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Şifre</label>
            <input
              id="auth-password"
              type="password"
              value={form.password}
              onChange={handleFieldChange('password')}
              minLength={8}
              placeholder="En az 8 karakter"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          <Button
            type="submit"
            size="lg"
            style={{ width: '100%', marginTop: 8 }}
            disabled={busy}
          >
            {busy ? 'İşleniyor…' : mode === 'login' ? 'Giriş Yap' : 'Hesap Oluştur'}
          </Button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? 'Hesabınız yok mu? ' : 'Zaten bir hesabınız var mı? '}
          <button type="button" onClick={toggleMode}>
            {mode === 'login' ? 'Kayıt Olun' : 'Giriş Yapın'}
          </button>
        </p>

        {user && (
          <p className="auth-switch" style={{ marginTop: 14 }}>
            <strong>{user.display_name}</strong> olarak oturum açık.{' '}
            <button type="button" onClick={() => { void logout() }}>
              Çıkış Yap
            </button>
          </p>
        )}
      </div>
    </main>
  )
}
