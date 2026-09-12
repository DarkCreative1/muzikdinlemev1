import { cn } from '../../lib/utils.js'

export default function IconButton({ label, active = false, className, children, type = 'button', ...props }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn('icon-btn', active && 'is-active', className)}
      {...props}
    >
      {children}
    </button>
  )
}