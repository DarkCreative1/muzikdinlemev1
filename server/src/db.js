import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import { DB_PATH } from './config.js'

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')
db.pragma('temp_store = MEMORY')
db.pragma('mmap_size = 268435456')

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      spotify_id TEXT,
      source TEXT DEFAULT 'unknown',
      source_id TEXT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      duration INTEGER DEFAULT 0,
      cover_url TEXT,
      preview_url TEXT,
      file_path TEXT,
      file_name TEXT,
      file_size INTEGER DEFAULT 0,
      is_downloaded INTEGER DEFAULT 0,
      play_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_played_at TEXT
    );
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, track_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      played_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE(playlist_id, track_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_history_played_at ON history(played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_history_played_id ON history(played_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON playlist_tracks(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_tracks_downloaded_created ON tracks(is_downloaded, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_favorites_created ON favorites(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlists_updated ON playlists(updated_at DESC);
  `)
  const favoriteCols = db.prepare('PRAGMA table_info(favorites)').all().map((c) => c.name)
  if (!favoriteCols.includes('user_id')) {
    // Eski sürümde favori küreseldi ve track_id üzerinde tekil kısıt vardı.
    // Eski satırlar aktif kullanıcıya ait sayılamadığı için ayrı arşivde tutulur;
    // yeni sahiplik tablosuna taşınmaz.
    db.exec(`
      CREATE TABLE IF NOT EXISTS favorites_legacy AS SELECT * FROM favorites;
      DROP TABLE favorites;
      CREATE TABLE favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, track_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
      );
    `)
  }
  const historyCols = db.prepare('PRAGMA table_info(history)').all().map((c) => c.name)
  if (!historyCols.includes('user_id')) db.exec('ALTER TABLE history ADD COLUMN user_id TEXT')
  const playlistColsBefore = db.prepare('PRAGMA table_info(playlists)').all().map((c) => c.name)
  if (!playlistColsBefore.includes('user_id')) db.exec('ALTER TABLE playlists ADD COLUMN user_id TEXT')
const cols = db.prepare('PRAGMA table_info(tracks)').all().map((c) => c.name)
  if (!cols.includes('source')) db.exec("ALTER TABLE tracks ADD COLUMN source TEXT DEFAULT 'unknown'")
  if (!cols.includes('source_id')) db.exec('ALTER TABLE tracks ADD COLUMN source_id TEXT')
  if (!cols.includes('preview_url')) db.exec('ALTER TABLE tracks ADD COLUMN preview_url TEXT')
  const playlistCols = db.prepare('PRAGMA table_info(playlists)').all().map((c) => c.name)
  if (!playlistCols.includes('updated_at')) db.exec('ALTER TABLE playlists ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP')
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_history_user_played ON history(user_id, played_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_playlists_user_updated ON playlists(user_id, updated_at DESC);
  `)
}

const nowIso = () => new Date().toISOString()
const finiteInt = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : fallback

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')
const passwordHash = (password) => {
  const salt = crypto.randomBytes(16).toString('hex')
  const digest = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${digest}`
}
const passwordMatches = (password, stored) => {
  const [, salt, expected] = String(stored || '').split('$')
  if (!salt || !expected) return false
  try {
    const actual = crypto.scryptSync(String(password), salt, 64)
    const target = Buffer.from(expected, 'hex')
    return actual.length === target.length && crypto.timingSafeEqual(actual, target)
  } catch { return false }
}
const publicUser = (user) => user ? { id: user.id, email: user.email, display_name: user.display_name, created_at: user.created_at } : null

export function createUser({ email, password, displayName }) {
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO users(id,email,password_hash,display_name) VALUES(?,?,?,?)').run(id, email.trim().toLowerCase(), passwordHash(password), displayName.trim())
  return publicUser(db.prepare('SELECT id,email,display_name,created_at FROM users WHERE id=?').get(id))
}
export function ensureUserRecord(user) {
  if (!user?.id) return
  const id = String(user.id)
  const email = String(user.email || `external-${id}@local.invalid`).trim().toLowerCase()
  const existingEmail = db.prepare('SELECT id FROM users WHERE email=?').get(email)
  const safeEmail = existingEmail && existingEmail.id !== id ? `external-${id}@local.invalid` : email
  db.prepare(`
    INSERT INTO users(id,email,password_hash,display_name) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name
  `).run(id, safeEmail, `external$${id}`, String(user.display_name || safeEmail.split('@')[0]).slice(0, 120))
}
export const getUserByEmail = (email) => db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').trim().toLowerCase()) || null
export const getUserById = (id) => publicUser(db.prepare('SELECT id,email,display_name,created_at FROM users WHERE id=?').get(id))
export const verifyUser = (email, password) => {
  const user = getUserByEmail(email)
  return user && passwordMatches(password, user.password_hash) ? publicUser(user) : null
}
export function createSession(userId, ttlMs = 30 * 24 * 60 * 60_000) {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token), userId, expiresAt)
  return { token, expires_at: expiresAt }
}
export function getUserBySession(token) {
  if (!token) return null
  const row = db.prepare(`SELECT u.id,u.email,u.display_name,u.created_at,s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(hashToken(token))
  if (!row) return null
  if (Date.parse(row.expires_at) <= Date.now()) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token)); return null }
  return publicUser(row)
}
export const deleteSession = (token) => token ? db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token)).changes > 0 : false

const TRACK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/u
export function createTrackId(trackData) {
  if (trackData.id) {
    const id = String(trackData.id)
    if (!TRACK_ID_RE.test(id)) throw new Error('Parça kimliği biçimi geçersiz')
    return id
  }
  const source = String(trackData.source || 'unknown').trim().toLowerCase()
  const sourceId = String(trackData.source_id || trackData.spotify_id || '').trim()
  const identity = sourceId
    ? `${source}:${sourceId}`
    : `${source}:${String(trackData.artist || '').normalize('NFKC').trim().toLowerCase()}-${String(trackData.title || '').normalize('NFKC').trim().toLowerCase()}-${String(trackData.album || '').normalize('NFKC').trim().toLowerCase()}`
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)
}

export function saveOrUpdateTrack(input) {
  const trackData = { ...input }
  const trackId = createTrackId(trackData)
  trackData.id = trackId
  const title = String(trackData.title || '').trim()
  const artist = String(trackData.artist || '').trim()
  if (!title || !artist) throw new Error('title ve artist gerekli')

  db.prepare(`
    INSERT INTO tracks (
      id, spotify_id, source, source_id, title, artist, album, duration, cover_url, preview_url,
      file_path, file_name, file_size, is_downloaded
    ) VALUES (
      @id, @spotify_id, @source, @source_id, @title, @artist, @album, @duration, @cover_url, @preview_url,
      @file_path, @file_name, @file_size, @is_downloaded
    )
    ON CONFLICT(id) DO UPDATE SET
      spotify_id = COALESCE(excluded.spotify_id, tracks.spotify_id),
      source = CASE WHEN excluded.source <> 'unknown' THEN excluded.source ELSE tracks.source END,
      source_id = COALESCE(excluded.source_id, tracks.source_id),
      title = excluded.title,
      artist = excluded.artist,
      album = CASE WHEN excluded.album <> '' THEN excluded.album ELSE tracks.album END,
      duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE tracks.duration END,
      cover_url = CASE WHEN excluded.cover_url <> '' THEN excluded.cover_url ELSE tracks.cover_url END,
      preview_url = CASE WHEN excluded.preview_url <> '' THEN excluded.preview_url ELSE tracks.preview_url END,
      file_path = CASE WHEN excluded.file_path <> '' THEN excluded.file_path ELSE tracks.file_path END,
      file_name = CASE WHEN excluded.file_name <> '' THEN excluded.file_name ELSE tracks.file_name END,
      file_size = CASE WHEN excluded.file_size > 0 THEN excluded.file_size ELSE tracks.file_size END,
      is_downloaded = CASE WHEN @download_state_supplied = 1 THEN excluded.is_downloaded ELSE tracks.is_downloaded END
  `).run({
    id: trackId,
    spotify_id: trackData.spotify_id ?? null,
    source: String(trackData.source || 'unknown'),
    source_id: trackData.source_id ?? null,
    title,
    artist,
    album: String(trackData.album || ''),
    duration: finiteInt(trackData.duration),
    cover_url: String(trackData.cover_url || ''),
    preview_url: String(trackData.preview_url || ''),
    file_path: String(trackData.file_path || ''),
    file_name: String(trackData.file_name || ''),
    file_size: finiteInt(trackData.file_size),
    is_downloaded: trackData.is_downloaded ? 1 : 0,
    download_state_supplied: Object.hasOwn(trackData, 'is_downloaded') ? 1 : 0,
  })
  return getTrack(trackId)
}

export const getTrack = (trackId) => db.prepare(`
  SELECT t.* FROM tracks t WHERE t.id = ?
`).get(trackId) || null

export function getAllDownloadedTracks({ limit = 500, offset = 0 } = {}) {
  return db.prepare(`
    SELECT t.* FROM tracks t
    WHERE t.is_downloaded = 1
    ORDER BY t.created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ limit: Math.max(1, Math.round(limit)), offset: Math.max(0, Math.round(offset)) })
}
export const getDownloadedTrackCount = () => db.prepare('SELECT COUNT(*) AS count FROM tracks WHERE is_downloaded = 1').get().count
export const markTrackDownloadMissing = (trackId) => db.prepare("UPDATE tracks SET is_downloaded=0,file_path='',file_name='',file_size=0 WHERE id=?").run(trackId)

const recordPlayTx = db.transaction((trackId, userId) => {
  const track = getTrack(trackId)
  if (!track) throw new Error('Parça bulunamadı')
  if (!userId) throw new Error('Kullanıcı gerekli')
  const now = nowIso()
  db.prepare('UPDATE tracks SET play_count = play_count + 1, last_played_at = ? WHERE id = ?').run(now, trackId)
  db.prepare('INSERT INTO history (user_id, track_id, played_at) VALUES (?, ?, ?)').run(userId, trackId, now)
})
export const recordPlay = (trackId, userId) => recordPlayTx(trackId, userId)
export const getHistory = (userId, limit = 50, offset = 0) => db.prepare(`
  SELECT t.*, h.id AS history_id, h.played_at,
    EXISTS(SELECT 1 FROM favorites f WHERE f.track_id = t.id AND f.user_id = h.user_id) AS is_favorite
  FROM history h JOIN tracks t ON h.track_id=t.id
  WHERE h.user_id = ?
  ORDER BY h.played_at DESC, h.id DESC LIMIT ? OFFSET ?
`).all(userId, limit, offset)
export const clearHistory = (userId) => db.prepare('DELETE FROM history WHERE user_id=?').run(userId)

const toggleFavoriteTx = db.transaction((trackId, userId) => {
  if (!getTrack(trackId)) throw new Error('Parça bulunamadı')
  if (!userId) throw new Error('Kullanıcı gerekli')
  const fav = db.prepare('SELECT id FROM favorites WHERE user_id=? AND track_id=?').get(userId, trackId)
  if (fav) { db.prepare('DELETE FROM favorites WHERE user_id=? AND track_id=?').run(userId, trackId); return false }
  db.prepare('INSERT INTO favorites(user_id,track_id) VALUES(?,?)').run(userId, trackId)
  return true
})
export const toggleFavorite = (trackId, userId) => toggleFavoriteTx(trackId, userId)
export const getFavorites = ({ userId, limit = 500, offset = 0 } = {}) => db.prepare(`
  SELECT t.*, f.created_at AS favorited_at, 1 AS is_favorite
  FROM favorites f JOIN tracks t ON f.track_id=t.id
  WHERE f.user_id = @userId
  ORDER BY f.created_at DESC LIMIT @limit OFFSET @offset
`).all({ userId, limit: Math.max(1, Math.round(limit)), offset: Math.max(0, Math.round(offset)) })
export const getFavoriteCount = (userId) => db.prepare('SELECT COUNT(*) AS count FROM favorites WHERE user_id=?').get(userId).count
export const isFavorite = (trackId, userId) => Boolean(db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND track_id=?').get(userId, trackId))

export function listPlaylists(userId) {
  return db.prepare(`SELECT p.*, COUNT(pt.id) AS track_count FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id=p.id WHERE p.user_id=? GROUP BY p.id ORDER BY p.updated_at DESC`).all(userId)
}
export function getPlaylist(id, userId) {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id=? AND user_id=?').get(id, userId)
  if (!playlist) return null
  playlist.tracks = db.prepare(`
    SELECT t.*, EXISTS(SELECT 1 FROM favorites f WHERE f.track_id = t.id AND f.user_id = ?) AS is_favorite
    FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id
    WHERE pt.playlist_id=? ORDER BY pt.position, pt.id
  `).all(userId, id)
  return playlist
}
export const playlistExists = (id, userId) => Boolean(db.prepare('SELECT 1 FROM playlists WHERE id=? AND user_id=?').get(id, userId))
export function createPlaylist({ userId, name, description = '', cover_url = '' }) {
  const id = crypto.randomUUID()
  db.prepare('INSERT INTO playlists(id,user_id,name,description,cover_url) VALUES(?,?,?,?,?)').run(id, userId, name.trim(), description.trim(), cover_url.trim())
  return getPlaylist(id, userId)
}
export function deletePlaylist(id, userId) { return db.prepare('DELETE FROM playlists WHERE id=? AND user_id=?').run(id, userId).changes > 0 }
export function addPlaylistTrack(playlistId, trackId, userId) {
  if (!db.prepare('SELECT 1 FROM playlists WHERE id=? AND user_id=?').get(playlistId, userId)) throw new Error('Çalma listesi bulunamadı')
  if (!getTrack(trackId)) throw new Error('Parça bulunamadı')
  const pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS p FROM playlist_tracks WHERE playlist_id=?').get(playlistId).p
  db.prepare('INSERT OR IGNORE INTO playlist_tracks(playlist_id,track_id,position) VALUES(?,?,?)').run(playlistId, trackId, pos)
  db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(nowIso(), playlistId)
  return getPlaylist(playlistId, userId)
}
export function removePlaylistTrack(playlistId, trackId, userId) {
  if (!db.prepare('SELECT 1 FROM playlists WHERE id=? AND user_id=?').get(playlistId, userId)) throw new Error('Çalma listesi bulunamadı')
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?').run(playlistId, trackId)
  db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(nowIso(), playlistId)
  return getPlaylist(playlistId, userId)
}

export function cleanupOrphans() {
  db.exec(`DELETE FROM favorites WHERE track_id NOT IN (SELECT id FROM tracks); DELETE FROM history WHERE track_id NOT IN (SELECT id FROM tracks); DELETE FROM playlist_tracks WHERE track_id NOT IN (SELECT id FROM tracks) OR playlist_id NOT IN (SELECT id FROM playlists);`)
}

initDb()
cleanupOrphans()
export default db
