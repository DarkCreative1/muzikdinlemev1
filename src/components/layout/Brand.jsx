import { Link } from 'react-router-dom'

// Marka rozeti — Çoklu Temaya Uyumlu Wavebox Logo
export default function Brand({ compact = false }) {
  return (
    <Link to="/" className="sidebar__brand" aria-label="Wavebox ana sayfasına git">
      <span className="sidebar__brand-mark" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M3 12h2.5l2.5-7 3.5 14 3.5-9 2 4.5h4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && (
        <div className="sidebar__brand-text">
          <span className="sidebar__brand-name">Wavebox</span>
          <span className="sidebar__brand-tag">Studio</span>
        </div>
      )}
    </Link>
  )
}