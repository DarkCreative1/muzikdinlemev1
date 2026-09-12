import { useEffect, useRef, useState } from 'react'

// Debounce'lu arama — 300ms gecikme, ilk değer için geçiş yok
export function useDebouncedSearch(query, delay = 300) {
  const [debounced, setDebounced] = useState(query)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      setDebounced(query)
      return undefined
    }
    const timer = setTimeout(() => setDebounced(query), delay)
    return () => clearTimeout(timer)
  }, [query, delay])
  return debounced
}