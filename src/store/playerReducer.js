// Player state — saf reducer, test sözleşmesiyle birebir uyumlu
export const createInitialPlayerState = () => ({
  queue: [],
  index: -1,
  currentId: null,
  playing: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  repeat: 'off',
  shuffle: false,
  contextId: null,
  contextName: null,
  error: null,
  source: null,
  radio: createRadioState(),
})

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const normalizeRadioArtist = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR')
const RADIO_BATCH_SIZE = 12
const createRadioState = () => ({
  active: false,
  earlySkips: {},
  lateSkips: {},
  blockedArtists: {},
  seenIds: [],
})

const trackDuration = (track) => Number(track?.duration) || 0

function appendRadioTracks(state, tracks, autoAdvance = false) {
  if (!state.radio.active) return state
  const existingIds = new Set(state.radio.seenIds)
  const batchArtistCounts = new Map()
  const additions = []

  for (const track of Array.isArray(tracks) ? tracks : []) {
    if (additions.length >= RADIO_BATCH_SIZE) break
    const id = String(track?.id || '')
    const artistKey = normalizeRadioArtist(track?.artist)
    if (!id || existingIds.has(id) || state.radio.blockedArtists[artistKey]) continue

    const batchCount = batchArtistCounts.get(artistKey) || 0
    const maxPerBatch = state.radio.lateSkips[artistKey] ? 2 : Number.POSITIVE_INFINITY
    if (batchCount >= maxPerBatch) continue

    additions.push(track)
    existingIds.add(id)
    batchArtistCounts.set(artistKey, batchCount + 1)
  }

  if (!additions.length) return state
  const wasAtEnd = state.index >= 0 && state.index >= state.queue.length - 1
  const queue = [...state.queue, ...additions]
  const shouldAdvance = autoAdvance && wasAtEnd
  const nextIndex = shouldAdvance ? state.index + 1 : state.index
  const nextTrack = queue[nextIndex]

  return {
    ...state,
    queue,
    index: nextIndex,
    currentId: nextTrack?.id ?? state.currentId,
    playing: shouldAdvance ? true : state.playing,
    progress: shouldAdvance ? 0 : state.progress,
    duration: shouldAdvance ? trackDuration(nextTrack) : state.duration,
    radio: { ...state.radio, seenIds: [...existingIds] },
  }
}

export function playerReducer(state, action) {
  switch (action.type) {
    case 'PLAY_CONTEXT': {
      const tracks = Array.isArray(action.tracks) ? action.tracks : []
      if (!tracks.length) return { ...state, queue: [], index: -1, currentId: null, playing: false, contextId: null, contextName: null }
      const startIndex = clamp(Math.floor(Number(action.startIndex) || 0), 0, tracks.length - 1)
      let queue = [...tracks]
      let index = startIndex
      if (action.shuffle) {
        const rest = queue.filter((_, i) => i !== startIndex)
        // shuffle: Fisher-Yates permütasyonu
        for (let i = rest.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1)) // shuffle index
          ;[rest[i], rest[j]] = [rest[j], rest[i]]
        }
        queue = [queue[startIndex], ...rest]
        index = 0
      }
      return {
        ...state,
        queue,
        index,
        currentId: queue[index]?.id ?? null,
        playing: true,
        progress: 0,
        duration: Number(queue[index]?.duration) || 0,
        contextId: action.contextId ?? null,
        contextName: action.contextName ?? null,
        error: null,
        radio: createRadioState(),
      }
    }

    case 'START_RADIO': {
      const activeTrack = state.index >= 0 && state.index < state.queue.length ? state.queue[state.index] : null
      const seed = activeTrack || action.seed || null
      const queue = seed ? [seed] : []
      const isPreservingCurrent = Boolean(activeTrack)
      const seenIds = [...new Set([activeTrack?.id, action.seed?.id].filter(Boolean))]
      return {
        ...state,
        queue,
        index: queue.length ? 0 : -1,
        currentId: seed?.id ?? null,
        playing: isPreservingCurrent ? state.playing : Boolean(seed),
        progress: isPreservingCurrent ? state.progress : 0,
        duration: isPreservingCurrent ? state.duration : trackDuration(seed),
        contextId: seed ? `radio-${seed.id}` : null,
        contextName: seed ? `Radyo · ${seed.artist}` : 'Kişisel Radyo',
        error: null,
        radio: { ...createRadioState(), active: true, seenIds },
      }
    }

    case 'RADIO_APPEND': return appendRadioTracks(state, action.tracks, action.autoAdvance)

    case 'RADIO_FEEDBACK': {
      if (!state.radio.active) return state
      const artistKey = normalizeRadioArtist(action.artist)
      if (!artistKey || !['early', 'late'].includes(action.kind)) return state
      const key = action.kind === 'early' ? 'earlySkips' : 'lateSkips'
      const counts = { ...state.radio[key], [artistKey]: (state.radio[key][artistKey] || 0) + 1 }
      const blockedArtists = action.kind === 'early' && counts[artistKey] >= 4
        ? { ...state.radio.blockedArtists, [artistKey]: true }
        : state.radio.blockedArtists
      return { ...state, radio: { ...state.radio, [key]: counts, blockedArtists } }
    }

    case 'SET_CURRENT': {
      const index = clamp(Number(action.index) || 0, 0, Math.max(0, state.queue.length - 1))
      const track = state.queue[index]
      return {
        ...state,
        index,
        currentId: track?.id ?? null,
        playing: Boolean(action.playing ?? state.playing),
        progress: 0,
        duration: Number(track?.duration) || 0,
        error: null,
      }
    }

    case 'NEXT': {
      // Tek parça tekrarı: aynı parçada kal, başa sar, çalmaya devam et.
      if (state.repeat === 'track' && state.index >= 0 && state.index < state.queue.length) {
        return { ...state, progress: 0, playing: true }
      }
      const index = state.index + 1
      if (index >= state.queue.length) {
        if (state.repeat === 'context') return { ...state, index: 0, currentId: state.queue[0]?.id ?? null, progress: 0, playing: true }
        return { ...state, playing: false, progress: 0, index: state.index }
      }
      return { ...state, index, currentId: state.queue[index]?.id ?? null, progress: 0, playing: true }
    }

    case 'PREV': {
      if (state.progress > 3 && state.index >= 0) return { ...state, progress: 0 }
      const index = state.index - 1
      if (index < 0) {
        if (state.repeat === 'context') {
          const last = state.queue.length - 1
          return { ...state, index: last, currentId: state.queue[last]?.id ?? null, progress: 0, playing: true }
        }
        return { ...state, progress: 0 }
      }
      return { ...state, index, currentId: state.queue[index]?.id ?? null, progress: 0, playing: true }
    }

    case 'TOGGLE_PLAY': return { ...state, playing: !state.playing }
    case 'SET_PLAYING': return { ...state, playing: Boolean(action.value ?? action.playing) }

    case 'SET_PROGRESS': {
      const duration = Math.max(0, Number(state.duration) || 0)
      return { ...state, progress: clamp(Number(action.value) || 0, 0, duration) }
    }

    case 'SET_DURATION': return { ...state, duration: Math.max(0, Number(action.value) || 0) }

    case 'SEEK': {
      const duration = Math.max(0, Number(state.duration) || 0)
      return { ...state, progress: clamp(Number(action.value) || 0, 0, duration) }
    }

    case 'VOLUME': return { ...state, volume: clamp(Number(action.value) || 0, 0, 1), muted: Number(action.value) === 0 }
    case 'TOGGLE_MUTE': return { ...state, muted: !state.muted }
    case 'SET_MUTED': return { ...state, muted: Boolean(action.value) }

    case 'CYCLE_REPEAT': {
      const order = { off: 'context', context: 'track', track: 'off' }
      return { ...state, repeat: order[state.repeat] || 'off' }
    }

    case 'SET_REPEAT': {
      return ['off', 'context', 'track'].includes(action.value)
        ? { ...state, repeat: action.value }
        : state
    }

    case 'TOGGLE_SHUFFLE': return { ...state, shuffle: !state.shuffle }

    case 'MOVE_QUEUE_ITEM': {
      const from = Number(action.from)
      const to = Number(action.to)
      if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return state
      if (from < 0 || from >= state.queue.length || to < 0 || to >= state.queue.length) return state
      const queue = [...state.queue]
      const [moved] = queue.splice(from, 1)
      queue.splice(to, 0, moved)
      let index = state.index
      if (from === index) index = to
      else if (from < index && to >= index) index -= 1
      else if (from > index && to <= index) index += 1
      return { ...state, queue, index, currentId: queue[index]?.id ?? null }
    }

    case 'REMOVE_FROM_QUEUE': {
      const index = Number(action.index)
      if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) return state
      const queue = state.queue.filter((_, i) => i !== index)
      if (!queue.length) return { ...state, queue: [], index: -1, currentId: null, playing: false }
      let newIndex = state.index
      if (index < state.index) newIndex = state.index - 1
      else if (index === state.index) newIndex = Math.min(state.index, queue.length - 1)
      return { ...state, queue, index: newIndex, currentId: queue[newIndex]?.id ?? null }
    }

    case 'SET_ERROR': {
      const message = action.message ?? action.value ?? null
      return { ...state, error: message, playing: message ? false : state.playing }
    }
    case 'CLEAR_ERROR': return { ...state, error: null }

    case 'SET_SOURCE': return { ...state, source: action.source ?? null }

    case 'RESET': return createInitialPlayerState()

    default:
      return state
  }
}
