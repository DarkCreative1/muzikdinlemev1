import { cn } from '../../lib/utils.js'

export default function Skeleton({ className, style, ...props }) {
  return <div className={cn('skeleton', className)} style={style} {...props} aria-hidden="true" />
}