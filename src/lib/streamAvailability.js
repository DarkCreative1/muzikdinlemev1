const terminalStates = new Set(['completed', 'ready'])
const failedStates = new Set(['failed', 'error'])

const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('The operation was aborted.', 'AbortError'))
    return
  }
  const timer = setTimeout(resolve, milliseconds)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(new DOMException('The operation was aborted.', 'AbortError'))
  }, { once: true })
})

export async function waitForDownloadReady(getStatus, trackId, {
  signal,
  timeoutMs = 30_000,
  intervalMs = 400,
} = {}) {
  const deadline = Date.now() + timeoutMs
  let lastStatus = null

  while (Date.now() <= deadline) {
    lastStatus = await getStatus(trackId, { signal, timeout: 5_000 })
    if (terminalStates.has(String(lastStatus?.status || '').toLowerCase()) || lastStatus?.is_downloaded) return lastStatus
    if (failedStates.has(String(lastStatus?.status || '').toLowerCase())) {
      throw new Error(lastStatus?.message || 'Ses akışı hazırlanamadı.')
    }
    await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())), signal)
  }

  const error = new Error(`Ses akışı zamanında hazırlanamadı (${lastStatus?.status || 'unknown'}).`)
  error.code = 'STREAM_NOT_READY'
  throw error
}
