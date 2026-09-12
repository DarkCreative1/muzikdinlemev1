import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const R2_MAX_STORAGE_BYTES = 8 * 1024 * 1024 * 1024
const R2_MAX_CLASS_A = 800_000

const enabled = () => process.env.R2_ENABLED === 'true' && Boolean(process.env.R2_WORKER_URL && process.env.R2_PROXY_KEY)
const TRACK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/u
const keyFor = (trackId, ext = 'mp3') => {
  const id = String(trackId || '')
  if (!TRACK_ID_RE.test(id) || !/^[a-z0-9]{1,8}$/iu.test(String(ext))) throw new Error('Geçersiz R2 medya anahtarı.')
  return `audio/${id}.${String(ext).toLowerCase()}`
}
const statePath = () => process.env.R2_USAGE_FILE
  ? path.resolve(process.env.R2_USAGE_FILE)
  : path.join(SERVER_DIR, 'r2-usage.json')

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')) } catch { return { month: new Date().toISOString().slice(0, 7), classA: 0, storedBytes: 0 } }
}
// Atomik yazma: çökme anında yarım JSON kalmaz, eşzamanlı yazımlar birbirini ezmez.
function writeState(state) {
  const target = statePath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, target)
}

function refundUpload(bytes) {
  try {
    const state = readState()
    state.classA = Math.max(0, (state.classA || 0) - 1)
    state.storedBytes = Math.max(0, (state.storedBytes || 0) - bytes)
    writeState(state)
  } catch { /* kota iadesi en iyi eforludur */ }
}

export function reserveUpload(bytes) {
  const state = readState(); const month = new Date().toISOString().slice(0, 7)
  if (state.month !== month) { state.month = month; state.classA = 0 }
  if (state.classA >= R2_MAX_CLASS_A || state.storedBytes + bytes > R2_MAX_STORAGE_BYTES) return false
  state.classA += 1; state.storedBytes += bytes; writeState(state); return true
}

export async function uploadFile(trackId, filePath, contentType = 'audio/mpeg') {
  if (!enabled()) return { enabled: false }
  const size = fs.statSync(filePath).size
  if (!reserveUpload(size)) throw new Error('R2 ücretsiz güvenlik bütçesi dolmak üzere; yeni yükleme durduruldu.')
  let response
  try {
    response = await fetch(`${process.env.R2_WORKER_URL.replace(/\/$/u, '')}/internal/audio/${encodeURIComponent(keyFor(trackId))}`, {
      method: 'PUT', headers: { 'X-Wavebox-Proxy-Key': process.env.R2_PROXY_KEY, 'Content-Type': contentType, 'Content-Length': String(size) }, body: fs.createReadStream(filePath), duplex: 'half',
    })
  } catch (error) {
    refundUpload(size)
    throw error
  }
  if (!response.ok) { refundUpload(size); throw new Error(`R2 yükleme hatası: ${response.status}`) }
  return { enabled: true, key: keyFor(trackId), size }
}

export async function getObject(key, range = '') {
  if (!enabled()) return null
  if (!/^audio\/[A-Za-z0-9_-]{1,128}\.mp3$/u.test(String(key))) return null
  const headers = { 'X-Wavebox-Proxy-Key': process.env.R2_PROXY_KEY }; if (range) headers.Range = range
  const response = await fetch(`${process.env.R2_WORKER_URL.replace(/\/$/u, '')}/internal/audio/${encodeURIComponent(key)}`, { headers })
  return response.ok ? response : null
}

export { enabled as isR2Enabled, keyFor, R2_MAX_STORAGE_BYTES, R2_MAX_CLASS_A }
