import { createContext, useContext, useEffect, useState } from 'react'

export const AVAILABLE_THEMES = [
  {
    id: 'neo-brutalism',
    name: 'Neo-Brutalism',
    badge: 'Punk & Pop Art (Light)',
    description: 'Yüksek doygunluklu renkler, kalın 4px siyah konturlar, 0px keskin köşeler ve sert blok gölgeler.',
    palette: ['#FF6B6B', '#FFD93D', '#C4B5FD', '#FFFDF5', '#000000'],
    colorScheme: 'light',
  },
  {
    id: 'claymorphism',
    name: 'Digital Clay',
    badge: '3D Soft Clay (Light)',
    description: 'Yumuşak marshmallow hacmi, 4 katmanlı 3D gölge derinliği, organik kavisler ve şeker renkleri.',
    palette: ['#7C3AED', '#DB2777', '#0EA5E9', '#F4F1FA', '#332F3A'],
    colorScheme: 'light',
  },
  {
    id: 'obsidian',
    name: 'Obsidian Studio',
    badge: 'Dark OLED (Dark)',
    description: 'Saf OLED siyahı, çift çerçeveli konsantrik radius, yumuşak ışımalar ve elektrikli nane yeşili.',
    palette: ['#4DE8D6', '#8B6CFF', '#121420', '#050508', '#FFFFFF'],
    colorScheme: 'dark',
  },
  {
    id: 'kinetic-typography',
    name: 'Kinetic Typography',
    badge: 'Acid Brutalism (Dark)',
    description: 'Rich black zemin, neon acid yellow patlaması, 0px keskin brutalist geometri ve flat zarafet.',
    palette: ['#DFE104', '#09090B', '#FAFAFA', '#3F3F46', '#A1A1AA'],
    colorScheme: 'dark',
  },
]

const STORAGE_KEY = 'wavebox_theme'
const DEFAULT_THEME = 'neo-brutalism'

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  themes: AVAILABLE_THEMES,
  currentThemeMeta: AVAILABLE_THEMES[0],
})

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored && AVAILABLE_THEMES.some((t) => t.id === stored)) {
        return stored
      }
    } catch {
      // ignore localStorage errors
    }
    return DEFAULT_THEME
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // ignore
    }
  }, [theme])

  const setTheme = (themeId) => {
    if (AVAILABLE_THEMES.some((t) => t.id === themeId)) {
      setThemeState(themeId)
    }
  }

  const currentThemeMeta = AVAILABLE_THEMES.find((t) => t.id === theme) || AVAILABLE_THEMES[0]

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: AVAILABLE_THEMES, currentThemeMeta }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
