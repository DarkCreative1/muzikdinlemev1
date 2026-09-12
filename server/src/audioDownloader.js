import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import ytdl from 'youtube-dl-exec'
import { DOWNLOADS_DIR, MAX_CACHE_BYTES, MAX_DOWNLOAD_BYTES, MAX_CONCURRENT_DOWNLOADS, MAX_PENDING_DOWNLOADS } from './config.js'
import { saveOrUpdateTrack, markTrackDownloadMissing, getTrack } from './db.js'
import { searchDeezerTracks, getDeezerTrackStream, hasDeezerAuth } from './deezerService.js'
import { searchYouTubeTracks } from './youtubeSearch.js'
import { searchSoundCloudTracks, getSoundCloudFullStream } from './soundcloudService.js'
import { createDeezerDecryptor } from './deezerDecrypt.js'
import { uploadFile, isR2Enabled } from './r2Storage.js'

export const activeDownloads = new Map()
const runningProcesses = new Map()
const AUDIO_EXTS = ['.m4a', '.mp3', '.mp4', '.webm', '.opus', '.aac', '.wav']
const GENERIC_ARTISTS = new Set(['spotify', 'search result', 'various artists', 'various', 'unknown artist', 'unknown', 'sanatçı'])
const FOLLOW_POLL_MS = 120
const FOLLOW_CHUNK_BYTES = 512 * 1024
const FOLLOW_STALL_MS = 45_000
const FOLLOW_MAX_RESTARTS = 2
const FOLLOW_MIN_RESTART_MS = 1_500
const PRIORITY_EXTRA_SLOTS = 2
const PRELOAD_SPACING_MS = 1_500
// Ham yt-dlp extractor argümanı (örn. PO token için "youtube:po_token=web.gvs+XXX").
// Render ayarlarından YT_EXTRACTOR_ARGS olarak verilir, tüm YouTube denemelerine eklenir.
const YT_EXTRACTOR_ARGS = String(process.env.YT_EXTRACTOR_ARGS || '').trim()
// YT devre kesici: veri merkezi IP'sinden tüm istemciler bot engeline takılırsa
// her parçada dakikalarca boşa kürek çekilmesin. Üst üste N başarısız YT indirme
// sonrası YT denemeleri atlanıp doğrudan yedek kaynağa (SoundCloud) geçilir.
// Soğuma süresi dolunca tek sondaj denemesine izin verilir (engel kalkmış olabilir).
const YT_CIRCUIT_THRESHOLD = 3
const YT_CIRCUIT_COOLDOWN_MS = 30 * 60_000
let ytBotStreak = 0
let lastYtProbeAt = 0
function ytCircuitOpen() {
  return ytBotStreak >= YT_CIRCUIT_THRESHOLD && Date.now() - lastYtProbeAt < YT_CIRCUIT_COOLDOWN_MS
}
const MAX_DOWNLOAD_STATES = 10_000
// Bir indirme en fazla ~10 dk sürer; 1 saatten eski .part dosyaları ölü kalıntıdır.
const STALE_PART_MS = 60 * 60_000

async function mirrorToR2(trackId, filePath) {
  if (!isR2Enabled()) return null
  try {
    const result = await uploadFile(trackId, filePath)
    console.log(`[AudioDownloader] ${trackId} R2’ye yüklendi: ${result.key}`)
    return result
  } catch (error) {
    console.warn(`[AudioDownloader] R2 aynalama atlandı: ${error.message}`)
    return null
  }
}

export function sanitizeFilename(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
}
function tokenize(value) {
  // Türkçe "İ" lowercase'i JS'te "i" + combining dot verir; tek "i"ye indir.
  // ç/ş/ü/ö dönüşümü BURADA YAPILMAZ: "ölür"~"olur", "gül"~"gul" gibi farklı kelimeler
  // aynı token'a düşüp yanlış parça seçtirir. O varyasyonlar normalizeTr ile BONUS olarak işlenir.
  let s = String(value || '').toLowerCase()
  s = s.replace(/i[\u0300-\u036f]+/g, 'i')
  s = s.normalize('NFKC')
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
}
// Türkçe karakter varyasyonlarını birleştirir ("Şebnem"~"Sebnem", "İsyan"~"Isyan").
// Sadece BONUS eşleşmede kullanılır – ana eşleşme orijinal tokenlarla yapılır.
function normalizeTr(value) {
  // Önce küçük harfe in: büyük Türkçe harfler (Ç, Ş, İ...) aşağıdaki eşlemelere
  // girmez; lowercase sonrası "i̇" combining dot'u da aynı adımda temizlenir.
  return String(value || '').toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/i[\u0300-\u036f]+/g, 'i')
}
const BAD_TITLE_RE = /preview|teaser|\bloop\b|1 hour|10 hours|karaoke|sped ?up|speed ?up|slowed|instrumental|radio edit|\bremix\b|\bcover\b|\bacoustic\b|\bconcert\b|akustik|lyrics|sözleri|sözler/i
// Parantez/tire/boşluk ile ayrılmış net "yanlış versiyon" işaretleri: asla seçilmez.
// Örn. "Gülpembe (cover)", "Blinding Lights Hardstyle Remix" (tiresiz!), "Dibine Kadar (Performans)".
// isWanted koruması: aranan title'da aynı kelime geçiyorsa (ör. "Live Forever", "Mendil (Hardstyle Remix)") serbesttir.
const HARD_BLOCK_RE = /(?:[-([/]\s*|\b(?:hardstyle\s+)?)(slowed|sped ?up|speed ?up|remix|cover|live|karaoke|acoustic|instrumental|reverb|concert|loop|1 ?hour|10 ?hours|radio ?edit|preview|teaser|dj ?mix|mashup|performans|canlı|boosted|\bmix\b|fancam|fan ?cam|konser|seyirci|stage ?mix|lansman|showcase)\b|\d+\s*bpm\s*mix\b/i
const GOOD_TITLE_RE = /official (audio|video)|official|full (song|version|track)|lyrics|lyric/i
// Kaynak bazlı skorlama ayarları — her kaynağın doğası farklı:
// - YouTube: başlıklar kalabalık (sanatçı+parantezler), kanal sinyali var, cover/lyrics spam'i yoğun → katı.
// - Deezer: resmi katalog, başlık kısa (sanatçı ayrı alanda), cover yok ama aynı isimli farklı sanatçı
//   şarkıları olabilir → tek-token kırpma daha yumuşak, cover cezası hafif, sanatçı alanı bonus.
// - SoundCloud: remix/cover/dj-mix dolu, en az güvenilir → en yüksek eşik, son çare.
const SOURCE_CFG = {
  youtube: { singleTokenCap: 15, coverPenalty: 25, channelBonus: 15, artistBonus: 0, threshold: 60, minCoverage: 0.35, fallbackScore: 85, fallbackCoverage: 0.6 },
  deezer: { singleTokenCap: 25, coverPenalty: 10, channelBonus: 0, artistBonus: 15, threshold: 55, minCoverage: 0.35 },
  soundcloud: { singleTokenCap: 15, coverPenalty: 25, channelBonus: 15, artistBonus: 0, threshold: 60, minCoverage: 0.4 },
}
export function pickBestCandidate(candidates, artist, title, expectedDuration = 0, source = 'youtube') {
  const cfg = SOURCE_CFG[source] || SOURCE_CFG.youtube
  const artistTokens = new Set(tokenize(artist))
  const titleTokens = tokenize(title)
  const titleTokenSet = new Set(titleTokens)
  const allTokens = new Set([...artistTokens, ...titleTokens])
  const expected = Number(expectedDuration) >= 30 ? Number(expectedDuration) : 0
  // "Birileri Var (Hardstyle Remix)" gibi istekler: aranan title'ın KENDİSİNDE yasaklı
  // kelime varsa o kelime aday başlıkta serbesttir (kullanıcı o versiyonu istiyor).
  // "Birileri Var" aranırken remix sürümü yine -999 ile engellenir (yanlış parça koruması).
  // "hardstyle" türü aranırken remix/mix/edit sürümleri kabul edilir (hardstyle remix kültürü).
  const wantedHard = []
  for (const t of titleTokens) {
    if (/(slowed|sped|speed|remix|cover|live|karaoke|acoustic|akustik|instrumental|reverb|concert|loop|hour|radio|preview|teaser|mix|mashup|edit|flip|bootleg|bass|hardstyle|fancam|konser|seyirci|lansman|showcase)/.test(t)) wantedHard.push(t)
  }
  if (titleTokens.some((t) => /hardstyle/.test(t))) wantedHard.push('remix', 'mix', 'edit')
  const isWanted = (w) => wantedHard.some((x) => w.includes(x))
  const BAD_WORDS = ['preview', 'teaser', 'loop', '1 hour', '10 hours', 'karaoke', 'sped up', 'speed up', 'slowed', 'instrumental', 'radio edit', 'remix', 'cover', 'acoustic', 'concert', 'akustik', 'lyrics', 'sözleri', 'sözler']
  let best = null
  let bestScore = -Infinity
  for (const candidate of candidates || []) {
    if (!candidate?.title) continue
    const duration = Number(candidate.duration) || 0
    const normCandTitle = String(candidate.title).normalize('NFKC')
    let score = 0
    if (duration >= 30) {
      if (expected > 0) {
        // Süre, doğru parçanın en güçlü sinyali: kademeli puan.
        // ~1.0 oran resmi parça; 0.45-0.7 arası (remix/cover/farklı parça) zayıf.
        // Oran 0.45'in altındaysa (yarısından kısa/uzun) bu KESİN farklı bir kayıttır
        // (2 dk'luk parçaya 30 dk'luk bölüm videosu, konser kaydı vb.) → sert ceza.
        const ratio = Math.min(duration, expected) / Math.max(duration, expected)
        score += ratio >= 0.95 ? 50 : ratio >= 0.85 ? 35 : ratio >= 0.7 ? 20 : ratio >= 0.45 ? 8 : -40
      } else {
        score += 10
      }
    } else if (duration > 0) {
      score -= 40
    }
    const candidateTokens = new Set(tokenize(candidate.title))
    // Örtüşme SADECE şarkı adı token'larıyla ölçülür. Sanatçı token'ları buraya karışırsa
    // "Sezen Aksu Güllerim Soldu" (sanatçı doğru, şarkı yanlış) yanlışlıkla yüksek puan alır.
    let overlap = 0
    for (const token of candidateTokens) if (titleTokenSet.has(token)) overlap += 1
    const titleCoverage = titleTokens.length ? overlap / titleTokens.length : 0
    // Tek kelimelik şarkı adları ("Sen", "Rüzgar", "Yalan") başlıklarda çok kolay çakışır;
    // coverage 45 puanı onları şişirir. Tek token'lık adlarda coverage katkısı kırpılır.
    let coveragePoints = Math.min(1, titleCoverage) * 45
    if (titleTokens.length === 1) coveragePoints = Math.min(coveragePoints, cfg.singleTokenCap)
    score += coveragePoints
    // Türkçe karakter varyasyonu BONUSU: "Şebnem"~"Sebnem" gibi yazım farkları ana
    // eşleşmeyi kaçırdıysa küçük bir bonus verir. Asla "ölür"~"olur" çakışması yaratmaz
    // (bonus sınırlı + ana eşleşme orijinal tokenlarla yapıldı).
    const normCandidateTokens = new Set(tokenize(normalizeTr(candidate.title)))
    const normTargetTokens = new Set(tokenize(normalizeTr(title)))
    let normOverlap = 0
    for (const token of normCandidateTokens) if (normTargetTokens.has(token)) normOverlap += 1
    const normCoverage = normTargetTokens.size ? normOverlap / normTargetTokens.size : 0
    if (titleCoverage < 0.6 && normCoverage >= 0.6) score += 10
    // Başlık tamamen eşleştiyse güçlü sinyal: "Mendil (Hardstyle Remix)" aranırken
    // SC'deki aynı başlık eşiğe ulaşabilsin. Tek token'lı adlarda verilmez —
    // "Sen" aranırken "Sen Gel Diyorsun" gibi adaylar eşiği delmesin (süre+cap yeterli).
    if (titleTokens.length > 1 && titleTokens.every((t) => candidateTokens.has(t))) score += 10
    if (BAD_WORDS.some((w) => new RegExp(`\\b${w.replace(' ', ' ?')}\\b`, 'i').test(normCandTitle) && !isWanted(w))) score -= 35
    if (GOOD_TITLE_RE.test(candidate.title)) score += 8
    // Başlık "Sanatçı - Şarkı" desenindeyse ve şarkı adı SADECE ilk segmentte (sanatçı
    // pozisyonunda) geçiyorsa, bu başka birinin şarkısıdır: "RÜZGAR - KADINIM" (aradığımız
    // Kolpa'nın "Rüzgar"ı değil). İlk segment dışında hiçbir yerde geçmiyorsa ağır ceza.
    const segments = candidate.title.split(/[-–—]/).map((s) => s.trim()).filter(Boolean)
    if (segments.length > 1 && titleTokenSet.size > 0) {
      const firstSegTokens = new Set(tokenize(segments[0]))
      const laterSegTokens = new Set(tokenize(segments.slice(1).join(' ')))
      const inFirst = [...titleTokenSet].some((t) => firstSegTokens.has(t))
      const inLater = [...titleTokenSet].some((t) => laterSegTokens.has(t))
      // "RÜZGAR - KADINIM"da şarkı adı sanatçı pozisyonunda (ilk segment) ve ikinci segmentte
      // aranan sanatçı yok → başka birinin şarkısı. Ama "Lan - Zeynep Bastık | Lyric Video"
      // formatında şarkı adı doğru pozisyonda, ikinci segmentte aranan sanatçı var → ceza yok.
      if (inFirst && !inLater) {
        const laterHasArtist = segments.slice(1).some((s) => tokenize(s).some((t) => artistTokens.has(t)))
        if (!laterHasArtist) score -= 50
      }
    }
    // Kanal (upload sahibi) sanatçıyla örtüşüyorsa güçlü doğruluk sinyali (YouTube/SoundCloud'da geçerli).
    const channelTokens = tokenize(candidate.channel)
    const channelIsArtist = channelTokens.length > 0 && artistTokens.size > 0 && channelTokens.some((t) => artistTokens.has(t))
    if (channelIsArtist) score += cfg.channelBonus
    // Deezer'da sanatçı ayrı alandadır: user (ana sanatçı) veya contributors (düetler!) aranıyor.
    // "Antidepresan" (Mert Demir + Mabel Matiz düeti) gibi parçalar buradan +bonus alır.
    if (cfg.artistBonus > 0) {
      const names = [candidate.user, ...(candidate.contributors || [])].filter(Boolean)
      const artistMatch = names.some((name) => tokenize(name).some((t) => artistTokens.has(t)))
      if (artistMatch) score += cfg.artistBonus
    }
    // SANATÇI İZİ KONTROLÜ ("bambaşka şarkı çalıyor" düzeltmesi): aranan sanatçının
    // HİÇBİR token'ı adayda yoksa bu büyük ihtimalle aynı adlı BAŞKA bir şarkıdır
    // ("Türkiye", "Deli", "Crush" gibi yaygın adlar). Süre+başlık puanı bile eşiği
    // geçse yanlış parça çalınmasın: sert ceza.
    // Adayın AYRI sanatçı alanı varsa (Deezer: user/contributors) iz SADECE oradan
    // aranır — başlığa bakılmaz. Sanatçı adı şarkı adıyla çakıştığında ("CRUSH" adlı
    // sanatçının "Crush" şarkısı vs Jennifer Paige'in "Crush"ı) başlık izi yanlış
    // sanatçıya da geçer; ayrı alan bu tuzakları kapatır. YouTube'da sanatçı yalnızca
    // başlık/kanalda yazılı olabilir, orada ikisi de geçerlidir.
    const artistIsGeneric = GENERIC_ARTISTS.has(String(artist || '').trim().toLowerCase())
    if (artistTokens.size > 0 && !artistIsGeneric) {
      const hasArtistFields = Boolean(candidate.user || candidate.contributors?.length)
      const traceFields = hasArtistFields
        ? [candidate.user, ...(candidate.contributors || [])]
        : [candidate.title, candidate.channel]
      const normArtistTokens = new Set(tokenize(normalizeTr(artist)))
      const traceTokens = new Set()
      for (const field of traceFields) {
        const text = String(field || '')
        for (const token of tokenize(text)) traceTokens.add(token)
        for (const token of tokenize(normalizeTr(text))) traceTokens.add(token)
      }
      let artistHits = 0
      for (const token of artistTokens) if (traceTokens.has(token)) artistHits += 1
      for (const token of normArtistTokens) if (traceTokens.has(token)) artistHits += 1
      if (artistHits === 0) score -= 60
    }
    // Cover şüphesi: başlıkta sanatçı adı yoksa VE kanal da sanatçı değilse,
    // bu büyük ihtimalle başka birinin cover'ı ("Uğur Özdemir - Sigara" gibi).
    // Resmi parçalarda süre+başlık puanı yine yeter (örn. plak kanalındaki parçalar).
    const titleHasArtist = artistTokens.size > 0 && tokenize(candidate.title).some((t) => artistTokens.has(t))
    // Sanatçı bilgisi YOKSA cover tespiti yapılamaz (karşılaştırılacak isim yok):
    // "Mendil (Hardstyle Remix)" gibi sanatçısız aramalarda haksız ceza verilmez.
    if (artistTokens.size > 0 && !titleHasArtist && !channelIsArtist) score -= cfg.coverPenalty
    // Şarkı adı başlıkta hiç geçmiyorsa: kanal sanatçı olsa bile yanlış parça olabilir
    // ("Tarkan" kanalında "Kuzu Kuzu" videosu – aranan "Dudu" değil).
    // Türkçe varyasyon kontrolü normCoverage ile yapılır: "Çakıl Taşları" ~ "Cakil Taslari"
    // yazımı farklı olduğu için doğru aday cezalanmasın.
    if (titleCoverage < 0.3 && normCoverage < 0.3) score -= 40
    // Normalize edilmiş TAM başlık eşleşmesi de tam eşleşme kadar değerlidir
    // ("Sebnem Ferah - Cakil Taslari" ↔ "Şebnem Ferah - Çakıl Taşları");
    // birebir eşleşme zaten +10 aldığından çifte puan verilmez.
    if (titleTokens.length > 1 && normCoverage >= 0.99 && !titleTokens.every((t) => candidateTokens.has(t))) score += 10
    // Tek kelimelik şarkı adı + kalabalık başlık: "Sen" aranırken "Sen Ağlama" gibi farklı bir
    // şarkı da "sen" token'ı yüzünden eşleşir. Ama "Mert Demir feat. Mabel Matiz - Antidepresan"
    // gibi DÜET başlıkları da kalabalıktır — sanatçılar ve etiketler (feat/official/lyrics...)
    // ekstra sayılmaz, yalnızca GERÇEK ekstra kelimeler ("ağlama") cezalandırılır.
    // 'music'/'müzik' eksikti: "Official Music Video" kanonik resmi yükleme biçimidir,
    // 'music' fazladan kelime sayılıp resmi video -40 cezasıyla eleniyordu (CRUSH vakası).
    const SEG_EXTRA_TOKENS = new Set(['official', 'audio', 'video', 'music', 'müzik', 'visualizer', 'visualiser', 'klibi', 'lyrics', 'sözleri', 'sözler', 'lyric', 'full', 'song', 'version', 'track', 'clip', 'hd', '4k', 'feat', 'ft', 'mv', 'şarkı', 'video', 'official', 'audio'])
    if (titleTokens.length === 1 && candidateTokens.size >= 4 && expected > 0 && duration > 0 && segments.length > 0) {
      const lastSegTokens = new Set(tokenize(segments.at(-1) || candidate.title))
      const extraTokens = [...lastSegTokens].filter((t) => !titleTokenSet.has(t) && !artistTokens.has(t) && !SEG_EXTRA_TOKENS.has(t))
      if (extraTokens.length > 0) score -= 40
    }
    if (score > bestScore) { best = candidate; bestScore = score }
  }
  if (best) {
    // NFKC: "𝘀𝗽𝗲𝗲𝗱 𝘂𝗽" gibi matematik/emoji harfleri normal harflere çevir — yoksa
    // hard-block regex'leri görünmez yazımlarla atlanır ("lan(𝙨𝙥𝙚𝙚𝙙 𝙪𝙥)" vakası).
    const normTitle = String(best.title).normalize('NFKC')
    // Aranan title'da geçen yasaklı kelimeler serbest ("Mendil Hardstyle" → "Mendil (Hardstyle Remix)" kabul).
    const hardMatch = HARD_BLOCK_RE.exec(normTitle)
    if (hardMatch && !isWanted(String(hardMatch[1] || '').toLowerCase())) bestScore = -999
    // Parantez İÇİNDE herhangi bir yerde yasaklı kelime varsa da engelle: "(Major Lazer Remix)",
    // "(Kurd Maverick Remix)", "(Faze2 Edit)" gibi başlıklar baştaki "(remix)" kalıbına uymaz
    // ama yine de remix/edit'tir. Lyrics/Sözleri burada DEĞİL — o doğru şarkının versiyonudur,
    // sadece -35 ceza alır (BAD_TITLE_RE).
    const parenContent = (normTitle.match(/\(([^)]*)\)/g) || []).join(' ')
    const PAREN_HARD_WORDS = ['remix', 'cover', 'live', 'sped ?up', 'speed ?up', 'slowed', 'acoustic', 'akustik', 'instrumental', 'reverb', 'karaoke', 'preview', 'teaser', 'dj ?mix', 'mashup', 'mix', 'loop', '1 ?hour', '10 ?hours', 'radio edit', 'concert', 'edit', 'flip', 'bootleg', 'bass ?boosted']
    if (PAREN_HARD_WORDS.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(parenContent) && !isWanted(w))) bestScore = -999
    // SoundCloud tarzı tuzaklar (her kaynakta korur):
    // - Köşeli parantez içeriği: "[FREE DOWNLOAD]", "[EDM]" gibi işaretler versiyon değildir.
    // - "Şarkı A / Şarkı B / Şarkı C": 2+ slash → mashup.
    // - "by <yabancı isim>": "Queen – Bohemian Rhapsody ThaiVersion By Arseed" → başkasının cover'ı.
    const bracketContent = (normTitle.match(/\[([^\]]*)\]/g) || []).join(' ')
    if (/\b(free ?download|download|edit|flip|bootleg|bass ?boosted|dj set|dubstep)\b/i.test(bracketContent)) bestScore = -999
    if ((normTitle.match(/\//g) || []).length >= 2) bestScore = -999
    if (bestScore > -999 && /\bby\s+\S+/i.test(normTitle)) {
      const byMatch = /\bby\s+([a-z0-9]+)/i.exec(normTitle)
      if (byMatch && !artistTokens.has(byMatch[1].toLowerCase())) bestScore -= 40
    }
    best._score = bestScore
    const origCov = Math.min(1, tokenize(best.title).filter((t) => titleTokenSet.has(t)).length / Math.max(1, titleTokens.length))
    const normBest = new Set(tokenize(normalizeTr(best.title)))
    const normTarget = new Set(tokenize(normalizeTr(title)))
    const normCov = normTarget.size ? [...normTarget].filter((t) => normBest.has(t)).length / normTarget.size : 0
    best._coverage = Math.max(origCov, normCov)
  }
  return best
}
function buildSearchQueries(artist, title) {
  const artistClean = String(artist || '').trim()
  const titleClean = String(title || '').trim()
  const generic = !artistClean || GENERIC_ARTISTS.has(artistClean.toLowerCase())
  const queries = []
  if (generic) {
    queries.push(titleClean, `${titleClean} official audio`, `${titleClean} full song`)
  } else if (titleClean.toLowerCase().includes(artistClean.toLowerCase())) {
    queries.push(titleClean, `${titleClean} official audio`, `${titleClean} full song`)
  } else {
    queries.push(`${artistClean} - ${titleClean} official audio`, `${artistClean} - ${titleClean}`, `${titleClean} ${artistClean}`, `${titleClean} official audio`)
  }
  return [...new Set(queries)]
}
function scanCacheBytes() {
  return fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true }).filter((e) => e.isFile()).reduce((n, e) => {
    try { return n + fs.statSync(path.join(DOWNLOADS_DIR, e.name)).size } catch { return n }
  }, 0)
}
let cacheBytesTotal = scanCacheBytes()
const trackedCacheFiles = new Set(fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(DOWNLOADS_DIR, e.name)))
const pendingDownloads = []
const inflightDownloads = new Map()
let activeDownloadJobs = 0
let lastSpawnAt = 0
let shuttingDown = false
function setDownloadState(trackId, state) {
  const updated = { ...state, updated_at: Date.now() }
  activeDownloads.set(trackId, updated)
  if (activeDownloads.size > MAX_DOWNLOAD_STATES) {
    const removable = [...activeDownloads.entries()]
      .filter(([id, value]) => id !== trackId && !['queued', 'downloading'].includes(value.status))
      .sort((a, b) => (a[1].updated_at || 0) - (b[1].updated_at || 0))
    while (activeDownloads.size > MAX_DOWNLOAD_STATES && removable.length) activeDownloads.delete(removable.shift()[0])
    if (activeDownloads.size > MAX_DOWNLOAD_STATES) {
      const oldest = [...activeDownloads.entries()]
        .filter(([id]) => id !== trackId)
        .sort((a, b) => (a[1].updated_at || 0) - (b[1].updated_at || 0))[0]
      if (oldest) activeDownloads.delete(oldest[0])
    }
  }
  return updated
}
function setTerminalState(trackId, state) {
  setDownloadState(trackId, state)
  const timer = setTimeout(() => activeDownloads.delete(trackId), 15 * 60_000)
  timer.unref?.()
}

function extractYtError(error) {
  const stderr = String(error?.stderr || '')
  let raw = ''
  for (const line of stderr.split(/\r?\n/)) {
    const match = /ERROR:\s*(.+)/.exec(line)
    if (match) { raw = match[1].trim(); break }
  }
  // Ham stderr istemciye verilmez (sürüm/yol/extractor sızıntısı);
  // yalnızca bilinen güvenli durumlar eşlenir, gerisi genel mesajdır.
  // Tam çıktı sunucu günlüğündedir (drainQueue .catch).
  if (!raw) return 'İndirme başarısız oldu.'
  if (/private|login required|sign in/i.test(raw)) return 'Bu kaynak giriş gerektiriyor veya gizli.'
  if (/unavailable|removed|deleted|not available/i.test(raw)) return 'Kaynak artık kullanılamıyor veya kaldırılmış.'
  if (/429|too many requests|rate.?limit/i.test(raw)) return 'Kaynak geçici olarak istekleri sınırlıyor. Biraz sonra tekrar deneyin.'
  if (/403|forbidden|denied/i.test(raw)) return 'Kaynak erişimi engellendi. Farklı bir kaynak deneniyor.'
  if (/timeout|timed out|network|connection/i.test(raw)) return 'Ağ zaman aşımı. Tekrar deneyin.'
  if (/age|confirm your age/i.test(raw)) return 'Bu içerik yaş doğrulaması gerektiriyor.'
  if (/geo|region|blocked in your country/i.test(raw)) return 'Bu içerik bölgenizde kullanılamıyor.'
  if (/premiere|upcoming|live event/i.test(raw)) return 'Bu yayın henüz başlamamış veya canlı etkinlik.'
  return 'İndirme başarısız oldu.'
}

class AudioDownloader {
  get cacheBytes() {
    return cacheBytesTotal
  }

  reconcileCache() {
    this.evictStalePartials()
    const files = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(DOWNLOADS_DIR, e.name))
    cacheBytesTotal = scanCacheBytes()
    trackedCacheFiles.clear()
    for (const file of files) trackedCacheFiles.add(file)
    return cacheBytesTotal
  }

  // Aktif olmayan yarım indirmeler (.part) diskte birikir ve önbellek kotasını
  // sessizce şişirir; follow stream error durumunda bunları asla okumaz.
  evictStalePartials(maxAgeMs = STALE_PART_MS) {
    const cutoff = Date.now() - maxAgeMs
    for (const entry of fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.part')) continue
      const full = path.join(DOWNLOADS_DIR, entry.name)
      try { if (fs.statSync(full).mtimeMs < cutoff) { this.forgetCachedFile(full); fs.rmSync(full, { force: true }) } } catch {}
    }
  }

  // Deneme aralarında yalnızca geçici dosyaları temizler (başarısız denemenin .part'ı,
  // sonraki denemenin "zaten indirilmiş" sanmasına yol açmasın).
  cleanupParts(trackId) {
    for (const suffix of ['.part', '.ytdl', ...AUDIO_EXTS.map((e) => `${e}.part`), ...AUDIO_EXTS.map((e) => `${e}.ytdl`)]) {
      try { fs.rmSync(path.join(DOWNLOADS_DIR, `${trackId}${suffix}`), { force: true }) } catch {}
    }
  }

  // Önceki başarısız denemeden kalan kalıntıları temizler: yt-dlp hedef adda dosya
  // görünce "already downloaded" deyip atlar; 10KB altı dosyalar getCachedFile'a
  // takılmaz ama yeni indirmeyi bozar. Yeni deneme her zaman taze başlamalı.
  cleanupTrackArtifacts(trackId) {
    const names = new Set([`${trackId}.part`])
    for (const ext of AUDIO_EXTS) {
      names.add(`${trackId}${ext}`)
      names.add(`${trackId}${ext}.part`)
      names.add(`${trackId}${ext}.ytdl`)
    }
    for (const name of names) {
      const full = path.join(DOWNLOADS_DIR, name)
      const isTemp = name.endsWith('.part') || name.endsWith('.ytdl')
      try {
        if (isTemp || fs.statSync(full).size <= 10_000) {
          this.forgetCachedFile(full)
          fs.rmSync(full, { force: true })
        }
      } catch {}
    }
  }

  registerCachedFile(file) {
    if (trackedCacheFiles.has(file)) return
    try { cacheBytesTotal += fs.statSync(file).size; trackedCacheFiles.add(file) } catch {}
  }

  forgetCachedFile(file) {
    if (!trackedCacheFiles.has(file)) return
    try { cacheBytesTotal = Math.max(0, cacheBytesTotal - fs.statSync(file).size); trackedCacheFiles.delete(file) } catch {}
  }

  evictCache(requiredBytes = 0, protectedTrackId = '') {
    if (cacheBytesTotal + requiredBytes <= MAX_CACHE_BYTES) return true
    const candidates = []
    for (const file of trackedCacheFiles) {
      if (file.includes(`${path.sep}${protectedTrackId}.`) || file.endsWith('.part')) continue
      try { candidates.push({ file, mtime: fs.statSync(file).mtimeMs }) } catch {}
    }
    candidates.sort((a, b) => a.mtime - b.mtime)
    for (const { file } of candidates) {
      if (cacheBytesTotal + requiredBytes <= MAX_CACHE_BYTES) break
      this.forgetCachedFile(file)
      try { fs.rmSync(file, { force: true }) } catch {}
    }
    return cacheBytesTotal + requiredBytes <= MAX_CACHE_BYTES
  }

  getCachedFile(trackId) {
    for (const ext of AUDIO_EXTS) {
      const candidate = path.join(DOWNLOADS_DIR, `${trackId}${ext}`)
      try { const stat = fs.statSync(candidate); if (stat.isFile() && stat.size > 10_000) return candidate } catch {}
    }
    return null
  }

  reconcileTrack(trackId) {
    const cached = this.getCachedFile(trackId)
    if (!cached) markTrackDownloadMissing(trackId)
    return cached
  }

  getPartialFile(trackId) {
    for (const ext of AUDIO_EXTS) {
      const candidate = path.join(DOWNLOADS_DIR, `${trackId}${ext}.part`)
      try { if (fs.statSync(candidate).isFile()) return candidate } catch {}
    }
    return null
  }

  isDownloadActive(trackId) {
    const state = activeDownloads.get(trackId)
    return Boolean(state && ['queued', 'downloading'].includes(state.status))
  }

  get activeDownloadCount() {
    return activeDownloadJobs
  }

  get queuedDownloadCount() {
    return pendingDownloads.length
  }

  // 403/429'da yt-dlp tekrar deniyor; ekstra adaylar da var. Gerçek kullanıcıda tek şarkı çalındığı için
  // bu tutarlı: art arda 5+ indirme (e2e testi gibi) YouTube'u geçici engelleyebiliyor.

  createFollowStream(trackId, start = 0, { stallTimeoutMs = FOLLOW_STALL_MS, pollMs = FOLLOW_POLL_MS, maxRestarts = FOLLOW_MAX_RESTARTS, minRestartMs = FOLLOW_MIN_RESTART_MS } = {}) {
    let pos = start
    let lastProgress = Date.now()
    let timer = null
    let ended = false
    let restarts = 0
    let attemptStart = Date.now()
    let sawBytes = false
    const stream = new Readable({
      read() {},
      destroy(error, cb) { if (timer) { clearInterval(timer); timer = null } cb(error) },
    })
    // Temiz kapatma (clean FIN): akış her durumda hatasız bitirilir.
    // destroy(Error) veya destroy() Fastify'da ERR_STREAM_PREMATURE_CLOSE →
    // FST_ERR_REP_INVALID_PAYLOAD_TYPE 500'üne yol açıyordu. Kesik akışı
    // istemci (audio elementi) kendi hata mantığıyla ele alır.
    const finish = () => {
      if (ended) return
      ended = true
      if (timer) { clearInterval(timer); timer = null }
      try { stream.push(null) } catch { /* soket zaten ölmüş olabilir */ }
    }
    // Dışarıdan kapatma (istemci koptuğunda server.js çağırır): zamanlayıcıyı
    // durdurur, akışı temiz bitirir. Idempotent'tir.
    stream.closeFollow = finish
    const restartOrFinish = () => {
      if (ended) return
      if (restarts < maxRestarts && sawBytes && Date.now() - attemptStart >= minRestartMs) {
        const track = getTrack(trackId)
        if (track?.title && track?.artist) {
          restarts += 1
          attemptStart = Date.now()
          lastProgress = Date.now()
          sawBytes = false
          this.startBackgroundDownload(track)
          return
        }
      }
      return finish()
    }
    let polling = false
    const poll = async () => {
      if (ended) return
      if (polling) return
      polling = true
      const full = this.getCachedFile(trackId)
      const partial = full ? null : this.getPartialFile(trackId)
      const file = partial || full
      try {
        if (file) {
          const stat = await fs.promises.stat(file)
          const size = stat.size
          if (size > pos) {
            const handle = await fs.promises.open(file, 'r')
            try {
              const chunk = Buffer.alloc(Math.min(FOLLOW_CHUNK_BYTES, size - pos))
              const { bytesRead } = await handle.read(chunk, 0, chunk.length, pos)
              pos += bytesRead
              if (bytesRead > 0) { sawBytes = true; lastProgress = Date.now(); stream.push(chunk.subarray(0, bytesRead)) }
            } finally { await handle.close() }
          }
          if (full && pos >= size) return finish()
          if (partial) {
            const state = activeDownloads.get(trackId)
            if (!state || state.status === 'error' || state.status === 'completed') return restartOrFinish()
          }
        } else {
          const state = activeDownloads.get(trackId)
          if (!state || state.status === 'error' || state.status === 'completed') return restartOrFinish()
        }
        if (Date.now() - lastProgress > stallTimeoutMs) return finish()
      } catch { return finish() } finally {
        polling = false
      }
    }
    timer = setInterval(() => { void poll() }, pollMs)
    timer.unref?.()
    void poll()
    return stream
  }

  async findDownloadableSource(track, { searchBudgetMs = 30_000, perVariantMs = 14_000 } = {}) {
    const artist = String(track?.artist || '').trim()
    const title = String(track?.title || '').trim()
    if (!title) return null
    const expectedDuration = Number(track?.duration) || 0
    const started = Date.now()
    const ytBudgetMs = Math.min(searchBudgetMs, 20_000)

    // SoundCloud kaynaklı bir parça (aramadan SC sonucu seçildi): kullanıcının seçtiği
    // SÜRÜM budur (remix/cover/SC özgü yayın) — resmi kaynaklar farklı bir kayıt getirir.
    // Önce doğrudan SC ID'siyle akış alınır; olmazsa resmi kaynaklara düşülür.
    const isSoundCloudTrack = String(track.source || '').toLowerCase() === 'soundcloud' && track.source_id
    if (isSoundCloudTrack) {
      const direct = await this.findSoundCloudSource(track, Math.min(searchBudgetMs, 12_000)).catch(() => null)
      if (direct) return direct
    }

    // YouTube kaynaklı bir parça (aramadan YT sonucu seçildi): doğrudan video ID'siyle
    // indirilir — eşleşme yok, seçilen kayıt birebir çalınır. Yedek adaylar için
    // tek sorguluk arama da yapılır; doğrudan indirme başarısız olursa yedekler devreye girer.
    const isYouTubeTrack = String(track.source || '').toLowerCase() === 'youtube' && track.source_id
    if (isYouTubeTrack) {
      const direct = await this.findYouTubeCandidates(track, expectedDuration, started, Math.min(searchBudgetMs, 8_000), perVariantMs)
        .catch(() => ({ best: null, alternatives: [] }))
      if (direct?.best) return { ...direct.best, alternatives: direct.alternatives || [] }
    }

    // Katalogdan seçilmiş bir parçada Deezer'i öncele: YouTube araması daha hızlı
    // döndüğünde aynı isimli başka bir şarkının kazanması engellenir. YouTube/SoundCloud
    // sonucu seçilmişse doğrudan kaynak kimliği zaten üstte birebir korunur.
    const preferCatalog = ['spotify', 'curated'].includes(String(track.source || '').toLowerCase())
    // Deezer ve YouTube yarışır (ikisi de resmi kaynaklar).
    // YT_DISABLE=1 / DZ_DISABLE=1: test amaçlı kaynak kapatma (normal çalışmada set edilmez).
    const ytPromise = process.env.YT_DISABLE === '1'
      ? Promise.resolve({ best: null, alternatives: [] })
      : this.findYouTubeCandidates(track, expectedDuration, started, ytBudgetMs, perVariantMs)
          .catch(() => ({ best: null, alternatives: [] }))
    const deezerPromise = process.env.DZ_DISABLE === '1'
      ? Promise.resolve(null)
      : this.findDeezerSource(track, expectedDuration, started, Math.min(searchBudgetMs, 4_000))
          .catch(() => null)

    if (preferCatalog) {
      // İki arama paralel başlar; Deezer sonucu hazırsa hemen onu kullan, yoksa
      // zaten ilerlemiş olan YouTube adaylarına dön. Böylece doğruluk önceliği
      // oynatmayı gereksiz yere 20 saniye bekletmez.
      const deezer = await deezerPromise
      if (deezer) return deezer
      const youtube = await ytPromise
      if (youtube?.best) return { ...youtube.best, alternatives: youtube.alternatives }
    } else {
      const raced = await new Promise((resolve) => {
        let remaining = 2
        const done = (result) => {
          if (result) return resolve(result)
          remaining -= 1
          if (remaining === 0) resolve(null)
        }
        deezerPromise.then((source) => done(source))
        ytPromise.then((yt) => done(yt?.best ? { ...yt.best, alternatives: yt.alternatives } : null))
      })
      if (raced) return raced
    }

    // Son çare: SoundCloud — Spotify/Deezer/YouTube'ta bulunamayan parçalar (remix,
    // cover, enstrümantal, SC özgü yayınlar) buradan gelir.
    const remainingBudget = Math.max(4_000, searchBudgetMs - (Date.now() - started))
    return this.findSoundCloudSource(track, remainingBudget).catch(() => null)
  }

  // SoundCloud kaynağı: SC'den seçilmiş bir parça ise doğrudan ID ile (eşleşme hatası
  // imkânsız), değilse sanatçı+başlık aramasıyla katı eşikle (60/0.4) eşleştirilir.
  async findSoundCloudSource(track, budgetMs) {
    const artist = String(track?.artist || '').trim()
    const title = String(track?.title || '').trim()
    if (!title) return null
    const expectedDuration = Number(track?.duration) || 0
    const deadline = Date.now() + Math.max(3_000, budgetMs)

    if (String(track.source || '').toLowerCase() === 'soundcloud' && track.source_id) {
      try {
        const stream = await getSoundCloudFullStream(String(track.source_id))
        if (stream?.url) return { url: stream.url, title, source: 'soundcloud', duration: stream.duration, scId: String(track.source_id) }
      } catch {}
      if (Date.now() > deadline) return null
    }

    const query = artist && !GENERIC_ARTISTS.has(artist.toLowerCase()) ? `${artist} ${title}` : title
    const candidates = await searchSoundCloudTracks(query, { limit: 10 }).catch(() => [])
    const cfg = SOURCE_CFG.soundcloud
    const scored = candidates.map((c) => {
      // SC'de sanatçı ayrı alanda (user): skorlama başlığı birleştirerek yapılır.
      const proxy = { ...c, title: `${c.user || ''} ${c.title || ''}`.trim(), duration: c.duration }
      pickBestCandidate([proxy], artist, title, expectedDuration, 'soundcloud')
      c._score = proxy._score
      c._coverage = proxy._coverage
      return c
    })
      .filter((c) => c?.id && c._score >= cfg.threshold && c._coverage >= cfg.minCoverage && (!c.duration || c.duration >= 30))
      .sort((a, b) => b._score - a._score)
    for (const candidate of scored.slice(0, 2)) {
      if (Date.now() > deadline) break
      try {
        const stream = await getSoundCloudFullStream(candidate.id)
        if (stream?.url) return { url: stream.url, title: candidate.title, source: 'soundcloud', duration: stream.duration, scId: String(candidate.id) }
      } catch {}
    }
    return null
  }

  // YouTube adaylarını skorlayıp en iyi 1 + yedek 2 adayı döndürür. İndirme 403 verirse
  // yedek adaylar denenir ("bazen hiç çalmıyor" senaryosunu kapatır).
  async findYouTubeCandidates(track, expectedDuration, started, budgetMs, perVariantMs) {
    const artist = String(track?.artist || '').trim()
    const title = String(track?.title || '').trim()
    // YouTube kaynaklı parça (aramadan YT sonucu): doğrudan video ID'si indirilir;
    // yedek adaylar için yalnızca tek sorguluk hızlı arama yapılır.
    if (String(track?.source || '').toLowerCase() === 'youtube' && track.source_id) {
      const videoId = String(track.source_id)
      const direct = { url: `https://www.youtube.com/watch?v=${videoId}`, title, source: 'youtube', videoId }
      const altList = []
      try {
        const candidates = await searchYouTubeTracks(`${artist} ${title}`.trim(), { limit: 10, timeoutMs: 5_000 })
        for (const c of candidates) {
          if (!c?.id || c.id === videoId || altList.length >= 3) continue
          altList.push({ url: c.url || `https://www.youtube.com/watch?v=${c.id}`, title: c.title, source: 'youtube', videoId: c.id })
        }
      } catch {}
      return { best: direct, alternatives: altList }
    }
    let fallbackBest = null
    const altList = []
    for (const query of buildSearchQueries(artist, title)) {
      if (Date.now() - started > budgetMs) break
      let candidates = []
      try {
        candidates = await searchYouTubeTracks(query, { limit: 20, timeoutMs: 6_000 })
      } catch {
        candidates = await this.searchYouTubeViaYtdlp(query, Math.min(perVariantMs, 12_000))
      }
      if (!candidates.length) continue
      // DİKKAT: kanal adı başlığa EKLENMEZ – kanal adı şarkı adıyla çakışırsa
      // ("Rüzgar" adlı lyrics kanalı, "Yalnız Ölür" kanalı vb.) coverage yapay şişer
      // ve alakasız video yanlışlıkla seçilir. Kanal örtüşmesi ayrı +15 bonus'tur.
      const scored = candidates.map((c) => {
        const proxy = { ...c, title: c.title, _origTitle: c.title }
        pickBestCandidate([proxy], artist, title, expectedDuration, 'youtube')
        return { ...proxy, _score: proxy._score, _coverage: proxy._coverage }
      })
        // Sıkı eşik: skor düşükse (ör. sadece bir token örtüşmesi) aday elenir – yanlış parça çalınmasın.
        .filter((c) => c._score >= SOURCE_CFG.youtube.threshold && c._coverage >= SOURCE_CFG.youtube.minCoverage && (c.duration === 0 || c.duration >= 30))
        .sort((a, b) => b._score - a._score)
      for (const picked of scored) {
        const url = picked?.url || (picked?.id ? `https://www.youtube.com/watch?v=${picked.id}` : '')
        if (!url) continue
        const label = picked._origTitle || picked.title
        const entry = { url, title: label, source: 'youtube', videoId: picked.id }
        // En güçlü eşleşme "best" olur; daha zayıflar yedek aday olarak kalır.
        if (picked._score >= SOURCE_CFG.youtube.fallbackScore && picked._coverage >= SOURCE_CFG.youtube.fallbackCoverage && !fallbackBest) fallbackBest = entry
        else if (altList.length < 5 && !altList.some((a) => a.url === url)) altList.push(entry)
      }
      if (fallbackBest) break
    }
    if (fallbackBest) return { best: fallbackBest, alternatives: altList.filter((a) => a.url !== fallbackBest.url) }
    const top = altList[0]
    return { best: top || null, alternatives: altList.slice(1) }
  }

  // InnerTube uçları değişir/engellenirse devreye giren yedek. Yavaş ama çalışır.
  async searchYouTubeViaYtdlp(query, timeoutMs) {
    try {
      const info = await ytdl(`ytsearch6:${query}`, {
        quiet: true, noWarnings: true, noPlaylist: true, skipDownload: true,
        dumpSingleJson: true, flatPlaylist: true, socketTimeout: 8, retries: 1,
      }, { timeout: timeoutMs, killSignal: 'SIGKILL' })
      const entries = Array.isArray(info?.entries) ? info.entries : info ? [info] : []
      return entries.filter((e) => e?.id).map((e) => ({
        id: e.id,
        title: String(e.title || ''),
        channel: String(e.channel || e.uploader || ''),
        duration: Number(e.duration) || 0,
        url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
      }))
    } catch { return [] }
  }

  async findDeezerSource(track, expectedDuration, started, budgetMs) {
    if (!hasDeezerAuth()) return null
    const artist = String(track?.artist || '').trim()
    const title = String(track?.title || '').trim()
    const seen = new Set()
    // Deezer'a özel sorgular: "official audio" gibi YouTube kalıpları Deezer aramasını bozar (0 sonuç).
    // Sanatçı + şarkı adı (tireli ve tiresiz) en hedefli sonucu verir.
    const queries = [...new Set([`${artist} ${title}`, `${artist} - ${title}`])].filter(Boolean)
    // İki sorguyu paralel at: biri yavaş olursa diğeri beklenmez.
    const results = await Promise.allSettled(queries.map((query) => searchDeezerTracks(query, { limit: 10 }).catch(() => [])))
    for (const result of results) {
      if (Date.now() - started > budgetMs) break
      const candidates = result.status === 'fulfilled' ? result.value : []
      const scored = candidates.map((c) => {
        // Deezer sanatçıyı ayrı alanda döndürüyor; skorlama başlık üzerinden yapıldığı için birleştir.
        const proxy = { ...c, title: `${c.user || ''} ${c.title || ''}`.trim(), duration: c.duration }
        pickBestCandidate([proxy], artist, title, expectedDuration, 'deezer')
        c._score = proxy._score
        c._coverage = proxy._coverage
        return c
      })
        // Deezer resmi katalog: eşik YouTube'dan düşük (55) ama tek-token/sanatçı kuralları yanlış adayı eler.
        .filter((c) => c?.id && !seen.has(c.id) && c._score >= SOURCE_CFG.deezer.threshold && c._coverage >= SOURCE_CFG.deezer.minCoverage && (c.duration === 0 || c.duration >= 30))
        .sort((a, b) => b._score - a._score)
      for (const candidate of scored.slice(0, 2)) {
        seen.add(candidate.id)
        try {
          const stream = await getDeezerTrackStream(candidate.id)
          if (stream?.url) return { url: stream.url, title: candidate.title || stream.title, source: 'deezer', duration: stream.duration, sngId: candidate.id }
        } catch {}
      }
    }
    return null
  }

  async downloadDeezerSync(source, trackId, trackData) {
    const partPath = path.join(DOWNLOADS_DIR, `${trackId}.mp3.part`)
    const finalPath = path.join(DOWNLOADS_DIR, `${trackId}.mp3`)
    const decryptor = createDeezerDecryptor(source.sngId)
    const expected = Number(source.filesize) || 0
    const expectedMinBytes = Math.round((Number(trackData.duration) || 0) * 12_000)
    const minBytes = expectedMinBytes > 100_000 ? expectedMinBytes : 800_000
    const res = await fetch(source.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(10 * 60_000),
    })
    if (!res.ok || !res.body) throw new Error(`Deezer indirme ${res.status}`)
    const total = expected > 0 ? expected : Number(res.headers.get('content-length')) || 0
    let received = 0
    const fd = fs.openSync(partPath, 'w')
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        // Şişirilmiş/bozuk yanıt diski doldurmadan durdurulur.
        if (received > MAX_DOWNLOAD_BYTES) {
          try { await reader.cancel() } catch {}
          throw new Error('Deezer yanıtı boyut sınırını aştı.')
        }
        for (const chunk of decryptor.write(value)) fs.writeSync(fd, chunk)
        if (total > 0) setDownloadState(trackId, { status: 'downloading', progress: Math.min(99, Math.round((received / total) * 100)) })
      }
      const tail = decryptor.end()
      if (tail.length) fs.writeSync(fd, tail)
    } catch (error) {
      try { fs.closeSync(fd) } catch {}
      fs.rmSync(partPath, { force: true })
      throw error
    }
    try { fs.closeSync(fd) } catch {}
    if (fs.statSync(partPath).size < minBytes) {
      fs.rmSync(partPath, { force: true })
      throw new Error('Deezer tam parçası alınamadı (yalnızca önizleme erişimi olabilir).')
    }
    // Windows'ta rename hedef dosya varsa EPERM verebilir; önce eskiyi kaldır.
    try { fs.rmSync(finalPath, { force: true }) } catch {}
    fs.renameSync(partPath, finalPath)
    return finalPath
  }

  // Tek adayı yt-dlp ile indirir. done=true ise getCachedFile(trackId) doludur.
  // YouTube adaylarında istemci zinciri denenir (android → ios → tv →
  // web_embedded → default); veri merkezi bot engeli istemciden istemciye değişir.
  // YT_EXTRACTOR_ARGS ham eklenir (örn. PO token).
  async tryYtdlpCandidate(trackId, candidate, attemptNo, outputTemplate) {
    if (candidate.source === 'youtube' && process.env.YT_DISABLE === '1') {
      return { done: false, error: new Error('YouTube devre dışı (YT_DISABLE).') }
    }
    if (candidate.source === 'youtube' && ytCircuitOpen()) {
      return { done: false, error: new Error('YouTube bot engeli (devre kesici açık, yedek kaynağa geçiliyor).') }
    }
    if (candidate.source === 'youtube') lastYtProbeAt = Date.now()
    const clientAttempts = candidate.source === 'youtube'
      ? ['android', 'ios', 'tv', 'web_embedded', 'default']
      : ['default']
    let lastError = null
    for (let spawn = 0; spawn < clientAttempts.length; spawn += 1) {
      if (spawn > 0) {
        console.log(`[AudioDownloader] ${trackId} aday #${attemptNo + 1} başarısız/bot engeli, ${clientAttempts[spawn]} istemcisiyle yeniden deneniyor`)
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
      const ytClient = clientAttempts[spawn]
      const ytArgs = [
        ytClient === 'default' ? '' : `youtube:player_client=${ytClient}`,
        YT_EXTRACTOR_ARGS,
      ].filter(Boolean).join(';')
      const subprocess = ytdl.exec(candidate.url, {
        // webm/opus önce: m4a'dan hızlı iniyor ve kısmi .part dosyası tarayıcıda çalabiliyor.
        format: 'bestaudio[ext=webm]/bestaudio[acodec=opus]/bestaudio[ext=m4a]/bestaudio/best',
        output: outputTemplate,
        noWarnings: true, noPlaylist: true, newline: true,
        maxFilesize: String(MAX_DOWNLOAD_BYTES), socketTimeout: 15,
        retries: spawn === 0 ? 3 : 2, fragmentRetries: 3, concurrentFragments: 4,
        retrySleep: 2,
        ...(candidate.source === 'youtube' && ytArgs ? { extractorArgs: ytArgs } : {}),
      }, { timeout: 10 * 60_000, killSignal: 'SIGKILL' })
      runningProcesses.set(trackId, subprocess)
      const parseProgress = (chunk) => {
        const text = String(chunk)
        const matches = [...text.matchAll(/\[download\]\s+([\d.]+)%/g)]
        const last = matches.at(-1)
        if (last) setDownloadState(trackId, { status: 'downloading', progress: Math.min(99, Number(last[1]) || 0) })
      }
      subprocess.stdout?.on('data', parseProgress)
      subprocess.stderr?.on('data', parseProgress)
      try {
        await subprocess
      } catch (error) {
        lastError = error
        runningProcesses.delete(trackId)
        this.cleanupParts(trackId)
        continue // bot engeli vb.: sonraki istemci denemesi
      }
      const produced = this.getCachedFile(trackId)
      if (produced) return { done: true, error: null }
      // Çıkış 0 ama dosya yok: max-filesize sessiz abort'u — part'ları temizle
      // ve sonraki istemci/yedek adayla devam et.
      this.cleanupParts(trackId)
    }
    return { done: false, error: lastError }
  }

  // Doğrudan medya URL'sini (SoundCloud progressive vb.) yt-dlp'siz indirir:
  // daha hızlı, daha az RAM, bot kontrolüne takılmaz. Boyut sınırı akış sırasında.
  async downloadDirectUrl(url, trackId, ext = '.mp3') {
    const partPath = path.join(DOWNLOADS_DIR, `${trackId}${ext}.part`)
    const finalPath = path.join(DOWNLOADS_DIR, `${trackId}${ext}`)
    const res = await fetch(String(url), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(5 * 60_000),
    })
    if (!res.ok || !res.body) throw new Error(`Doğrudan indirme başarısız (${res.status}).`)
    let received = 0
    const fd = fs.openSync(partPath, 'w')
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        if (received > MAX_DOWNLOAD_BYTES) {
          try { await reader.cancel() } catch {}
          throw new Error('Dosya izin verilen boyutu aşıyor.')
        }
        fs.writeSync(fd, value)
      }
    } catch (error) {
      try { fs.closeSync(fd) } catch {}
      fs.rmSync(partPath, { force: true })
      throw error
    }
    try { fs.closeSync(fd) } catch {}
    try { fs.rmSync(finalPath, { force: true }) } catch {}
    fs.renameSync(partPath, finalPath)
    return finalPath
  }

  async downloadTrackSync(input) {
    const trackData = saveOrUpdateTrack(input)
    const trackId = trackData.id
    const cached = this.getCachedFile(trackId)
    if (cached) {
      setTerminalState(trackId, { status: 'completed', progress: 100, file_path: cached })
      return cached
    }
    if (!this.evictCache(0, trackId)) {
      const error = 'İndirme önbelleği kotası dolu.'
      setTerminalState(trackId, { status: 'error', progress: 0, error })
      throw new Error(error)
    }
    this.cleanupTrackArtifacts(trackId)

    setDownloadState(trackId, { status: 'downloading', progress: 0 })
    try {
      let source = await this.findDownloadableSource(trackData)
      if (!source) throw new Error('Aramada uygun kaynak bulunamadı.')
      console.log(`[AudioDownloader] ${trackId} kaynak: ${source.source} — ${source.title}`)
      if (source.source === 'deezer') {
        try {
          const downloadedFile = await this.downloadDeezerSync(source, trackId, trackData)
          const fileSize = fs.statSync(downloadedFile).size
          if (fileSize > MAX_DOWNLOAD_BYTES) {
            this.forgetCachedFile(downloadedFile)
            fs.rmSync(downloadedFile, { force: true })
            throw new Error('Dosya izin verilen boyutu aşıyor.')
          }
          this.registerCachedFile(downloadedFile)
          const fileName = `${sanitizeFilename(trackData.artist) || 'Artist'} - ${sanitizeFilename(trackData.title) || trackId}${path.extname(downloadedFile)}`
          saveOrUpdateTrack({ ...trackData, file_path: downloadedFile, file_name: fileName, file_size: fileSize, is_downloaded: true })
          await mirrorToR2(trackId, downloadedFile)
          setTerminalState(trackId, { status: 'completed', progress: 100, file_name: fileName, file_url: `/api/stream/${encodeURIComponent(trackId)}` })
          return downloadedFile
        } catch (error) {
          // Önizleme-only (free) ARL veya bozuk Deezer yanıtı: ölü çıkış yok,
          // YT adaylarına düş; onlar da yoksa SC yedeği aşağıdaki blokta denenir.
          console.log(`[AudioDownloader] ${trackId} Deezer yetersiz (${error?.message || error}), YT/SC yedeğine geçiliyor`)
          const ytFallback = await this.findYouTubeCandidates(trackData, Number(trackData.duration) || 0, Date.now(), 8_000, 10_000).catch(() => null)
          if (ytFallback?.best) {
            source = { ...ytFallback.best, alternatives: ytFallback.alternatives || [] }
            console.log(`[AudioDownloader] ${trackId} yedek kaynak: youtube — ${source.title}`)
          } else {
            throw error
          }
        }
      }

      const outputTemplate = path.join(DOWNLOADS_DIR, `${trackId}.%(ext)s`)
      // webm/opus önce: m4a'dan ~1.4 sn hızlı iniyor ve konteyner baştan çözülebildiği için
      // yarısı inmiş .part dosyası tarayıcıda çalabiliyor (m4a'nın moov atomu dosyanın sonunda).
      const attemptUrls = [source, ...(source.alternatives || [])]
      let lastError = null
      let originSource = source.source
      let ytSucceeded = false
      const hadYoutube = attemptUrls.some((c) => c.source === 'youtube')
      for (let attempt = 0; attempt < attemptUrls.length; attempt += 1) {
        const candidate = attemptUrls[attempt]
        const result = await this.tryYtdlpCandidate(trackId, candidate, attempt, outputTemplate)
        if (result.error && !lastError) lastError = result.error
        if (result.done) {
          if (candidate.source === 'youtube') ytSucceeded = true
          break
        }
        if (attempt < attemptUrls.length - 1) {
          console.log(`[AudioDownloader] ${trackId} aday #${attempt + 1} başarısız, yedek deneniyor (${candidate.title?.slice(0, 40)})`)
          await new Promise((resolve) => setTimeout(resolve, 600))
        }
      }

      // Çapraz kaynak yedekliği: YouTube adaylarının tamamı bot engeline takılırsa
      // (veri merkezi IP'si), aynı parça SoundCloud'dan aranıp indirilir.
      // SC doğrudan URL'leri CDN'den gelir, YT bot kontrolüne takılmaz.
      if (ytSucceeded) {
        // YouTube çalışıyormuş — devre kesici sıfırlanır.
        if (ytBotStreak >= YT_CIRCUIT_THRESHOLD) console.log('[AudioDownloader] YouTube engeli kalkmış görünüyor — devre kesici kapatıldı.')
        ytBotStreak = 0
      }
      if (!this.getCachedFile(trackId) && source.source !== 'soundcloud' && source.source !== 'deezer') {
        if (hadYoutube && !ytSucceeded) {
          ytBotStreak += 1
          if (ytBotStreak === YT_CIRCUIT_THRESHOLD) {
            console.log(`[AudioDownloader] YouTube üst üste ${ytBotStreak} kez engellendi — devre kesici açıldı, ${YT_CIRCUIT_COOLDOWN_MS / 60_000} dk boyunca YT atlanıp yedek kaynak denenecek.`)
          }
        }
        try {
          const sc = await this.findSoundCloudSource(trackData, 12_000).catch(() => null)
          if (sc?.url) {
            console.log(`[AudioDownloader] ${trackId} YT tıkandı, SoundCloud yedeği deneniyor — ${(sc.title || '').slice(0, 60)}`)
            if (sc.protocol === 'hls') {
              const result = await this.tryYtdlpCandidate(trackId, { url: sc.url, title: sc.title, source: 'soundcloud' }, 0, outputTemplate)
              if (result.error && !lastError) lastError = result.error
            } else {
              await this.downloadDirectUrl(sc.url, trackId)
            }
            if (this.getCachedFile(trackId)) originSource = 'soundcloud'
          }
        } catch (error) {
          if (!lastError) lastError = error
        }
      }

      const downloadedFile = this.getCachedFile(trackId)
      if (!downloadedFile) throw lastError || new Error('İndirilen ses dosyası doğrulanamadı.')
      const fileSize = fs.statSync(downloadedFile).size
      if (fileSize > MAX_DOWNLOAD_BYTES) {
        this.forgetCachedFile(downloadedFile)
        fs.rmSync(downloadedFile, { force: true })
        throw new Error('Dosya izin verilen boyutu aşıyor.')
      }
      if (originSource === 'soundcloud' || originSource === 'youtube') {
        // Tam parça ~12KB/sn (128kbps); %33 doluluğun altı kesin kesik/bozuk indirmedir
        // (bot engeli snippet'i, yanlış kısa video). SoundCloud daha katı: preview tuzakları.
        const bytesPerSecond = originSource === 'soundcloud' ? 12_000 : 4_000
        const expectedMinBytes = Math.round((Number(trackData.duration) || 0) * bytesPerSecond)
        const minBytes = expectedMinBytes > 100_000 ? expectedMinBytes : (originSource === 'soundcloud' ? 800_000 : 120_000)
        if (fileSize < minBytes) {
          this.forgetCachedFile(downloadedFile)
          fs.rmSync(downloadedFile, { force: true })
          throw new Error(originSource === 'soundcloud'
            ? 'SoundCloud tam parçası alınamadı (yalnızca önizleme erişimi olabilir).'
            : 'Ses dosyası tam inmedi (kaynak kesildi veya bot engellendi).')
        }
      }
      this.registerCachedFile(downloadedFile)
      const fileName = `${sanitizeFilename(trackData.artist) || 'Artist'} - ${sanitizeFilename(trackData.title) || trackId}${path.extname(downloadedFile)}`
      saveOrUpdateTrack({ ...trackData, file_path: downloadedFile, file_name: fileName, file_size: fileSize, is_downloaded: true })
      await mirrorToR2(trackId, downloadedFile)
      setTerminalState(trackId, { status: 'completed', progress: 100, file_name: fileName, file_url: `/api/stream/${encodeURIComponent(trackId)}` })
      return downloadedFile
    } catch (error) {
      // Hata durumunda kalıntılar tamamen temizlenir: follow stream error state'te
      // bu dosyaları asla okumaz, diskte tutmak yalnızca kotayı şişirir.
      this.cleanupTrackArtifacts(trackId)
      markTrackDownloadMissing(trackId)
      setTerminalState(trackId, { status: 'error', error: extractYtError(error), progress: 0 })
      throw error
    } finally {
      runningProcesses.delete(trackId)
    }
  }

  startBackgroundDownload(trackData, { priority = false } = {}) {
    const trackId = trackData.id
    const current = activeDownloads.get(trackId)
    if (current && ['downloading', 'queued'].includes(current.status)) {
      // Zaten sırada bekliyorsa ve artık kullanıcı bunu dinlemek istiyorsa öne al.
      if (priority && current.status === 'queued') {
        const at = pendingDownloads.findIndex((t) => t.id === trackId)
        if (at > 0) {
          const [item] = pendingDownloads.splice(at, 1)
          item._priority = true
          pendingDownloads.unshift(item)
          this.drainQueue()
        }
      }
      return { started: false, state: current }
    }
    if (shuttingDown) return { started: false, state: { status: 'error', progress: 0, error: 'Sunucu kapanıyor.' } }
    if (pendingDownloads.length >= MAX_PENDING_DOWNLOADS) {
      return { started: false, state: { status: 'error', progress: 0, error: 'İndirme kuyruğu dolu.', code: 'DOWNLOAD_QUEUE_FULL' } }
    }
    // Aynı parça hem bekleyen kuyrukta hem işlemde teklenir (çift yt-dlp / .part yarışı önlenir).
    if (inflightDownloads.has(trackId) || pendingDownloads.some((t) => t.id === trackId)) {
      return { started: false, state: activeDownloads.get(trackId) || { status: 'queued', progress: 0 } }
    }
    setDownloadState(trackId, { status: 'queued', progress: 0 })
    const item = { ...trackData, _priority: priority }
    if (priority) pendingDownloads.unshift(item)
    else pendingDownloads.push(item)
    this.drainQueue()
    return { started: true, state: activeDownloads.get(trackId) }
  }

drainQueue() {
    while (!shuttingDown && pendingDownloads.length) {
      // Öncelikli (kullanıcı çalmak istediği) işler için ek slot: ön-ısıtmalar dinlemeyi geciktirmesin.
      const isPriority = Boolean(pendingDownloads[0]?._priority)
      const limit = isPriority ? MAX_CONCURRENT_DOWNLOADS + PRIORITY_EXTRA_SLOTS : MAX_CONCURRENT_DOWNLOADS
      if (activeDownloadJobs >= limit) break
      // Bot engeli (403) art arda isteklerde tetikleniyor; ön-ısıtma (önceliksiz) indirmeleri
      // zamana yay – kullanıcının çaldığı şarkı (öncelikli) asla beklemez.
      if (!isPriority && pendingDownloads[0]?.source !== 'deezer') {
        const waitMs = PRELOAD_SPACING_MS - (Date.now() - lastSpawnAt)
        if (waitMs > 0) break
      }
      const trackData = pendingDownloads.shift()
      const trackId = trackData.id
      activeDownloadJobs += 1
      lastSpawnAt = Date.now()
      const promise = this.downloadTrackSync(trackData)
        .catch((error) => console.error(`[AudioDownloader] download failed for ${trackId}: ${error?.message || error}`))
        .finally(() => {
          activeDownloadJobs = Math.max(0, activeDownloadJobs - 1)
          inflightDownloads.delete(trackId)
          this.drainQueue()
        })
      inflightDownloads.set(trackId, promise)
    }
  }

  shutdown() {
    shuttingDown = true
    clearInterval(cacheReconcileTimer)
    for (const track of pendingDownloads.splice(0)) setTerminalState(track.id, { status: 'error', progress: 0, error: 'Sunucu kapanıyor.' })
    for (const proc of runningProcesses.values()) {
      try { proc.kill('SIGTERM') } catch {}
    }
    runningProcesses.clear()
  }
}

export const audioDownloader = new AudioDownloader()
const cacheReconcileTimer = setInterval(() => audioDownloader.reconcileCache(), 5 * 60_000)
cacheReconcileTimer.unref?.()
