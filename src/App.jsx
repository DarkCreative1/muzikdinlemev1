import { Suspense, lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { LibraryProvider } from './context/LibraryContext.jsx'
import { PlayerProvider } from './context/PlayerContext.jsx'
import { UIProvider } from './context/UIContext.jsx'
import AppShell from './components/layout/AppShell.jsx'

// Rota sayfaları — kod bölümleme (lazy)
const HomePage = lazy(() => import('./pages/HomePage.jsx'))
const SearchPage = lazy(() => import('./pages/SearchPage.jsx'))
const LibraryPage = lazy(() => import('./pages/LibraryPage.jsx'))
const PlaylistPage = lazy(() => import('./pages/PlaylistPage.jsx'))
const AlbumPage = lazy(() => import('./pages/AlbumPage.jsx'))
const ArtistPage = lazy(() => import('./pages/ArtistPage.jsx'))
const TrackPage = lazy(() => import('./pages/TrackPage.jsx'))
const AuthPage = lazy(() => import('./pages/AuthPage.jsx'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'))

function RouteFallback() {
  return (
    <div style={{ padding: '80px 24px' }} aria-busy="true">
      <div className="skeleton skeleton--title" style={{ width: 200, height: 24, margin: '0 auto 16px' }} />
      <div className="skeleton skeleton--text" style={{ width: '60%', margin: '0 auto 10px' }} />
      <div className="skeleton skeleton--text" style={{ width: '45%', margin: '0 auto' }} />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <UIProvider>
        <AuthProvider>
          <LibraryProvider>
            <PlayerProvider>
              <BrowserRouter>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route path="/" element={<Suspense fallback={<RouteFallback />}><HomePage /></Suspense>} />
                    <Route path="/search" element={<Suspense fallback={<RouteFallback />}><SearchPage /></Suspense>} />
                    <Route path="/library" element={<Suspense fallback={<RouteFallback />}><LibraryPage /></Suspense>} />
                    <Route path="/playlist/:playlistId" element={<Suspense fallback={<RouteFallback />}><PlaylistPage /></Suspense>} />
                    <Route path="/album/:albumId" element={<Suspense fallback={<RouteFallback />}><AlbumPage /></Suspense>} />
                    <Route path="/artist/:artistId" element={<Suspense fallback={<RouteFallback />}><ArtistPage /></Suspense>} />
                    <Route path="/track/:trackId" element={<Suspense fallback={<RouteFallback />}><TrackPage /></Suspense>} />
                    <Route path="*" element={<Suspense fallback={<RouteFallback />}><NotFoundPage /></Suspense>} />
                  </Route>
                  <Route path="/auth" element={<Suspense fallback={<RouteFallback />}><AuthPage /></Suspense>} />
                </Routes>
              </BrowserRouter>
            </PlayerProvider>
          </LibraryProvider>
        </AuthProvider>
      </UIProvider>
    </ThemeProvider>
  )
}