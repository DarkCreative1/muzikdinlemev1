import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const R2_MAX_STORAGE_BYTES = 8 * 1024 * 1024 * 1024
const R2_MAX_CLASS_A = 800_000

const enabled = () => process.env.R2_ENABLED === 'true' && Boolean(process.env.R2_WORKER_URL && process.env.R2_PROXY_KEY)
const R2_KEY_EXTS = ['mp3', 'm4a', 'webm', 'opus', 'mp4', 'aac', 'wav']
const R2_KEY_RE = new RegExp(`^audio\\/[A-Za-z0-9_-]{1,128}\\.(${R2_KEY_EXTS.join('|')})$`, 'u')
const CONTENT_TYPE_BY_EXT = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac',
  webm: 'audio/webm', opus: 'audio/opus', wav: 'audio/wav',
}
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

export async function uploadFile(trackId, filePath, contentType = '', keyExt = '') {
  if (!enabled()) return { enabled: false }
  const size = fs.statSync(filePath).size
  if (!reserveUpload(size)) throw new Error('R2 ücretsiz güvenlik bütçesi dolmak üzere; yeni yükleme durduruldu.')
  const ext = String(keyExt || path.extname(filePath).replace(/^\./u, '') || 'mp3').toLowerCase()
  const key = keyFor(trackId, R2_KEY_EXTS.includes(ext) ? ext : 'mp3')
  const type = contentType || CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream'
  let response
  try {
    response = await fetch(`${process.env.R2_WORKER_URL.replace(/\/$/u, '')}/internal/audio/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'X-Wavebox-Proxy-Key': process.env.R2_PROXY_KEY, 'Content-Type': type, 'Content-Length': String(size) }, body: fs.createReadStream(filePath), duplex: 'half',
    })
  } catch (error) {
    refundUpload(size)
    throw error
  }
  if (!response.ok) { refundUpload(size); throw new Error(`R2 yükleme hatası: ${response.status}`) }
  return { enabled: true, key, size }
}

export async function getObject(key, range = '', signal = undefined) {
  if (!enabled()) return null
  if (!R2_KEY_RE.test(String(key))) return null
  const headers = { 'X-Wavebox-Proxy-Key': process.env.R2_PROXY_KEY }; if (range) headers.Range = range
  const response = await fetch(`${process.env.R2_WORKER_URL.replace(/\/$/u, '')}/internal/audio/${encodeURIComponent(key)}`, { headers, signal })
  if (!response.ok) return null
  return response
}

// R2'de bu parçanın anahtarı var mı? Uzantılar paralel yoklanır (bytes=0-0),
// ilk bulunan kazanır, diğerleri iptal edilir. Yoksa null.
export async function probeR2(trackId) {
  if (!enabled()) return null
  let id = ''
  try { id = String(trackId || ''); keyFor(id) } catch { return null }
  const controllers = R2_KEY_EXTS.map(() => new AbortController())
  const dispose = () => { for (const c of controllers) try { c.abort() } catch {} }
  try {
    const results = await Promise.all(R2_KEY_EXTS.map((ext, i) =>
      getObject(keyFor(id, ext), 'bytes=0-0', controllers[i].signal)
        .then(async (res) => {
          if (!res) return null
          try { await res.body?.cancel?.() } catch {}
          return { ext, key: keyFor(id, ext) }
        })
        .catch(() => null),
    ))
    return results.find(Boolean) || null
  } finally {
    dispose()
  }
}

// Sihirli baytlardan gerçek kapsayıcıyı bulur (R2 anahtarındaki uzantı
// eski dosyalarda yanlış olabilir; yerel dosya adı doğru olur).
function sniffExt(head, fallbackExt) {
  const h = head || Buffer.alloc(0)
  if (h.length >= 4 && h[0] === 0x1A && h[1] === 0x45 && h[2] === 0xDF && h[3] === 0xA3) return 'webm'
  if (h.length >= 3 && h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) return 'mp3'
  if (h.length >= 2 && h[0] === 0xFF && (h[1] & 0xE0) === 0xE0) return 'mp3'
  if (h.length >= 8 && h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70) return 'm4a'
  if (h.length >= 4 && h[0] === 0x4F && h[1] === 0x67 && h[2] === 0x67 && h[3] === 0x53) return 'opus'
  if (h.length >= 4 && h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46) return 'wav'
  return fallbackExt
}

// R2'deki parçayı yerel önbelleğe indirir. Yoksa null, sınır aşımında throw.
export async function fetchR2ToFile(trackId, destDir, maxBytes) {
  const hit = await probeR2(trackId)
  if (!hit) return null
  const id = String(trackId)
  const full = await getObject(hit.key)
  if (!full?.ok || !full.body) return null
  fs.mkdirSync(destDir, { recursive: true })
  const tmpPath = path.join(destDir, `${id}.r2part`)
  let received = 0
  let head = null
  const fd = fs.openSync(tmpPath, 'w')
  try {
    const reader = full.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!head && value?.length) head = Buffer.from(value.subarray(0, 12))
      received += value.length
      if (received > maxBytes) {
        try { await reader.cancel() } catch {}
        throw new Error('Dosya izin verilen boyutu aşıyor.')
      }
      fs.writeSync(fd, value)
    }
  } catch (error) {
    try { fs.closeSync(fd) } catch {}
    fs.rmSync(tmpPath, { force: true })
    throw error
  }
  try { fs.closeSync(fd) } catch {}
  if (received <= 10_000) { fs.rmSync(tmpPath, { force: true }); return null }
  const ext = `.${sniffExt(head, hit.ext)}`
  const finalPath = path.join(destDir, `${id}${ext}`)
  try { fs.rmSync(finalPath, { force: true }) } catch {}
  fs.renameSync(tmpPath, finalPath)
  return finalPath
}

export { enabled as isR2Enabled, keyFor, R2_MAX_STORAGE_BYTES, R2_MAX_CLASS_A }
