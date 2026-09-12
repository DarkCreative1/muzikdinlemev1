import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatNumber(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return new Intl.NumberFormat('tr-TR').format(Math.round(number))
}

export function pluralize(count, singular, plural) {
  const value = Math.abs(Number(count) || 0)
  return `${formatNumber(value)} ${value === 1 ? singular : plural}`
}