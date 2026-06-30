import { useEffect, useRef, useState } from 'react'

// Wake-word phrase variants. Korean STT transcribes "자인아" inconsistently
// ("자인", "자이나", spaced, etc.), so we match against a normalized set plus a
// loose regex. Extra variants can be added via VITE_WAKEWORD (comma-separated).
const WAKE_VARIANTS = (import.meta.env.VITE_WAKEWORD || '자인,자인아,자이나,자잉,자이느,잗인,장인,자임,자인이,자인나,자나')
  .split(',')
  .map((s) => s.trim().replace(/\s+/g, ''))
  .filter(Boolean)

// Catches 자이 / 자인 / 자임 / 자잉 (and "자 인아", "자이나", "자인아" once spaces
// are stripped) — the common ways Korean STT renders "자인(아)".
const WAKE_RE = /자[이인임잉]/

const RESTART_DELAY_MS = 400   // debounce recognizer restarts
const FIRE_COOLDOWN_MS = 1500  // suppress repeat fires within this window
const MAX_ALTERNATIVES = 5     // scan several STT guesses, not just the top one

const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, '')

const matchesWake = (text) =>
  !!text && (WAKE_RE.test(text) || WAKE_VARIANTS.some((w) => text.includes(w)))

/**
 * Browser-native wake-word listener. Runs a continuous Web Speech API
 * recognizer that scans transcripts for the wake phrase ("자인아") and fires
 * `onWake` when heard. No external server required — works anywhere the app is
 * opened in Chrome/Edge with microphone permission.
 *
 * While `isSttActive` is true (the command STT — including the post-response
 * follow-up window — owns the mic) the listener is paused so the two
 * recognizers never compete for the microphone, then resumes automatically.
 */
export function useWakeWord({ onWake, isSttActive }) {
  const [isConnected, setIsConnected] = useState(false)
  const onWakeRef = useRef(onWake)
  const recRef = useRef(null)
  const cancelledRef = useRef(false)
  const runningRef = useRef(false)
  const pausedRef = useRef(false)
  const restartTimerRef = useRef(null)
  const lastFireRef = useRef(0)
  const startRef = useRef(() => {})

  useEffect(() => {
    onWakeRef.current = onWake
  }, [onWake])

  // ── Recognizer lifecycle ────────────────────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      console.warn('[wake-word] SpeechRecognition unavailable; wake word disabled')
      return
    }

    cancelledRef.current = false

    const scheduleRestart = (delay = RESTART_DELAY_MS) => {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = setTimeout(() => startRef.current(), delay)
    }

    const start = () => {
      if (cancelledRef.current || runningRef.current || pausedRef.current) return

      const rec = new SR()
      rec.lang = 'ko-KR'
      rec.continuous = true
      rec.interimResults = true
      rec.maxAlternatives = MAX_ALTERNATIVES
      recRef.current = rec

      rec.onstart = () => {
        runningRef.current = true
        setIsConnected(true)
        console.log('[wake-word] listening…')
      }

      rec.onresult = (e) => {
        if (pausedRef.current) return
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i]
          // Scan every alternative STT returned for this result, not just #1.
          for (let a = 0; a < result.length; a++) {
            const text = normalize(result[a]?.transcript)
            if (!text) continue
            // Diagnostic: see exactly what Google heard while tuning the matcher.
            console.log(`[wake-word] heard${result.isFinal ? '' : '~'}: "${text}"`)
            if (matchesWake(text)) {
              const now = Date.now()
              if (now - lastFireRef.current < FIRE_COOLDOWN_MS) return
              lastFireRef.current = now
              console.log('[wake-word] detected:', text)
              // Release the mic before the command STT recognizer starts.
              try { rec.stop() } catch { /* noop */ }
              onWakeRef.current?.({ label: 'wakeword', transcript: text })
              return
            }
          }
        }
      }

      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          console.warn('[wake-word] mic permission denied; wake word disabled')
          cancelledRef.current = true
          return
        }
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          console.warn('[wake-word] recognizer error:', e.error)
        }
      }

      rec.onend = () => {
        runningRef.current = false
        setIsConnected(false)
        if (!cancelledRef.current && !pausedRef.current) scheduleRestart()
      }

      try {
        rec.start()
      } catch {
        // start() throws if a previous instance is still winding down.
        runningRef.current = false
        scheduleRestart()
      }
    }

    startRef.current = start
    start()

    return () => {
      cancelledRef.current = true
      clearTimeout(restartTimerRef.current)
      const rec = recRef.current
      if (rec) {
        rec.onend = null // avoid restart-on-cleanup
        try { rec.stop() } catch { /* noop */ }
      }
    }
  }, [])

  // ── Pause while command STT owns the mic, resume afterward ──
  useEffect(() => {
    pausedRef.current = isSttActive
    if (isSttActive) {
      const rec = recRef.current
      if (rec) { try { rec.stop() } catch { /* noop */ } }
    } else if (!cancelledRef.current && !runningRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = setTimeout(() => startRef.current(), RESTART_DELAY_MS)
    }
  }, [isSttActive])

  return { isConnected }
}
