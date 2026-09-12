// Ses/kaydırma çubuğu — CSS değişkeniyle progress dolgusu
export default function RangeSlider({ value, min = 0, max = 1, step = 0.01, label, onChange, onCommit, disabled = false }) {
  const safeMax = Math.max(min + step, Number(max) || 1)
  const safeValue = Math.min(safeMax, Math.max(min, Number(value) || 0))
  const percent = safeMax > min ? ((safeValue - min) / (safeMax - min)) * 100 : 0
  return (
    <input
      className="range-slider"
      style={{ '--range-progress': `${percent}%` }}
      type="range"
      min={min}
      max={safeMax}
      step={step}
      value={safeValue}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange?.(Number(event.target.value))}
      onPointerUp={(event) => onCommit?.(Number(event.currentTarget.value))}
      onKeyUp={(event) => onCommit?.(Number(event.currentTarget.value))}
    />
  )
}