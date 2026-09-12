import { useState } from 'react'
import { Music2 } from 'lucide-react'
import { gradient } from '../../data/catalog.js'

// Kapak görseli — Neo-brutalist Keskin Çerçeveli Kapak & Pop-Art Fallback
export default function Artwork({ src, alt = '', seed, shape = 'square', loading = 'lazy', className, style, ...props }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const showImage = Boolean(src && !failed)
  const background = showImage ? undefined : gradient(seed ?? alt ?? 'wavebox')

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background,
        borderRadius: shape === 'circle' ? '50%' : '0px',
        display: 'grid',
        placeItems: 'center',
        ...style,
      }}
      className={className}
      {...props}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 150ms ease-out',
          }}
        />
      ) : (
        <div
          role="img"
          aria-label={alt || 'Albüm kapağı'}
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            color: '#000000',
            fontWeight: 900,
          }}
        >
          <Music2 size="40%" strokeWidth={2.5} />
        </div>
      )}
    </div>
  )
}
