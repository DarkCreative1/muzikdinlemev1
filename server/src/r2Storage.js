import fs from 'node:fs'
import path from 'node:path'

const R2_MAX_STORAGE_BYTES = 8 * 1024 * 1024 * 1024
const R2_MAX_CLASS_A = 800_000

const enabled = () => process.env.R2_ENABLED === 'true' && Boolean(process.env.R2_WORKER_URL && process.env.R2_PROXY_KEY)
const TRACK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/u
const keyFor = (trackId, ext = 'mp3') => {
  const id = String(trackId || '')
  if (!TRACK_ID_RE.test(id) || !/^[a-z0-9]{1,8}$/iu.test(String(ext))) throw new Error('Geçersiz R2 medya anahtarı.')
  return `audio/${id}.${String(ext).toLowerCase()}`
}
const statePath = () => path.resolve(process.env.R2_USAGE_FILE || 'server/r2-usage.json')

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')) } catch { return { month: new Date().toISOString().slice(0, 7), classA: 0, storedBytes: 0 } }
}
function writeState(state) { fs.mkdirSync(path.dirname(statePath()), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(state, null, 2)) }

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
  const response = await fetch(`${process.env.R2_WORKER_URL.replace(/\/$/u, '')}/internal/audio/${encodeURIComponent(keyFor(trackId))}`, {
    method: 'PUT', headers: { 'X-Wavebox-Proxy-Key': process.env.R2_PROXY_KEY, 'Content-Type': contentType, 'Content-Length': String(size) }, body: fs.createReadStream(filePath), duplex: 'half',
  })
  if (!response.ok) throw new Error(`R2 yükleme hatası: ${response.status}`)
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
