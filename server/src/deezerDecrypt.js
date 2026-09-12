import crypto from 'node:crypto'
import { BF_P, BF_S } from './deezerBlowfishTables.js'

const BF_SECRET = 'g4el58wc0zvf9na1'
const BLOCK_SIZE = 2048
const CBC_IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])

export function generateBlowfishKey(trackId) {
  const md5hex = crypto.createHash('md5').update(String(trackId), 'binary').digest('hex')
  const key = Buffer.alloc(16)
  for (let i = 0; i < 16; i++) {
    key[i] = md5hex.charCodeAt(i) ^ md5hex.charCodeAt(i + 16) ^ BF_SECRET.charCodeAt(i)
  }
  return key
}

function buildKeySchedule(key) {
  const P = BF_P.slice()
  const S = BF_S.map((t) => t.slice())
  let j = 0
  for (let i = 0; i < 18; i++) {
    let k = 0
    for (let n = 0; n < 4; n++) {
      k = ((k << 8) | key[j]) >>> 0
      j = (j + 1) % key.length
    }
    P[i] = (P[i] ^ k) >>> 0
  }
  let L = 0
  let R = 0
  const enc = (l, r) => {
    let xl = l
    let xr = r
    for (let i = 0; i < 16; i++) {
      xl = (xl ^ P[i]) >>> 0
      const a = ((S[0][(xl >>> 24) & 0xff] + S[1][(xl >>> 16) & 0xff]) >>> 0) ^ S[2][(xl >>> 8) & 0xff]
      xr = (xr ^ ((a + S[3][xl & 0xff]) >>> 0)) >>> 0
      ;[xl, xr] = [xr, xl]
    }
    ;[xl, xr] = [xr, xl]
    xr = (xr ^ P[16]) >>> 0
    xl = (xl ^ P[17]) >>> 0
    return [xl, xr]
  }
  for (let i = 0; i < 18; i += 2) {
    ;[L, R] = enc(L, R)
    P[i] = L
    P[i + 1] = R
  }
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 256; i += 2) {
      ;[L, R] = enc(L, R)
      S[s][i] = L
      S[s][i + 1] = R
    }
  }
  return { P, S }
}

function makeBlockDecrypter(key) {
  const { P, S } = buildKeySchedule(key)
  return function decryptBlock(block) {
    let xl = block.readUInt32BE(0)
    let xr = block.readUInt32BE(4)
    for (let i = 17; i >= 2; i--) {
      xl = (xl ^ P[i]) >>> 0
      const a = ((S[0][(xl >>> 24) & 0xff] + S[1][(xl >>> 16) & 0xff]) >>> 0) ^ S[2][(xl >>> 8) & 0xff]
      xr = (xr ^ ((a + S[3][xl & 0xff]) >>> 0)) >>> 0
      ;[xl, xr] = [xr, xl]
    }
    ;[xl, xr] = [xr, xl]
    xr = (xr ^ P[1]) >>> 0
    xl = (xl ^ P[0]) >>> 0
    const out = Buffer.alloc(8)
    out.writeUInt32BE(xl, 0)
    out.writeUInt32BE(xr, 4)
    return out
  }
}

export function createDeezerDecryptor(trackId) {
  const decryptBlock = makeBlockDecrypter(generateBlowfishKey(trackId))
  let buf = Buffer.alloc(0)
  let blockIdx = 0

  function decryptChunk(chunk) {
    const out = Buffer.alloc(chunk.length)
    let prev = CBC_IV
    for (let off = 0; off < chunk.length; off += 8) {
      const d = decryptBlock(chunk.subarray(off, off + 8))
      for (let b = 0; b < 8; b++) out[off + b] = d[b] ^ prev[b]
      prev = chunk.subarray(off, off + 8)
    }
    return out
  }

  return {
    write(chunk) {
      const output = []
      if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk)
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
      while (buf.length >= BLOCK_SIZE) {
        const block = buf.subarray(0, BLOCK_SIZE)
        buf = buf.subarray(BLOCK_SIZE)
        if (blockIdx % 3 === 0) {
          const n = Math.floor(block.length / 8) * 8
          output.push(decryptChunk(block.subarray(0, n)))
        } else {
          output.push(block)
        }
        blockIdx++
      }
      return output
    },
    end() {
      if (buf.length) {
        const out = blockIdx % 3 === 0 ? Buffer.concat([decryptChunk(buf.subarray(0, Math.floor(buf.length / 8) * 8)), buf.subarray(Math.floor(buf.length / 8) * 8)]) : buf
        buf = Buffer.alloc(0)
        return out
      }
      return Buffer.alloc(0)
    },
  }
}
