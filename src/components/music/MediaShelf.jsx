import MediaCard from './MediaCard.jsx'
import { useReveal } from '../../hooks/useReveal.js'
import { mediaKey } from '../../lib/mediaKey.js'

// Medya Rafı — Neo-brutalist Izgara ve Yatay Kaydırma
export default function MediaShelf({
  title,
  subtitle,
  items = [],
  type = 'track',
  to,
  tracks,
  contextName,
  contextId,
  horizontal = false,
  skeleton = false,
}) {
  const { ref, visible } = useReveal()

  if (skeleton) {
    return (
      <section className="shelf" aria-busy="true">
        <div className="shelf__header">
          <h2 className="section-title">{title}</h2>
        </div>
        <div className={horizontal ? 'shelf__row' : 'shelf__grid'}>
          {Array.from({ length: horizontal ? 8 : 6 }).map((_, index) => (
            <div key={index} className="media-card" aria-hidden="true">
              <div className="media-card__link">
                <span className="media-card__art-shell">
                  <div className="skeleton skeleton--square" />
                </span>
                <div className="skeleton skeleton--title" style={{ width: '80%', marginBottom: 6 }} />
                <div className="skeleton skeleton--text" style={{ width: '50%' }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (!items?.length) return null

  return (
    <section className="shelf" ref={ref}>
      <div className="shelf__header">
        <div>
          <h2 className="section-title">{title}</h2>
          {subtitle && <p style={{ fontSize: '0.88rem', fontWeight: 700, color: 'rgba(0,0,0,0.7)', margin: '4px 0 0' }}>{subtitle}</p>}
        </div>
      </div>

      <div
        className={horizontal ? 'shelf__row' : 'shelf__grid'}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(8px)',
          transition: 'all 180ms ease-out',
        }}
      >
        {items.map((item, index) => (
          <MediaCard
            key={mediaKey(item, type, index)}
            item={item}
            type={type}
            to={to?.(item) || (type === 'artist'
              ? `/artist/${encodeURIComponent(item.name || '')}`
              : `/album/${encodeURIComponent(item.album || item.title || '')}?artist=${encodeURIComponent(item.artist || '')}`)}
            tracks={tracks?.(item)}
            index={index}
            contextName={contextName || title}
            contextId={contextId || `shelf-${title}`}
          />
        ))}
      </div>
    </section>
  )
}
