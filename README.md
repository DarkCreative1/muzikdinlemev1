# Wavebox — music in motion

Modern, hızlı ve mobil uyumlu müzik keşif + kesintisiz dinleme uygulaması.
React SPA (Vite) + Fastify API + SQLite tek depoda: arama, trendler, çalma listeleri,
favoriler, geçmiş, radyo, şarkı sözleri ve ses akışı/indirimi tek çatı altında.

![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-black?logo=fastify&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003b57?logo=sqlite&logoColor=white)
![Node](https://img.shields.io/badge/Node-20+-339933?logo=node.js&logoColor=white)

> Canlı dil: Türkçe. Varsayılan tema: koyu.

---

## Özellikler

### Frontend (React + Vite + Tailwind)

- **Sayfalar:** Ana Sayfa, Arama, Kitaplık, Playlist / Albüm / Sanatçı / Parça detay, Auth, 404
- **Bento grid + raflar:** selamlama, hızlı erişim kutucukları, trend rafları, son dinlenenler
- **Global player:** kuyruk, karıştır / tekrar, ses, hız, uyku zamanlayıcısı, medya tuşları (MediaSession)
- **Mobil:** alt navigasyon + tam ekran "Şimdi Çalıyor" paneli, `viewport-fit=cover`
- **Kitaplık:** favoriler, çalma listeleri (oluştur / sil / parça ekle-çıkar), dinleme geçmişi
- **Arama:** debounce'lı arama, Spotify linkinden içe aktarma (`/api/spotify-link`)
- **Radyo / öneri:** parça bazlı radyo ve trend akışı
- **Şarkı sözleri:** senkronize-senkronsuz söz desteği
- **Tema:** açık / koyu / sistem, CSS değişkenleri + Tailwind 4
- **Performans:** route bazlı `lazy()` + `Suspense`, skeleton fallback'lar, 20sn API timeout, abort desteği
- **Erişilebilirlik:** `aria-busy`, klavye ile kullanılabilir diyaloglar, odak yönetimi

### Backend (Fastify + SQLite)

- **Kaynak toplama:** Spotify metadata + YouTube / SoundCloud / Deezer çözümleme
- **Akış + indirme:** menzil (Range) destekli `/downloads` servisi, eşzamanlı indirme kuyruğu
- **Kalıcılık:** `better-sqlite3` — parçalar, favoriler, geçmiş, playlist'ler, kullanıcılar, oturumlar
- **Auth:** e-posta + şifre, Bearer token, D1 Worker'a server-side proxy opsiyonu
- **API güvenliği:**
  - Route bazlı rate-limit (auth: 12/dk, pahalı rotalar: 30/dk, upstream: 60/dk, diğer: 180/dk)
  - Sıkı validasyon (`requireText`, ID regex, `maxParamLength: 256`, 1MB body limit)
  - Güvenlik başlıkları: `CSP`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, prod'da `HSTS`
  - Hata gizleme: 5xx detayları istemciye sızdırılmaz, `{ detail, code }` sözleşmesi
- **Metrikler:** rota bazlı `count / errors / avgMs / maxMs` (bellek içi, sınırlı boyut)
- **Önbellek:** arama (60sn) + trend (15dk) TTL, indirme boyutu ve toplam önbellek kotası
- **Statik sunum:** `npm run build` çıktısı (`dist/`) Fastify üzerinden servis edilir, SPA fallback'lı

---

## Teknolojiler

| Katman   | Seçim |
|----------|-------|
| UI       | React 18, React Router 7, Lucide ikonlar |
| Stil     | Tailwind CSS 4 (`@tailwindcss/vite`), `tw-animate-css`, CVA + `clsx` + `tailwind-merge` |
| Font     | Geist / DM Sans / Space Grotesk / Nunito (Fontsource Variable) |
| Build    | Vite 6, `@vitejs/plugin-react`, `@` → `./src` alias |
| Backend  | Fastify 5, `@fastify/cors`, `@fastify/static` |
| Veri     | better-sqlite3 (yerel), Cloudflare D1 proxy (opsiyonel auth) |
| Medya    | youtube-dl-exec, SoundCloud / Deezer servisleri, R2 depolama adaptörü |
| Araçlar  | concurrently, wrangler |

---

## Proje Yapısı

```
.
├── index.html                 # TR locale, theme-color, /src/main.jsx girişi
├── vite.config.js             # @ alias, :5173 dev, /api + /downloads proxy
├── src/
│   ├── main.jsx               # provider + router bootstrap
│   ├── App.jsx                # lazy route'lar + AppShell layout
│   ├── pages/                 # Home, Search, Library, Playlist, Album, Artist, Track, Auth, 404
│   ├── components/
│   │   ├── layout/            # AppShell, Sidebar, Topbar, Brand, MobileNavigation
│   │   ├── music/             # Artwork, MediaCard, MediaShelf, TrackTable, CollectionHero
│   │   ├── player/            # GlobalPlayer, QueueList, NowPlayingPanel, MobileNowPlaying, PulseRail
│   │   └── ui/                # Button, Dialog, ContextMenu, Toasts, Skeleton, StateView...
│   ├── context/               # Theme, Auth, Library, Player, UI
│   ├── store/playerReducer.js # player state makinesi
│   ├── lib/                   # api.js (token + timeout client), catalogSelectors, track, uiState...
│   ├── hooks/                 # useDebouncedSearch, useReveal
│   ├── data/catalog.js        # statik katalog / seed
│   └── styles/index.css       # tema değişkenleri + Tailwind
├── server/
│   ├── src/
│   │   ├── server.js          # Fastify app, rate-limit, CSP, route'lar, metrikler
│   │   ├── config.js          # .env yükleyici, port/host, limitler, dizinler
│   │   ├── db.js              # SQLite şeması + sorgular
│   │   ├── spotifyService.js  # Spotify metadata
│   │   ├── youtubeSearch.js   # YouTube çözümleme
│   │   ├── soundcloudService.js
│   │   ├── deezerService.js + deezerDecrypt.js + deezerBlowfishTables.js
│   │   ├── audioDownloader.js # kuyruk + eşzamanlılık kontrolü
│   │   ├── lyricsService.js
│   │   ├── r2Storage.js       # R2 adaptörü
│   │   └── searchFilters.js
│   └── package.json           # spotify-clone-backend
└── public/favicon.svg
```

---

## Hızlı Başlangıç

### Gereksinimler

- Node.js 20+
- npm 10+
- (Ses indirme için) `ffmpeg` sistemde kurulu olmalı (`ffmpeg -version`)
- (Opsiyonel) Python + `yt-dlp` — `youtube-dl-exec` genelde kendi binary'sini indirir

### Kurulum

```bash
# 1) Bağımlılıklar (root + server)
npm run setup
# eşdeğeri:
# npm install
# npm --prefix server install

# 2) Geliştirme (backend :8001 + frontend :5173 birlikte)
npm run dev

# Tarayıcı:
# http://localhost:5173
# API: http://localhost:8001/api/...
```

Tek tek çalıştırmak istersen:

```bash
npm run server:dev   # backend --watch
npm run web          # vite dev
```

### Üretim

```bash
npm run build        # vite build -> dist/
npm run server       # Fastify, dist/'i de servis eder
# veya ikisi birlikte:
npm start
```

> Backend `dist/assets` varsa statik servis + uzun `Cache-Control` uygular,
> bilinmeyen path'leri SPA `index.html`'e düşürür (`/api/*` hariç 404 JSON döner).

---

## Ortam Değişkenleri

`server/.env` dosyası otomatik okunur (yoksa sessiz geçilir, mevcut env ezilmez).

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `PORT` | `8001` | Backend portu (Vite proxy de bunu kullanır) |
| `HOST` | `::` | Dinleme adresi (sadece IPv4: `127.0.0.1`, sadece IPv6 loopback: `::1`) |
| `DB_PATH` | `server/spotify_data.db` | SQLite dosya yolu |
| `DOWNLOADS_DIR` | `server/downloads` | Ses önbellek dizini |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173,http://[::1]:5173` | İzinli origin'ler (virgüllü) |
| `MAX_LIBRARY_LIMIT` | `500` | Kitaplık üst sınırı |
| `MAX_CONCURRENT_DOWNLOADS` | `3` | Eşzamanlı indirme |
| `MAX_PENDING_DOWNLOADS` | `max(20, eşzamanlı×20)` en fazla 1000 | Kuyruk üst sınırı |
| `MAX_DOWNLOAD_BYTES` | `100MB` | Tek dosya üst sınırı |
| `MAX_CACHE_BYTES` | `2GB` | Toplam önbellek kotası |
| `SEARCH_CACHE_TTL_MS` | `60000` | Arama önbellek TTL |
| `TRENDING_CACHE_TTL_MS` | `900000` | Trend önbellek TTL |
| `SC_CLIENT_ID` / `SC_COOKIE` / `SC_COOKIES_FILE` | — | SoundCloud erişim bilgileri |
| `DEEZER_ARL` / `DEEZER_ARL_FILE` | — | Deezer ARL (dosya: `server/deezer-arl.txt`) |
| `D1_AUTH_API_URL` + `D1_AUTH_PROXY_KEY` | — | Açık olunca auth D1 Worker'a proxy'lenir |
| `NODE_ENV=production` | — | HTTPS'te `HSTS` başlığı eklenir |

Örnek `server/.env`:

```env
PORT=8001
HOST=::
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
MAX_CONCURRENT_DOWNLOADS=3
# SC_CLIENT_ID=...
# DEEZER_ARL=...
```

---

## API Özeti

Tüm yanıtlar JSON. Hata formu: `{ "detail": "...", "code": "..." }`.

| Metod | Yol | Açıklama |
|-------|-----|----------|
| GET | `/api/search?q=&limit=` | Birleşik arama (Spotify + çözümleme) |
| GET | `/api/trending?limit=` | Trend parçalar + öne çıkan listeler |
| GET | `/api/track/:id` | Parça detayı |
| GET | `/api/spotify-link?url=` | Spotify URL'den parça çöz |
| GET/POST | `/api/resolve`, `/api/download`, `/api/stream` | Akış URL'si üret / indir / proxy'le |
| GET | `/api/radio?trackId=` | Parça bazlı radyo |
| GET | `/api/lyrics?trackId=` | Şarkı sözleri |
| POST | `/api/auth/register`, `/api/auth/login` | Kayıt / giriş (12/dk limit) |
| GET/POST | `/api/auth/me`, `/api/auth/logout` | Oturum |
| GET/POST/DELETE | `/api/playlists`, `/api/playlists/:id` | Playlist CRUD + parça ekle/çıkar |
| GET/POST/DELETE | `/api/favorites` | Favoriler |
| GET/POST/DELETE | `/api/history` | Dinleme geçmişi |
| GET | `/api/metrics` | Rota metrikleri (sınırlı) |
| GET | `/api/dokuman` | (Tarayıcıda açılırsa SPA'ya düşer) |

Frontend istemcisi (`src/lib/api.js`): Bearer token (`localStorage: wavebox-auth-token`),
20sn timeout, `AbortSignal` desteği, `ApiError(message, status, code)`.

Auth başlığı:

```
Authorization: Bearer <token>
```

---

## Script'ler

```bash
# --- root ---
npm run dev        # backend + frontend birlikte (concurrently)
npm run start      # prod: node server + vite
npm run web        # sadece vite dev (:5173)
npm run build      # vite build -> dist/
npm run preview    # build önizleme (:4173)
npm run setup      # root + server install

npm run server     # node server/src/server.js (:8001)
npm run server:dev # node --watch server/src/server.js

# --- testler ---
npm test                    # tamamı: kaynak + player + radyo + arama + katalog + frontend + regresyon + build + api + güvenlik
npm run test:source
npm run test:player
npm run test:radio
npm run test:radio-auth
npm run test:search-quality
npm run test:catalog
npm run test:frontend
npm run test:regressions
npm run test:ui
npm run test:matching
npm run test:api
npm run test:security
npm run test:security-queue

# --- Cloudflare D1 (opsiyonel) ---
npm run d1:dev
npm run d1:deploy
npm run d1:migrate:local
npm run d1:migrate:remote
```

---

## Güvenlik Notları

- `server/*.db*`, `server/downloads/`, `*.mp3/mp4`, `.env` **repoya girmez** (`.gitignore`).
- `DEEZER_ARL`, `SC_COOKIE`, `D1_AUTH_PROXY_KEY` gibi sırları asla commitleme.
- Rate-limit + CSP + validasyon varsayılan açık; ters proxy arkasında çalışıyorsan
  `trustProxy` / `X-Forwarded-For` ayarını Fastify'da doğrulamadan prod'a alma.
- `/downloads` dizini herkese açık statik değildir; menzil istekleri backend üzerinden akar.

---

## Dağıtım (VPS)

```bash
# 1) Kodu al
git clone https://github.com/DarkCreative1/muzikdinlemev1.git
cd muzikdinlemev1

# 2) Kur + build
npm run setup
npm run build

# 3) Env
cp server/.env.example server/.env  # varsa, yoksa elle oluştur
# PORT, CORS_ORIGINS (gerçek domain), HOST=127.0.0.1 + nginx önerilir

# 4) Çalıştır (örnek: pm2)
pm2 start server/src/server.js --name wavebox --update-env
# nginx: / -> 127.0.0.1:8001 (Fastify dist/'i kendisi servis eder)
```

Nginx arkasında `CORS_ORIGINS`'e gerçek domainini eklemeyi unutma.

---

## Yol Haritası

- [ ] Çevrimdışı mod (Service Worker + önbelleğe alınmış ses)
- [ ] Gerçek zamanlı senkron söz kaydırma
- [ ] Paylaşılabilir playlist linkleri
- [ ] Masaüstü kısayolları + mini player
- [ ] D1 tam migrasyonu + R2 imzalı URL akışı

---

## Katkı

1. Fork'la, `feat/<konu>` dalı aç.
2. `npm run dev` ile doğrula, ilgili `npm run test:*` testini çalıştır.
3. PR aç — neyi, neden değiştirdiğini kısaca yaz, ekran görüntüsü ekle (UI ise).

## Lisans

Bu proje özel / tüm hakları saklıdır. İzinsiz kopyalama, dağıtım veya ticari kullanım yasaktır.
Kullanım izni için repo sahibiyle iletişime geçin.
