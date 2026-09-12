import { useRef, useState } from 'react'
import { usePlayer } from '../../context/PlayerContext.jsx'
import { formatTime } from '../../data/catalog.js'

// Spotify Stili Akıcı İlerleme Çubuğu (Timeline Slider)
export default function PulseRail({ disabled = false }) {
  const player = usePlayer()
  const trackRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState(false)
  const dragValueRef = useRef(null)

  const duration = Math.max(0, Number(player.duration) || 0)
  const progress = dragging && dragValueRef.current != null ? dragValueRef.current : (player.progress || 0)
  const playedFraction = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0

  if (disabled || !player.current) return null

  const pointerToValue = (event) => {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    return fraction * duration
  }

  const onPointerDown = (event) => {
    if (!duration) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
    const val = pointerToValue(event)
    dragValueRef.current = val
  }

  const onPointerMove = (event) => {
    if (!dragging) return
    dragValueRef.current = pointerToValue(event)
  }

  const onPointerUp = (event) => {
    if (!dragging) return
    const value = pointerToValue(event)
    setDragging(false)
    dragValueRef.current = null
    player.seek(value)
  }

  return (
    <div
      className={`pulse-rail ${dragging ? 'is-dragging' : ''} ${hovered ? 'is-hovered' : ''}`}
      role="slider"
      aria-label="Parça ilerleme çubuğu"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(progress)}
      aria-valuetext={`${formatTime(progress)} / ${formatTime(duration)}`}
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(event) => {
        if (!duration) return
        if (event.key === 'ArrowRight') player.seek(Math.min(duration, progress + Math.max(5, duration / 20)))
        if (event.key === 'ArrowLeft') player.seek(Math.max(0, progress - Math.max(5, duration / 20)))
      }}
    >
      {/* Başlangıç / Geçen Süre */}
      <span className="pulse-rail__time">
        {formatTime(progress)}
      </span>

      {/* Spotify Stili Slider Rayı */}
      <div
        ref={trackRef}
        className="pulse-rail__track-area"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragging(false)}
      >
        <div className="pulse-rail__track-bg">
          {/* İlerleme Dolgusu */}
          <div
            className="pulse-rail__fill"
            style={{ width: `${playedFraction * 100}%` }}
          />

          {/* Sürükleme Tutamacı (Thumb) */}
          <div
            className="pulse-rail__thumb"
            style={{ left: `${playedFraction * 100}%` }}
          />
        </div>
      </div>

      {/* Toplam Süre */}
      <span className="pulse-rail__time pulse-rail__time--end">
        {formatTime(duration)}
      </span>
    </div>
  )
}