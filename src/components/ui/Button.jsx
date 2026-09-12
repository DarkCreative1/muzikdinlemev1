import { cn } from '../../lib/utils.js'

const variants = {
  primary: 'btn--primary',
  ghost: 'btn--ghost',
  soft: 'btn--soft',
  danger: 'btn--danger',
}

const sizes = {
  sm: 'btn--sm',
  md: '',
  lg: 'btn--lg',
}

export default function Button({ variant = 'primary', size = 'md', icon, className, children, type = 'button', ...props }) {
  return (
    <button type={type} className={cn('btn', variants[variant], sizes[size], className)} {...props}>
      {icon && <span className="btn__icon" aria-hidden="true">{icon}</span>}
      {children}
    </button>
  )
}