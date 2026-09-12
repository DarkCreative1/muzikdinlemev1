import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Minimal .env yükleyici (dotenv bağımlılığı yok). Dosya yoksa sessizce geçer;
// zaten set edilmiş ortam değişkenleri asla ezilmez (test ortamı için kritik).
try {
  const envPath = path.join(__dirname, '..', '.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
      if (m && !m[1].startsWith('#') && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  }
} catch {}

export const SERVER_DIR = path.resolve(__dirname, '..')
export const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(SERVER_DIR, 'spotify_data.db')
export const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR
  ? path.resolve(process.env.DOWNLOADS_DIR)
  : path.join(SERVER_DIR, 'downloads')
export const FRONTEND_DIST = path.resolve(SERVER_DIR, '..', 'dist')
// 8000 bazı yerel geliştirme araçları tarafından sık kullanılıyor; uygulama
// varsayılan olarak ayrı bir portta açılır. PORT ile canlı ortamda değiştirilebilir.
export const PORT = (() => {
  const raw = String(process.env.PORT || '8001').trim()
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`[config] Geçersiz PORT="${raw}". 1-65535 arasında tam sayı olmalı.`)
    process.exit(1)
  }
  return n
})()
// Ağ arayüzlerine istemeden açılmamak yerine IPv6 dahil tüm arayüzlerde
// dinlemek için '::' varsayılandır (dual-stack: IPv4 + IPv6).
// Sadece IPv4 loopback istenirse HOST=127.0.0.1, sadece IPv6 loopback için HOST=::1 verin.
export const HOST = process.env.HOST || '::'
export const MAX_SEARCH_LIMIT = 50
export const MAX_HISTORY_LIMIT = 100
export const MAX_LIBRARY_LIMIT = Number.parseInt(process.env.MAX_LIBRARY_LIMIT || '500', 10)
export const MAX_CONCURRENT_DOWNLOADS = Number.parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '3', 10)
const parsedPendingDownloads = Number.parseInt(process.env.MAX_PENDING_DOWNLOADS || '', 10)
export const MAX_PENDING_DOWNLOADS = Number.isFinite(parsedPendingDownloads)
  ? Math.min(Math.max(parsedPendingDownloads, 1), 1000)
  : Math.min(Math.max(20, MAX_CONCURRENT_DOWNLOADS * 20), 1000)
export const SEARCH_CACHE_TTL_MS = Number.parseInt(process.env.SEARCH_CACHE_TTL_MS || String(60 * 1000), 10)
export const TRENDING_CACHE_TTL_MS = Number.parseInt(process.env.TRENDING_CACHE_TTL_MS || String(15 * 60 * 1000), 10)
export const MAX_DOWNLOAD_BYTES = Number.parseInt(process.env.MAX_DOWNLOAD_BYTES || String(100 * 1024 * 1024), 10)
export const MAX_CACHE_BYTES = Number.parseInt(process.env.MAX_CACHE_BYTES || String(2 * 1024 * 1024 * 1024), 10)
export const SOUNDCLOUD_CLIENT_ID = process.env.SC_CLIENT_ID || ''
export const SOUNDCLOUD_COOKIE = process.env.SC_COOKIE || ''
const DEFAULT_SC_COOKIES_FILE = path.join(SERVER_DIR, 'soundcloud-cookies.txt')
export const SOUNDCLOUD_COOKIES_FILE = SOUNDCLOUD_COOKIE
  ? ''
  : (process.env.SC_COOKIES_FILE
      ? path.resolve(process.env.SC_COOKIES_FILE)
      : (fs.existsSync(DEFAULT_SC_COOKIES_FILE) ? DEFAULT_SC_COOKIES_FILE : ''))
export const DEEZER_ARL = process.env.DEEZER_ARL || ''
const DEFAULT_DZ_ARL_FILE = path.join(SERVER_DIR, 'deezer-arl.txt')
export const DEEZER_ARL_FILE = DEEZER_ARL
  ? ''
  : (process.env.DEEZER_ARL_FILE
      ? path.resolve(process.env.DEEZER_ARL_FILE)
      : (fs.existsSync(DEFAULT_DZ_ARL_FILE) ? DEFAULT_DZ_ARL_FILE : ''))

// ---- YouTube bot-engeli aşımı ----// 1) YT_COOKIES_B64: gerçek bir YouTube oturumunun cookies.txt içeriği (base64).
//    Girişli oturum veri merkezi IP'sinde çok daha az engellenir.
// 2) YT_COOKIES_FILE: aynı dosyanın yolu (yerelde dosya ile çalışırken).
// 3) YT_PROXY: konut/"residential" proxy URL'si (örn. http://user:pass@host:port).
//    IP veri merkezi değilse bot kontrolü çoğunlukla kalkar.
function materializeYtCookies() {
  try {
    if (process.env.YT_COOKIES_FILE) {
      const p = path.resolve(process.env.YT_COOKIES_FILE)
      if (fs.existsSync(p)) return p
    }
    const b64 = String(process.env.YT_COOKIES_B64 || '').trim()
    if (!b64) {
      const def = path.join(SERVER_DIR, 'youtube-cookies.txt')
      return fs.existsSync(def) ? def : ''
    }
    const text = Buffer.from(b64, 'base64').toString('utf8')
    if (!text.includes('# Netscape HTTP Cookie File') && !text.includes('.youtube.com')) return ''
    const target = path.join(SERVER_DIR, '.yt-cookies.txt')
    fs.writeFileSync(target, text, { mode: 0o600 })
    return target
  } catch {
    return ''
  }
}
export const YT_COOKIES_PATH = materializeYtCookies()
export const YT_PROXY = String(process.env.YT_PROXY || '').trim()
// Piped (üçüncü parti YouTube API'si): hesap/çerez gerektirmez, son çare kaynağı.
// Public instance'lar genelde ölü olduğu için varsayılan KAPALIDIR; kendi
// Piped sunucunuz varsa URL'yi verin (örn. https://pipedapi.siz.in). Boş = kapalı.
export const PIPED_API_URL = String(process.env.PIPED_API_URL || '').replace(/\/+$/u, '')

try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })
} catch (error) {
  console.error(`[config] Veri dizinleri oluşturulamadı: ${error?.message || error}`)
  console.error(`[config] DB_PATH=${DB_PATH} DOWNLOADS_DIR=${DOWNLOADS_DIR} — yazma iznini ve yolu kontrol edin.`)
  process.exit(1)
}
