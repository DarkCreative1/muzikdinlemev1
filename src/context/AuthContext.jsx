import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const me = await api.getMe({ timeout: 8000 })
      setUser(me.user || me)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    let alive = true
    api.getMe({ timeout: 8000 })
      .then((me) => { if (alive) setUser(me.user || me) })
      .catch(() => { if (alive) setUser(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password)
    api.setAuthToken(data.token)
    await refresh()
    return data
  }, [refresh])

  const register = useCallback(async (email, password, displayName) => {
    const data = await api.register(email, password, displayName)
    api.setAuthToken(data.token)
    await refresh()
    return data
  }, [refresh])

  const logout = useCallback(async () => {
    try { await api.logout({ timeout: 4000 }) } catch { /* sunucu kapalıyken bile yerel oturum kapanır */ }
    api.clearAuthToken()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}