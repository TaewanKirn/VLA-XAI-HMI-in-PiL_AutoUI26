const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'

// Discrete speed levels. Default (normal) sits a touch slower than before and
// the steps between levels are intentionally small (~0.10) so a speed-change
// request nudges the pace rather than jumping dramatically.
export const SPEED_LEVELS = {
  slow: 0.95,
  normal: 1.05,
  fast: 1.15,
  very_fast: 1.25,
}
export const DEFAULT_SPEED_LEVEL = 'normal'
export const DEFAULT_SPEAKING_RATE = SPEED_LEVELS[DEFAULT_SPEED_LEVEL]
export const MIN_SPEAKING_RATE = 0.6
export const MAX_SPEAKING_RATE = 2.0

// ── Single-playback guard ────────────────────────────────────
// Only the most recent utterance is allowed to play. A new speakText() call
// stops whatever is currently playing and invalidates any earlier in-flight
// request or queued sentence (whose fetch may still resolve later), so voices
// never overlap. `playSeq` is bumped on every speakText() call; any async work
// (fetch, queued sentence) checks it against the seq it was started under and
// bails the moment a newer call arrives.
let currentAudio = null
let currentUrl = null
let playSeq = 0

// ── Autoplay unlock ──────────────────────────────────────────
// Chrome/Edge block HTMLAudioElement.play() until the page has received a real
// user gesture (click/keydown/touch). The phase-TTS path is driven by CARLA
// WebSocket events with NO user gesture, so the first audio.play() rejects with
// NotAllowedError and the assistant stays silent for the whole session.
//
// unlockAudio() must be called from inside a user-gesture handler (the mic tap
// / search bar click already present in the HMI). It (1) resumes a shared
// AudioContext and (2) plays a 1-frame silent HTMLAudioElement — the same
// element *type* used for real TTS — so the browser thereafter treats
// programmatic audio.play() as gesture-blessed. Idempotent and cheap; safe to
// call on every gesture.
let audioUnlocked = false
let sharedCtx = null

export function isAudioUnlocked() {
  return audioUnlocked
}

export function unlockAudio() {
  if (audioUnlocked) return
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) {
      if (!sharedCtx) sharedCtx = new Ctx()
      if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {})
    }
  } catch { /* AudioContext unavailable — fall through to the Audio() prime */ }
  try {
    // 1-frame silent WAV (44 bytes). Playing it under the gesture blesses
    // future programmatic Audio().play() calls.
    const silent = new Audio(
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
    )
    silent.volume = 0
    const p = silent.play()
    if (p && typeof p.then === 'function') p.then(() => { audioUnlocked = true }).catch(() => {})
    else audioUnlocked = true
  } catch { /* even the prime failed; first real play() may still work post-gesture */ }
  // Mark unlocked optimistically — the gesture itself is what the browser keys
  // on; the silent prime is belt-and-suspenders.
  audioUnlocked = true
}

// ── Speaking-state broadcast (echo guard) ────────────────────
// The mic (Web Speech wake-word + command STT) must not transcribe the AI's
// own TTS voice as user speech. We expose `isSpeaking()` and a subscribe()
// channel so the HMI can pause/ignore recognition for the whole duration of an
// utterance (queue start → last sentence end). `speaking` flips true the moment
// speakText() begins and false only after the final sentence's audio ends (or
// the utterance is stopped/superseded).
let speaking = false
const speakingListeners = new Set()

export function isSpeaking() {
  return speaking
}

// Subscribe to speaking-state changes. Returns an unsubscribe fn.
export function onSpeakingChange(fn) {
  speakingListeners.add(fn)
  return () => speakingListeners.delete(fn)
}

function setSpeaking(v) {
  if (speaking === v) return
  speaking = v
  for (const fn of speakingListeners) {
    try { fn(v) } catch { /* listener errors must not break playback */ }
  }
}

export function stopSpeaking() {
  // Bump the sequence so any in-flight fetch / queued sentence for the previous
  // utterance sees it's been superseded and discards itself.
  playSeq++
  setSpeaking(false)
  if (currentAudio) {
    currentAudio.onended = null
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
}

// Split a block of speech into individual sentences. Korean SA lines are
// punctuated with '.', '?', '!' (and the full-width variants). We keep the
// terminator attached to its sentence so TTS reads natural intonation, and
// drop empty fragments. If no terminator is present the whole string is one
// sentence.
function splitSentences(text) {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return []
  // Match runs up to and including a sentence terminator (ASCII or full-width).
  const parts = trimmed.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g)
  if (!parts) return [trimmed]
  return parts.map((s) => s.trim()).filter(Boolean)
}

// Fetch + decode one sentence to a playable Blob URL. Returns null if a newer
// utterance has superseded this one (seq mismatch) or the API returns no audio.
async function fetchSentenceUrl(sentence, apiKey, rate, seq) {
  const res = await fetch(`${TTS_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text: sentence },
      voice: {
        languageCode: 'ko-KR',
        name: 'ko-KR-Wavenet-A',
        ssmlGender: 'FEMALE',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: rate,
        pitch: 0,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`TTS ${res.status}: ${body.error?.message ?? 'unknown'}`)
  }

  const { audioContent } = await res.json()
  if (!audioContent) return null
  if (seq !== playSeq) return null   // superseded while fetching

  const raw = atob(audioContent)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'audio/mp3' })
  return URL.createObjectURL(blob)
}

// Play one Blob URL to completion. Resolves when the audio ends (or fails).
// Registers itself as `currentAudio` so stopSpeaking() can cut it off.
function playUrl(url, seq) {
  return new Promise((resolve) => {
    if (seq !== playSeq) { URL.revokeObjectURL(url); resolve(); return }
    const audio = new Audio(url)
    currentAudio = audio
    currentUrl = url
    const cleanup = () => {
      if (currentAudio === audio) {
        URL.revokeObjectURL(url)
        currentAudio = null
        currentUrl = null
      }
      resolve()
    }
    audio.onended = cleanup
    audio.onerror = cleanup
    audio.play().catch((err) => { console.error(err); cleanup() })
  })
}

/**
 * Sends text to Google Cloud TTS and plays it back. Multi-sentence text is
 * split on sentence terminators and each sentence is fetched + played
 * **sequentially** (the next sentence only starts after the previous audio
 * finishes) so long SA lines never get cut off mid-utterance. A new
 * speakText() call cancels any previous/in-flight queue so voices never
 * overlap. Resolves once the whole queue has finished playing.
 */
export async function speakText(text, apiKey, speakingRate = DEFAULT_SPEAKING_RATE) {
  // Claim this call as the latest and silence anything already playing/queued.
  // stopSpeaking() bumps playSeq; capture the post-bump value as our token.
  stopSpeaking()
  const seq = playSeq

  const rate = Math.min(MAX_SPEAKING_RATE, Math.max(MIN_SPEAKING_RATE, speakingRate))
  const sentences = splitSentences(text)
  if (!sentences.length) return

  // Mark the mic-echo guard active for the whole queue (start → last sentence
  // ends). Cleared in finally — but only if we're still the current utterance,
  // so a newer speakText() that already raised its own guard isn't cleared.
  setSpeaking(true)
  try {
    for (const sentence of sentences) {
      if (seq !== playSeq) return        // a newer utterance arrived — abandon queue
      const url = await fetchSentenceUrl(sentence, apiKey, rate, seq)
      if (!url) return                   // superseded or empty audio
      if (seq !== playSeq) { URL.revokeObjectURL(url); return }
      await playUrl(url, seq)            // wait for this sentence to finish first
    }
  } finally {
    if (seq === playSeq) setSpeaking(false)
  }
}
