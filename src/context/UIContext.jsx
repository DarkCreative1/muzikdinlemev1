import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { shouldToggleMenu } from '../lib/menuState.js'

const UIContext = createContext(null)
let nextToastId = 0

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [menu, setMenu] = useState(null)
  const [authPromptOpen, setAuthPromptOpen] = useState(false)
  const timers = useRef(new Map())

  const toast = useCallback((message, kind = 'info') => {
    const text = String(message || '').trim()
    if (!text) return
    const id = ++nextToastId
    setToasts((current) =>
      current.some((item) => item.message === text)
        ? current
        : [...current.slice(-3), { id, message: text, kind }],
    )
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id))
      timers.current.delete(id)
    }, 3500)
    timers.current.set(id, timer)
  }, [])

  // Unmount'ta o ana dek birikmiş TÜM zamanlayıcılar temizlenir
  // (önceki sürüm mount anındaki boş listeyi yakalıyordu).
  useEffect(() => () => {
    timers.current.forEach((timer) => clearTimeout(timer))
    timers.current.clear()
  }, [])

  const openMenu = useCallback((x, y, items, trigger) => {
    const nextTrigger = trigger || document.activeElement
    setMenu((current) => {
      if (shouldToggleMenu(current?.trigger, nextTrigger)) {
        queueMicrotask(() => nextTrigger?.focus?.())
        return null
      }
      return { x, y, items, trigger: nextTrigger }
    })
  }, [])

  const closeMenu = useCallback(() => {
    setMenu((current) => {
      queueMicrotask(() => current?.trigger?.focus?.())
      return null
    })
  }, [])

  const openAuthPrompt = useCallback(() => setAuthPromptOpen(true), [])
  const closeAuthPrompt = useCallback(() => setAuthPromptOpen(false), [])

  const value = useMemo(
    () => ({ toasts, toast, menu, openMenu, closeMenu, authPromptOpen, openAuthPrompt, closeAuthPrompt }),
    [toasts, toast, menu, openMenu, closeMenu, authPromptOpen, openAuthPrompt, closeAuthPrompt],
  )

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}

export function useUI() {
  const value = useContext(UIContext)
  if (!value) throw new Error('useUI must be used inside UIProvider')
  return value
}
