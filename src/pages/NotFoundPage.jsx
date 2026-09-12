import { Link } from 'react-router-dom'
import Button from '../components/ui/Button.jsx'

// 404 — Neo-brutalist Bulunamadı Sayfası
export default function NotFoundPage() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '64px 24px',
        margin: '40px auto',
        maxWidth: 500,
        background: '#FFFFFF',
        border: '5px solid #000',
        boxShadow: '10px 10px 0px #000',
      }}
    >
      <span className="eyebrow" style={{ background: 'var(--accent)', fontSize: '0.85rem' }}>404 HATA</span>
      <h1 className="display" style={{ fontSize: 'clamp(3rem, 8vw, 5rem)', margin: '8px 0' }}>KAYBOLDU</h1>
      <p style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 24px', color: 'rgba(0,0,0,0.8)' }}>
        Aradığın sayfa burada yok. Belki de çalma listesi silinmiştir.
      </p>
      <Link to="/">
        <Button variant="primary" size="lg">ANA SAYFAYA DÖN</Button>
      </Link>
    </div>
  )
}