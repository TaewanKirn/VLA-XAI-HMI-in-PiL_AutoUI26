import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Snowflake, Mic, MicOff, X, Wind, Volume, Volume1, Volume2, VolumeX, Search, ChevronLeft } from 'lucide-react'

// ── Icon imports ────────────────────────────────────────────
import iconSun from '../assets/icons/Icon-15.svg'
import iconWifi from '../assets/icons/Icon-14.svg'
import iconBattery from '../assets/icons/Icon-12.svg'
import iconHome from '../assets/icons/Icon-8.svg'
import iconChevronDown from '../assets/icons/Icon-7.svg'
import iconChevronUp from '../assets/icons/Icon-4.svg'
import iconAC from '../assets/icons/Icon-6.svg'
import iconNav from '../assets/icons/Icon-3.svg'
import iconPhone from '../assets/icons/Icon-5.svg'
import iconMusic from '../assets/icons/Icon-2.svg'
import iconMail from '../assets/icons/Icon-1.svg'
import iconCalendar from '../assets/icons/Icon.svg'
import iconMenu from '../assets/icons/Icon-13.svg'
import iconCarAlert from '../assets/icons/car-icon.svg'  // FAB — 주행 판단 과정(시각 HMI 미러)

// ── Image imports ───────────────────────────────────────────
import imgNavigation from '../assets/images/navigation.png'

// ── Service imports ─────────────────────────────────────────
import { getGeminiResponse } from './services/gemini'
import { speakText, onSpeakingChange, unlockAudio, SPEED_LEVELS, DEFAULT_SPEED_LEVEL } from './services/tts'
import { useWakeWord } from './hooks/useWakeWord'
import { useCarlaBridge } from './hooks/useCarlaBridge'
import { mapScenarioEvent as mapCarlaScenarioEvent } from './services/carlaScenarioMap'
import { findFavorite, adhocContact } from './data/contacts'
import { getPhase, getPhaseCount, getPhaseSpeech, DEFAULT_STATUS, parseBoldSegments, stripMarkers } from './data/drivePhases'
import AppView from './components/AppViews'
import ControlPanel from './components/ControlPanel'
import { ExperimentProvider, useExperiment } from './context/ExperimentContext'
import OperatorConsole from './components/OperatorConsole'
import { CARLA_WS_URL } from './carlaWs'

const TTS_KEY = import.meta.env.VITE_GOOGLE_TTS_API_KEY
// CARLA WS 주소 — 같은 PC면 localhost, 2-PC(Windows CARLA↔Mac HMI)면 .env.local 에
// VITE_CARLA_WS_URL=ws://<WindowsPC-IP>:8766 로 설정. 브리지·배경맵·내비맵 iframe 모두 이걸 쓴다.
const CARLA_WS = CARLA_WS_URL  // 런타임 host 오버라이드(?carla=/localStorage→env→localhost) 단일 출처

// map_live.html 은 public/ 정적 파일이라 Vite HMR 대상이 아니고, iframe 문서는
// 브라우저가 적극 캐시한다 → 파일을 수정해도 부모 새로고침만으로 옛 버전이 뜬다.
// 페이지 로드마다 새 토큰(?v=)을 붙여 매 로드 최신 파일을 받게 한다(모듈 로드 시 1회 고정).
const MAP_LIVE_CACHE_BUST = Date.now()

// Conversational follow-up window. We open the mic the moment TTS *starts*
// playing so a barge-in attempted mid-reply is caught (the browser's AEC
// usually filters the speaker out), then start a hard countdown the moment
// TTS *ends* and close the mic when it hits 0.
const FOLLOWUP_OPEN_DELAY_MS = 150        // tiny pause so TTS audio context is up first
const FOLLOWUP_WINDOW_S      = 6          // seconds the mic stays open after TTS ends
// 청취 세션 종료 조건. 웹 음성 인식기는 침묵 시 몇 초 만에 자동 종료(onend)되므로 세션이
// 살아있는 동안 인식기를 자동 재시작해 마이크를 계속 열어두고 "듣는 중"을 유지하되,
//   ① 무발화(소리/발화 미감지)가 LISTEN_SILENCE_MS 이상 지속되면 자동 종료,
//   ② 사용자가 종료 조건어(CANCEL_WORDS)를 말하면 명령 처리 없이 즉시 종료,
//   ③ 화면의 취소 버튼을 누르면 즉시 종료.
// 발화/소리가 감지되면(onspeechstart/onsoundstart) 무발화 타이머를 리셋한다.
const LISTEN_SILENCE_MS      = 5000       // 무발화 5초 → 세션 자동 종료(발화 감지 시 리셋)
const LISTEN_RESTART_MS      = 250        // 침묵 종료 후 인식기 재시작 간격(타이트 루프 방지)
// 종료 조건어 — 인식되면 명령으로 처리하지 않고 청취를 끝낸다(공백·문장부호 제거 후 정확 매칭).
const CANCEL_WORDS = ['아니야', '아니', '취소', '종료', '그만', '됐어', '됐어요', '괜찮아', '괜찮아요', '닫아', '닫아줘', '꺼줘', '알겠어', '알겠어요']

// C2(수막현상) 블록 자동 진행 — 시각 App.jsx 와 동일 간격(변인통제). ────────────
// CARLA terrain 이벤트는 각 지형 블록의 '요동 감지'(errored) 페이즈만 발화한다
// (C2-2/6/10). 대응 물리 이벤트가 없는 나머지 SA 아크(원인→해결→정상 =
// C2-3·4·5 / 7·8·9 / 11·12·13)는 errored 진입 후 4초 간격으로 음성이 스스로 진행한다.
const C2_BLOCK_FOLLOWUP_STEPS = 3   // errored 뒤로 자동 진행할 페이즈 수(원인·해결·정상)
const C2_BLOCK_STEP_MS = 4000       // 페이즈 간 간격(4초, 시각과 동일)

// 초기 정상 안내(C1-1·C2-1 "정상 주행 중입니다") 자동 재생 지연 — 시각과 동일.
// 이벤트(drive_start·puddle_enter)가 아니라 CARLA 구동(scenario_runtime started)
// 후 이 시간이 지나면 음성으로 C-X-1 을 발화한다.
const INITIAL_NORMAL_DELAY_MS = 5000   // 시나리오 시작 5초 뒤 C-X-1 발화

// Hydroplaning scenario marches the simulated current location through five
// fixed points as the passenger keeps asking. App.jsx counts the queries and
// hands the count to gemini.js + the Nav map so the AI's words and the map's
// blue dot stay in sync.
const HYDRO_LOCATIONS = [
  null,                                                                // 0 — pre-trip default
  { lat: 37.5345, lng: 126.9885, name: '녹사평역 부근' },
  { lat: 37.5340, lng: 126.9942, name: '이태원역 부근' },
  { lat: 37.5343, lng: 127.0073, name: '한남대로 폴바셋 근처' },
  { lat: 37.5165, lng: 127.0203, name: '신사역 근처' },
]
const HYDRO_FINAL_LOCATION = { lat: 37.5060, lng: 127.0245, name: '신분당역 부근' } // 5+
const DEFAULT_CURRENT_LOCATION = { lat: 37.5510, lng: 126.9251, name: '홍익대학교' }

// User text → which scenario intents it matches. App.jsx uses these to keep
// per-session counters that influence Gemini's response (location step,
// "앞서 말씀드렸듯이" briefing acknowledgement).
const LOC_QUERY_RE = /(어디|위치|얼마나|남았|어디까지|진행|현재\s*경로|경로\s*확인|남은)/i
const BRIEFING_QUERY_RE = /(상황|왜\s*이래|왜\s*늦|무슨\s*일|괜찮|설명|브리핑)/i

// Scenario → "자세히 보기" animation src. Files live in public/animations/
// so we can reference them by URL without import (no build error if absent —
// the <video> will just fail at runtime and we fall back to the static image).
function animationForScenario(scenarioId) {
  if (scenarioId === 'frustration_roundabout_loop') return '/animations/roundabout.mp4'
  if (scenarioId === 'anxiety_hydroplaning') return '/animations/hydroplaning.mp4'
  return null
}

// In-panel apps the AI can open via the [OPEN_APP:<id>] intent tag. The model
// emits the canonical English id; aliases are a safety net for stray output.
const APP_IDS = ['Navigation', 'Phone', 'Music', 'Mail', 'Calendar']
const APP_ALIASES = {
  내비: 'Navigation', 내비게이션: 'Navigation', 네비: 'Navigation', 네비게이션: 'Navigation', 지도: 'Navigation', 길안내: 'Navigation',
  전화: 'Phone', 음악: 'Music', 메일: 'Mail', 이메일: 'Mail', 일정: 'Calendar', 캘린더: 'Calendar', 달력: 'Calendar',
}
const resolveAppId = (raw) => {
  const s = (raw || '').trim()
  const hit = APP_IDS.find((id) => id.toLowerCase() === s.toLowerCase())
  return hit || APP_ALIASES[s] || null
}

const SUGGESTIONS = [
  '현재 상황 브리핑',
  '현재 경로 확인',
  '경로 변경',
  '추천 옵션',
]

// ── Sub-components ─────────────────────────────────────────

function AIOrb({ size = 160, pulse = false }) {
  return (
    <motion.div
      animate={pulse ? { scale: [1, 1.05, 1], opacity: [0.85, 1, 0.85] } : {}}
      transition={pulse ? { repeat: Infinity, duration: 3.5, ease: 'easeInOut' } : {}}
      className="ai-orb"
      style={{
        width: size,
        height: size,
        boxShadow: `0 ${Math.round(size / 8)}px ${Math.round(size / 2)}px rgba(91,163,217,0.32)`,
      }}
    />
  )
}

function TypingDots() {
  return (
    <div className="typing-dots">
      <div className="typing-dot" />
      <div className="typing-dot" />
      <div className="typing-dot" />
    </div>
  )
}

function ListeningWave() {
  return (
    <div className="listening-wave">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="wave-bar" />
      ))}
    </div>
  )
}

// Idle-screen greeting — one random pair is picked per mount (i.e. each time
// the conversation is cleared and the user returns to the home view). A
// time-of-day variant is included in the pool so it can surface naturally.
function pickGreeting() {
  const h = new Date().getHours()
  const tod =
    h >= 5 && h < 12  ? ['좋은 아침입니다.',  '오늘은 어디로 가실까요?'] :
    h >= 12 && h < 18 ? ['좋은 오후예요.',    '편하게 말 걸어주세요.'] :
    h >= 18 && h < 22 ? ['좋은 저녁입니다.',  '오늘도 수고하셨어요.'] :
                        ['늦은 밤이네요.',    '조용히 모셔다 드릴게요.']
  const pool = [
    ['반갑습니다!',                  '무엇을 도와드릴까요?'],
    ['안녕하세요.',                  '오늘 어디로 모셔다 드릴까요?'],
    ['"자인아"라고 불러보세요.',     '대화를 시작해봐요.'],
    ['"자인아"라고 깨워주세요.',     '필요한 게 있으면 말씀하세요.'],
    ['준비됐어요.',                  '어디든 안전하게 모실게요.'],
    ['오늘도 안전 주행 중이에요.',   '운전은 제가 할게요, 편히 쉬세요.'],
    tod,
  ]
  return pool[Math.floor(Math.random() * pool.length)]
}

function IdleGreeting() {
  const [greeting] = useState(pickGreeting)
  return (
    <motion.div
      className="hero-title"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
    >
      <p>{greeting[0]}</p>
      <p>{greeting[1]}</p>
    </motion.div>
  )
}

// Voice-only search bar (Figma 311:7554). No text typing — voice in, voice
// out. Tap the mic to start listening; the inline label shows the wake-word
// hint, or live "듣는 중…" with the follow-up countdown when active.
function VoiceBar({ isListening, followUpCountdown, onMicClick }) {
  return (
    <div
      className="voice-input-area"
      role="button"
      tabIndex={0}
      onClick={onMicClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onMicClick() } }}
      aria-label={isListening ? '듣는 중' : '음성 입력 시작'}
    >
      <div className="voice-input-bg" />
      <div className="voice-input-content">
        <span
          className={`voice-btn ${isListening ? 'listening' : ''}`}
          aria-hidden="true"
        >
          <Mic size={32} color="#ffffff" strokeWidth={2.2} />
        </span>
        {isListening ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
            <ListeningWave />
            <span className="voice-listening-text">
              듣는 중...
            </span>
          </div>
        ) : (
          <span className="voice-wakeword-hint">'자인아'라고 불러주세요</span>
        )}
        <button className="voice-search-icon" aria-label="검색" tabIndex={-1}>
          <Search size={32} color="#ffffff" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}

// Top-left driving-status pill. Falls back to DEFAULT_STATUS ("정상 주행 중")
// when no phase is active. The indicator dot takes its color from
// `status.color` (🟢/🔴/🟠/🟡 per sequence.md); `tone` only sets the pulse
// tempo (warning breathes faster).
function StatusPill({ status }) {
  const s = status ?? DEFAULT_STATUS
  return (
    <motion.div
      key={s.text}                       // remount on text change → re-fade
      className={`status-pill ${s.tone === 'warning' ? 'warning' : ''}`}
      style={{ '--dot': s.color ?? '#21C46A' }}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <span className="status-pill-dot" />
      <span>{s.text}</span>
    </motion.div>
  )
}

// Per-line typewriter. Reveals each character at ~35ms; the second line only
// starts after the first finishes. The active line gets a blinking caret via
// `.judgment-line.typing` so the reader sees where the text is being drawn.
function useTypedLines(lines, charMs = 35, lineGapMs = 280) {
  // Parse once per lines change; each line becomes an array of {text, bold}
  // segments. plainLens holds the rendered (marker-stripped) character count
  // per line — what the typewriter advances against.
  const segments = lines.map((l) => parseBoldSegments(l))
  const plainLens = lines.map((l) => stripMarkers(l).length)

  const [counts, setCounts] = useState(() => lines.map(() => 0))
  const [activeIdx, setActiveIdx] = useState(0)
  useEffect(() => {
    setCounts(lines.map(() => 0))
    setActiveIdx(0)
    if (!lines.length) return
    let cancelled = false
    let line = 0, ch = 0
    const tick = () => {
      if (cancelled) return
      const target = plainLens[line] ?? 0
      if (ch < target) {
        ch++
        setCounts((prev) => {
          const next = [...prev]
          next[line] = ch
          return next
        })
        setTimeout(tick, charMs)
      } else if (line + 1 < lines.length) {
        line += 1
        ch = 0
        setActiveIdx(line)
        setTimeout(tick, lineGapMs)
      } else {
        setActiveIdx(-1)  // done
      }
    }
    const id = setTimeout(tick, 120)
    return () => { cancelled = true; clearTimeout(id) }
  }, [lines.join('|'), charMs, lineGapMs])
  return { segments, counts, activeIdx }
}

// Walk parsed segments and return the prefix visible for `revealed` chars.
function visibleSegments(lineSegments, revealed) {
  let count = 0
  const out = []
  for (const seg of lineSegments) {
    if (count >= revealed) break
    const remaining = revealed - count
    const showLen = Math.min(seg.text.length, remaining)
    if (showLen > 0) out.push({ text: seg.text.slice(0, showLen), bold: seg.bold })
    count += seg.text.length
  }
  return out
}

// Hero text when a drive phase is active — scripted judgment messages typed
// out character-by-character so it reads as "the car is judging in real time"
// without waiting for the LLM. Gemini stays in the chat lane for follow-up
// questions; on-screen judgment is always instant.
function PhaseJudgment({ phaseLines }) {
  const { segments, counts, activeIdx } = useTypedLines(phaseLines)
  return (
    <motion.div
      className="hero-title"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {phaseLines.map((_, i) => {
        const visible = visibleSegments(segments[i] ?? [], counts[i] ?? 0)
        return (
          <p key={i}>
            <span className={`judgment-line ${activeIdx === i ? 'typing' : ''}`}>
              {visible.map((s, j) =>
                s.bold
                  ? <strong key={j} className="judgment-strong">{s.text}</strong>
                  : <span key={j}>{s.text}</span>
              )}
            </span>
          </p>
        )
      })}
    </motion.div>
  )
}

// ── Vehicle HMI (participant-facing screen) ────────────────

function VehicleHMI() {
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [isListening, setIsListening] = useState(false)
  // 청취 "세션" 플래그 — 인식기(isListening)는 침묵 시 자동 종료/재시작으로 깜빡이지만,
  // micActive 는 세션이 살아있는 동안(사용자가 말하거나·취소·타임아웃 전까지) 계속 true.
  // "듣는 중" 표시는 이 값으로 구동해 깜빡임 없이 마이크가 열린 내내 유지된다.
  const [micActive, setMicActive] = useState(false)
  const [isAITyping, setIsAITyping] = useState(false)
  const [showCarStatus, setShowCarStatus] = useState(false)
  const [temperature, setTemperature] = useState(20)
  const [isAutoClimate, setIsAutoClimate] = useState(true)
  const [fanSpeed, setFanSpeed] = useState(2)
  // System-wide volume — lives at the HMI level (not inside the music app)
  // so the bar stays visible whatever screen the user is on.
  const [volume, setVolume] = useState(0.5)
  const [muted, setMuted] = useState(false)
  const [volumeOpen, setVolumeOpen] = useState(false) // slider only expands during adjustment
  // Active navigation route confirmed by the user in the Nav app. When set,
  // gemini.js gets its summary in the prompt so the AI can answer trip
  // questions ("얼마나 걸려?") with concrete numbers + scenario delay.
  const [activeRoute, setActiveRoute] = useState(null)
  // Current driving speed (km/h) shown in the GNB center. CARLA(:8766) world_metric
  // 의 speed_kmh 로 라이브 구동(시각 HMI 와 byte-동치 = 변인통제). WS 미수신이면 초기
  // 48(Figma 311:7441)을 유지. 시각 App.jsx 의 handleWorldMetric 미러링.
  const [currentSpeed, setCurrentSpeed] = useState(48)
  // ── 도착 예정(ETA) 타이머 (mm:ss) — 시각 HMI 와 동일 규칙(변인통제) ──────────
  // 기본 05:00(300s). 규칙(2026-06-25 정본 · 시각 repo 와 동일):
  //   • 콜론(:)은 모든 런타임에서 1초에 한 번 깜빡인다(초 흐름 표시, 0.5s 토글).
  //   • 틱은 마운트부터 상시 도는 "벽시계"(deps []). 감소 여부만 status 로 게이팅한다.
  //   • 정상 상태(🟢, status.tone==='normal')에서는 매초 1씩 감소(최소 00:00).
  //   • 비정상 상태(normal 이 아닌 모든 상태: 🔴 detect/🟠 cause/🟡 solve)에서는 증감 없이 hold.
  //   • 더는 junction_deadlock_start 로 점프하지 않는다(증가 폐기).
  //   world_metric 에 실 ETA 필드(eta_seconds 등)가 들어오면 그 값을 우선 사용하고,
  //   1회라도 수신하면 클라이언트 자유진행(카운트다운)을 멈춘다(liveEtaRef).
  // 시나리오별 ETA 시작값(260626 사용자 결정): C1=7:00, C2(수막)=3:00. (시각 HMI 와 동일 변인통제)
  //   currentMap 으로 idle 값 결정(아래에서 매 렌더 갱신). 정상🟢=1초감소·오류=hold 는 공통.
  const etaIdleRef = useRef(420)   // 콜백/인터벌이 항상 현재 시나리오의 idle 값을 보도록
  const [etaSeconds, setEtaSeconds] = useState(420)
  const [etaColonOn, setEtaColonOn] = useState(true)  // 콜론 깜빡임(0.5s 토글)
  const etaProblemRef = useRef(false)                 // 비정상(=normal 아님) hold 판정용 최신 ref
  const liveEtaRef = useRef(false)            // 실 eta 1회라도 수신하면 클라 자유진행 정지(실값 우선)
  // 3R-c(2026-06-25 피드백, 시각 App.jsx 미러): ETA = '시나리오 시작 시각' 기준 벽시계
  //   카운트다운(이벤트·문제상태 무관). 시작 시 앵커(ms) → remaining = IDLE - 경과초.
  const etaAnchorRef = useRef(null)
  const liveSpeedRef = useRef(false)          // 실측 speed 1회라도 받았는가(현재 미사용 표시용)
  // 배경 라이브 맵 — map_live iframe src(?map=). roundabout=Town03, aquaplaning=Town04.
  // CARLA scenario_runtime/world_metric 의 map 정보로 전환. 기본 Town03.
  const [currentMap, setCurrentMap] = useState('Town03')
  etaIdleRef.current = currentMap === 'Town04' ? 180 : 420   // C2(Town04)=3:00 / C1=7:00 (260626)
  // Phone call state lifted up so voice intents ([CALL:name]) can initiate
  // calls from outside the Phone app. 'ringing' is a transition state of
  // random 1–5 s before flipping to 'connected'.
  const [callingContact, setCallingContact] = useState(null)
  const [callState, setCallState] = useState(null) // 'ringing' | 'connected' | null
  // Hydroplaning scenario session counters — drive the location step list and
  // the "앞서 말씀드셨듯이…" briefing acknowledgement. Reset on scenario change.
  const [hydroState, setHydroState] = useState({ locationCount: 0, briefingCount: 0 })
  // Seconds remaining in the post-TTS listening window (visible in the voice
  // input area as "N초 남음"). null = no countdown active.
  const [followUpCountdown, setFollowUpCountdown] = useState(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [activeApp, setActiveApp] = useState(null)
  const [isControlPanelOpen, setIsControlPanelOpen] = useState(false)

  const [hasShownScenarioCard, setHasShownScenarioCard] = useState(false)

  const messagesEndRef = useRef(null)
  const recognitionRef = useRef(null)
  const screenRef = useRef(null)
  const speedLevelRef = useRef(DEFAULT_SPEED_LEVEL)
  const speakingRateRef = useRef(SPEED_LEVELS[DEFAULT_SPEED_LEVEL])
  const isListeningRef = useRef(false)         // mirror of isListening for async callbacks
  const micActiveRef = useRef(false)           // mirror of micActive (세션 생존 여부) for async callbacks
  const listenTimeoutRef = useRef(null)        // 무발화 타이머(LISTEN_SILENCE_MS)
  const messagesRef = useRef([])               // mirror of messages — STT onresult 클로저가 최신 대화 여부를 읽도록
  // TTS 자기발화(에코) 가드 — TTS 가 말하는 동안 STT/웨이크워드가 AI 자신의 음성을
  // 사용자 발화로 주워 중복 표시하는 것을 막는다. speaking=true 구간의 인식 결과는 버린다.
  const [ttsSpeaking, setTtsSpeaking] = useState(false)
  const ttsSpeakingRef = useRef(false)         // mirror for async STT onresult guard
  const lastInputMethodRef = useRef('text')    // 'voice' arms the post-response follow-up
  const temperatureRef = useRef(20)            // mirrors of climate state for the Gemini call
  const fanSpeedRef = useRef(2)
  const fanBoostTimerRef = useRef(null)        // reverts a temporary fan boost
  const volumeRef = useRef(0.5)
  const mutedRef = useRef(false)
  const volumeCloseTimerRef = useRef(null)     // auto-collapses the volume slider
  const activeRouteRef = useRef(null)          // mirror of activeRoute for the Gemini call
  const currentPhaseRef = useRef(0)            // mirror of currentPhase for the Gemini call
  const activeScenarioIdRef = useRef(null)     // mirror of activeScenario?.scenarioId for the CARLA bridge handler
  const deadlockLapRef = useRef(null)          // C1 deadlock 마지막 재발화 lap(바퀴마다 재발화 가드, R2)
  const c2AutoTimersRef = useRef([])           // C2 지형 블록 자동 진행 setTimeout 핸들(리셋·재스케줄 시 취소)
  const initialNormalTimerRef = useRef(null)   // 시작 5초 뒤 초기 정상(C-X-1) 발화 타이머
  const ringingTimerRef = useRef(null)         // ringing → connected transition timer
  const driveBgRef = useRef(null)              // 배경 라이브 맵 iframe — hmi-status postMessage 타깃
  const driveBgReadyRef = useRef(false)        // map_live 가 drive-bg-ready 핸드셰이크를 보냈는가
  const mapPanelRef = useRef(null)             // 우측 '내비게이션' 패널의 map_live iframe — status 색 postMessage 타깃(배경 iframe 과 함께). 시각 HMI 미러링.

  // Start a call (used by both UI taps and the [CALL:name] voice intent).
  // Ringing lasts a random 1–5 seconds before flipping to connected.
  const startCall = (contact) => {
    if (!contact) return
    clearTimeout(ringingTimerRef.current)
    setCallingContact(contact)
    setCallState('ringing')
    const delay = 1000 + Math.floor(Math.random() * 4000)
    ringingTimerRef.current = setTimeout(() => setCallState('connected'), delay)
  }

  const endCall = () => {
    clearTimeout(ringingTimerRef.current)
    ringingTimerRef.current = null
    setCallingContact(null)
    setCallState(null)
  }

  // ── Audio autoplay unlock (global, one-shot) ───────────────
  // The phase-TTS path is driven by CARLA WebSocket events with no user gesture
  // of their own, which Chrome's autoplay policy mutes. Capture the FIRST user
  // gesture anywhere on the page (pointer or key — e.g. the operator's scenario
  // hotkeys Alt+Q/W or Ctrl+→) and bless audio playback once. Listeners remove
  // themselves after the first fire. This changes nothing about *what* or *when*
  // we speak — only whether the browser lets the audio element play.
  useEffect(() => {
    let done = false
    const handler = () => {
      if (done) return
      done = true
      unlockAudio()
      window.removeEventListener('pointerdown', handler, true)
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('touchstart', handler, true)
    }
    window.addEventListener('pointerdown', handler, true)
    window.addEventListener('keydown', handler, true)
    window.addEventListener('touchstart', handler, true)
    return () => {
      window.removeEventListener('pointerdown', handler, true)
      window.removeEventListener('keydown', handler, true)
      window.removeEventListener('touchstart', handler, true)
    }
  }, [])

  // Fit the fixed 1920×1080 screen to the display, preserving aspect ratio.
  useEffect(() => {
    const fit = () => {
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
      if (screenRef.current) screenRef.current.style.transform = `scale(${scale})`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // ── Experiment logging + scenario control (synced w/ Operator) ──
  const {
    activeScenario,
    hmiResetNonce,
    currentPhase,
    setScenario,
    setPhase,
    resetHmi,
    addPendingTurn,
    completeTurn,
    failTurn,
    markTtsPlayed,
    markTtsError,
  } = useExperiment()

  // Single source of truth for the active scenario (synced across windows).
  const effectiveContext = activeScenario?.scenarioContext ?? ''

  // Reset the roundabout card flag when the scenario switches.
  useEffect(() => {
    setHasShownScenarioCard(false)
    setHydroState({ locationCount: 0, briefingCount: 0 })
  }, [activeScenario?.scenarioId])

  // 활성 시나리오로도 맵을 맞춘다(roundabout=Town03 / aquaplaning=Town04).
  // CARLA scenario_event(evt.scenario) 없이 키보드 Alt+W·오퍼레이터로 C2 를 띄워도
  // Town04 로 전환되도록 보장 — currentMap 은 ETA idle 값(C2=3:00)도 결정하므로
  // 이게 없으면 C2 인데 맵=Town03·ETA=7:00 로 남는다.
  useEffect(() => {
    const id = activeScenario?.scenarioId
    if (id === 'anxiety_hydroplaning') setCurrentMap('Town04')
    else if (id === 'frustration_roundabout_loop') setCurrentMap('Town03')
  }, [activeScenario?.scenarioId])

  // When a scenario activates, auto-set the navigation route to 강남역 2호선
  // so the experiment trip is already in progress without the participant
  // needing to search. Only fires when transitioning into a scenario and
  // when the participant hasn't already confirmed their own route.
  useEffect(() => {
    const scenarioId = activeScenario?.scenarioId
    if (!scenarioId || activeRouteRef.current) return
    const dest = {
      name: '강남역 2호선',
      addr: '서울 강남구 강남대로 396',
      lat: 37.4979, lng: 127.0276,
    }
    const origin = { lat: 37.5510, lng: 126.9251 }   // 홍익대학교 (DEFAULT_CENTER)
    let cancelled = false
    ;(async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?steps=true&geometries=geojson&overview=full`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`OSRM ${res.status}`)
        const data = await res.json()
        const r = data.routes?.[0]
        if (!r) throw new Error('no route')
        if (cancelled) return
        const now = new Date()
        setActiveRoute({
          destination: dest,
          durationSec: r.duration,
          distanceM: r.distance,
          geometry: r.geometry.coordinates,
          departureIso: now.toISOString(),
          baseArrivalIso: new Date(now.getTime() + r.duration * 1000).toISOString(),
        })
      } catch (e) {
        if (cancelled) return
        console.warn('[auto-route] OSRM failed, using straight-line fallback:', e.message)
        const now = new Date()
        const durationSec = 25 * 60   // ~25 min Seoul drive estimate
        const distanceM = 12000
        setActiveRoute({
          destination: dest,
          durationSec, distanceM,
          geometry: [[origin.lng, origin.lat], [dest.lng, dest.lat]],
          departureIso: now.toISOString(),
          baseArrivalIso: new Date(now.getTime() + durationSec * 1000).toISOString(),
        })
      }
    })()
    return () => { cancelled = true }
  }, [activeScenario?.scenarioId])

  // When the participant ends an active route mid-scenario, the AI proactively
  // asks where to go next, anchoring the conversation at a believable
  // mid-route landmark (녹사평역 부근).
  const prevRouteRef = useRef(null)
  useEffect(() => {
    const had = !!prevRouteRef.current
    const has = !!activeRoute
    prevRouteRef.current = activeRoute
    if (had && !has && activeScenario?.scenarioId) {
      const text = '지금 녹사평역 부근인데, 어디로 갈까요?'
      setMessages((prev) => [...prev, { id: Date.now(), type: 'ai', text }])
      if (TTS_KEY) {
        speakText(text, TTS_KEY, speakingRateRef.current).catch(() => {})
      }
    }
  }, [activeRoute, activeScenario?.scenarioId])

  // Operator ended the trial / reset → wipe the HMI back to the idle screen.
  useEffect(() => {
    if (hmiResetNonce === 0) return
    setMessages([])
    setInputText('')
    setShowCarStatus(false)
    setActiveApp(null)
    setIsControlPanelOpen(false)
    setHasShownScenarioCard(false)
    setActiveRoute(null)
    endCall()
    setHydroState({ locationCount: 0, briefingCount: 0 })
  }, [hmiResetNonce])

  const formatTime = (date) =>
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isAITyping])

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Alt+Shift+O → open the operator console in its own window.
      // Triple-modifier chord: identical on Windows/Mac, no OS/browser conflict.
      if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyO') {
        e.preventDefault()
        window.open('/operator', 'operator_console')
        console.log('Operator Console opened (Ctrl+Alt+Shift+O)')
        return
      }

      // Scenario shortcuts (Alt + single key) — synced to the Operator Console.
      const altOnly = e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey
      if (altOnly && e.code === 'KeyQ') {
        // 회전교차로 반복 주행 상황
        e.preventDefault()
        setScenario('frustration_roundabout_loop')
        console.log('Scenario: 회전교차로 반복 주행 (Alt+Q)')
      } else if (altOnly && e.code === 'KeyW') {
        // 빗길 수막현상 상황
        e.preventDefault()
        setScenario('anxiety_hydroplaning')
        console.log('Scenario: 빗길 수막현상 (Alt+W)')
      } else if (altOnly && e.code === 'KeyR') {
        // 상황 리셋 (HMI 초기화)
        e.preventDefault()
        resetHmi()
        console.log('Scenario Reset (Alt+R)')
      } else if (altOnly && e.code === 'KeyA') {
        // CTA 채팅 팝업 (우회 선택지)
        e.preventDefault()
        if (effectiveContext !== '') {
          setMessages(msgs => {
            // Prevent duplicate insertion
            if (msgs.length > 0 && msgs[msgs.length - 1].text === '다른 경로로 우회할까요?') {
              return msgs
            }
            console.log('CTA popup (Alt+A): Showing detour options')
            return [...msgs, {
              id: Date.now(),
              type: 'ai-card',
              text: '다른 경로로 우회할까요?',
              options: ['우회하기', '기존 경로 유지']
            }]
          })
        }
      }

      // Drive-phase hotkeys (Ctrl + ←/→) — operator steps through the
      // simulated driving phases as the simulator progresses. Right advances
      // (clamped to the scenario's last phase), left rewinds (down to 0 = no
      // active phase). Phase sets differ per scenario (C1=13, C2=6).
      const ctrlOnly = e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
      if (ctrlOnly && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) {
        e.preventDefault()
        const max = getPhaseCount(activeScenario?.scenarioId)
        if (!max) return                                    // no scenario → nothing to step through
        const cur = currentPhaseRef.current ?? 0
        const next = e.code === 'ArrowRight'
          ? Math.min(max, cur + 1)
          : Math.max(0, cur - 1)
        if (next !== cur) {
          setPhase(next)
          console.log(`Drive phase → ${next}/${max} (Ctrl+${e.code === 'ArrowRight' ? '→' : '←'})`)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [effectiveContext, setScenario, setPhase, resetHmi])

  // 한 페이즈의 스크립트 SA 문장을 TTS 로 발화(공유 헬퍼). 페이즈 effect 와
  // deadlock 바퀴마다 재발화가 같은 경로를 쓴다. `N초` 토큰은 매 발화마다 3~5초로 치환.
  // ⚠️ 정의 위치 주의: 바로 아래 onCarlaScenarioEvent 의 deps 배열이 렌더 중 이 값을
  //    읽으므로 반드시 그 '위'에 둔다(아래로 내리면 TDZ — Cannot access before init).
  const speakPhaseLine = useCallback((phase) => {
    if (!phase || !TTS_KEY) return
    const speech = getPhaseSpeech(activeScenarioIdRef.current, phase)
    if (!speech) return
    const line = speech.replace(/N초/g, `${3 + Math.floor(Math.random() * 3)}초`)
    console.log(`[Phase TTS] 페이즈 ${phase} 발화:`, line)
    speakText(line, TTS_KEY, speakingRateRef.current)
      .catch((err) => console.error('[Phase TTS] 재생 실패:', err))
  }, [])

  // ── CARLA WS 8766 → 자동 setScenario + setPhase (WoZ 핫키와 병존) ──────────
  // CARLA 가 보내는 scenario_event 를 받아 시각 HMI 와 동일한 시퀀스로 음성 페이즈를
  // 구동한다. WoZ(Alt+Q/W·Ctrl+→/←)는 그대로 — 운영자가 언제든 손으로 덮어쓸 수 있다.
  // WS 가 끊겨도(8766 down) useCarlaBridge 가 graceful 재연결하므로 앱은 WoZ 로 정상 동작.
  //
  // race 처리: setScenario(scenarioId) 는 currentPhase 를 0 으로 리셋한다(ExperimentContext).
  // 따라서 시나리오가 바뀔 땐 같은 tick 에서 setPhase 를 바로 부르지 않고, 시나리오 활성화가
  // 커밋된 **다음 tick**(setTimeout 0)에 setPhase 를 적용한다 → 페이즈 리셋과 충돌하지 않고
  // 페이즈 effect 가 새 scenarioId + targetPhase 로 한 번만 발화한다. 같은 시나리오일 땐 즉시.
  const onCarlaScenarioEvent = useCallback((evt) => {
    const mapped = mapCarlaScenarioEvent(evt)   // { scenarioId, targetPhase } | null
    if (!mapped) return                          // scenario 미상 → graceful no-op

    // (ETA 는 더는 이벤트로 점프하지 않는다 — 문제 상태에서 hold, 정상에서 카운트다운.)
    // 맵 전환: roundabout=Town03, aquaplaning=Town04(시각과 동일).
    if (evt?.scenario === 'roundabout') setCurrentMap('Town03')
    else if (evt?.scenario === 'aquaplaning') setCurrentMap('Town04')

    const { scenarioId, targetPhase } = mapped
    const activeId = activeScenarioIdRef.current
    const switching = scenarioId !== activeId

    // 초기 정상(C-X-1, phase 1)은 scenario_runtime started 의 +5초 타이머가 발화한다.
    // 시나리오가 아직 비활성(switching=새 시작)인데 phase 1(시작 정상) 이벤트
    // (drive_start·junction_arrive)가 오면 여기서 발화/시작하지 않는다 — 초기 정상이
    // 이벤트로 조기/중복 발화되는 것을 막는다. (에러 phase>1 는 fallback 으로 시작 허용.)
    if (switching && targetPhase === 1) return

    if (switching) {
      setScenario(scenarioId)                    // activeScenario 활성화 + phase→0
      activeScenarioIdRef.current = scenarioId   // ref 즉시 갱신(다음 이벤트가 stale 안 보도록)
      deadlockLapRef.current = null              // 새 런: deadlock lap 추적 리셋(R2)
    }

    if (targetPhase == null) return              // 시나리오만 활성화, 페이즈 변경 없음

    // ── C1 deadlock 바퀴마다 재발화(R2) ─────────────────────────────────────
    // junction_deadlock_start 는 같은 phase(C1-4)로 반복해서 온다 → spokenPhaseRef
    // 멱등 가드 때문에 페이즈 effect 는 한 번만 발화한다. 사용자는 1차로에서 한
    // 바퀴 돌 때마다 재발화를 원하므로, lap 이 바뀌면(또는 lap 없으면 매 emit)
    // 멱등 가드를 우회해 직접 재발화한다. 바퀴 간격 ~29초 + TTS 직렬 큐라 폭주 없음.
    // (switching 직후엔 setPhase(다음 tick)로 effect 가 1회 발화하므로 중복 재발화하지 않음.)
    if (evt.event === 'junction_deadlock_start' && !switching) {
      const lap = evt.payload?.lap
      if (lap == null || lap !== deadlockLapRef.current) {
        deadlockLapRef.current = lap ?? null
        if (currentPhaseRef.current === targetPhase) {
          // 이미 C1-4 페이즈에 있다(=effect 가 다시 안 뜸) → 직접 재발화.
          speakPhaseLine(targetPhase)
          return
        }
        // 아직 C1-4 가 아니면 아래 setPhase 로 effect 가 정상 발화. ref 만 갱신.
      } else {
        // 같은 lap 중복 emit → 재발화/재설정 안 함(폭주 가드).
        return
      }
    }

    if (switching) {
      // 시나리오 전환 직후: phase 리셋(0)과의 충돌을 피하려 다음 tick 에 setPhase.
      setTimeout(() => setPhase(targetPhase), 0)
    } else {
      setPhase(targetPhase)
    }

    // ── C2 지형 블록 자동 진행(시각 App.jsx 미러) ─────────────────────────────
    // terrain 이벤트는 블록의 'errored' 페이즈(C2-2/6/10)만 발화하므로, 나머지 SA
    // 아크(원인→해결→정상)를 4초 간격으로 자동 진행한다. setPhase 마다 페이즈 effect 가
    // speakPhaseLine 으로 발화(정상 페이즈는 "정상 주행 중입니다" 재안심 = 결정된 정책).
    // 직전 블록의 미발화 타이머를 먼저 취소. stale 가드: 콜백 시점에 (i) 아직 같은
    // 시나리오이고 (ii) 현재 페이즈가 이 블록 범위 안 + 단조 증가일 때만 진행.
    c2AutoTimersRef.current.forEach(clearTimeout)
    c2AutoTimersRef.current = []
    const isC2Terrain =
      scenarioId === 'anxiety_hydroplaning' &&
      (evt.event === 'puddle_enter' || evt.payload?.terrain != null)
    if (isC2Terrain) {
      const blockStart = targetPhase           // errored 페이즈(2/6/10)
      const phaseCount = getPhaseCount(scenarioId)
      for (let k = 1; k <= C2_BLOCK_FOLLOWUP_STEPS; k++) {
        const next = Math.min(phaseCount, blockStart + k)
        const t = setTimeout(() => {
          if (activeScenarioIdRef.current !== scenarioId) return
          const cur = currentPhaseRef.current
          if (cur >= blockStart && cur < next) setPhase(next)
        }, k * C2_BLOCK_STEP_MS)
        c2AutoTimersRef.current.push(t)
      }
    }
  }, [setScenario, setPhase, speakPhaseLine])

  // ── world_metric → 현재 속도 + 실 ETA (시각 handleWorldMetric 미러링) ──────
  const handleWorldMetric = useCallback((m) => {
    if (!m) return
    // 텔레메트리에 map 이 있으면 보조 경로로 맵 전환(같은 값이면 리렌더 생략).
    if (m.map === 'Town03' || m.map === 'Town04') setCurrentMap((prev) => (prev === m.map ? prev : m.map))
    if (typeof m.speed_kmh === 'number') {
      liveSpeedRef.current = true
      setCurrentSpeed(m.speed_kmh)
    }
    // 실제 ETA 가 메시지에 있으면 진실원천으로 사용(우선순위 ①). 시각과 동일 필드명.
    // 1회라도 수신하면 liveEtaRef 를 세워 클라이언트 자유진행(카운트다운)을 영구 정지 →
    // 이후 표시값은 실 eta 만 따른다(이중 안전 · 시각 handleWorldMetric 미러링).
    const realEta = [m.eta_seconds, m.remaining_time_s, m.remaining_time_sec, m.eta_s]
      .find((v) => typeof v === 'number')
    if (typeof realEta === 'number') {
      liveEtaRef.current = true
      setEtaSeconds(Math.max(0, Math.round(realEta)))
    }
  }, [])

  // ── scenario_runtime → 맵 전환 + ETA 리셋(시각 handleScenarioRuntime 미러링) ──
  const handleScenarioRuntime = useCallback((m) => {
    if (!m) return
    if (m.map === 'Town03' || m.map === 'Town04') setCurrentMap(m.map)
    // 시나리오 종류 판별: frustration→C1 · anxiety/puddle→C2(시각과 동일 기준).
    const isFrustration =
      m.scenario === 'frustration' || m.scenario === 'roundabout' ||
      m.scenario_id === 'frustration_roundabout_loop'
    const isPuddle =
      m.scenario === 'anxiety' || m.scenario_id === 'puddle' || m.map === 'Town04'
    const scenarioId = isFrustration ? 'frustration_roundabout_loop'
      : isPuddle ? 'anxiety_hydroplaning' : null
    if (!scenarioId) return

    if (m.status === 'started') {
      // 초기 정상 안내(C-X-1 "정상 주행 중입니다") 자동 발화: 이벤트와 무관하게
      // 구동 5초 뒤 시나리오를 phase 1 로 띄운다(페이즈 effect 가 speakPhaseLine).
      // 가드: 5초 사이 에러 이벤트가 먼저 진행시켰으면(phase>0) 되돌리지 않는다.
      if (initialNormalTimerRef.current) clearTimeout(initialNormalTimerRef.current)
      initialNormalTimerRef.current = setTimeout(() => {
        initialNormalTimerRef.current = null
        if (activeScenarioIdRef.current === scenarioId) {
          if (currentPhaseRef.current === 0) setPhase(1)
        } else {
          setScenario(scenarioId)
          activeScenarioIdRef.current = scenarioId
          setTimeout(() => setPhase(1), 0)   // setScenario 의 phase→0 리셋과 충돌 회피
        }
      }, INITIAL_NORMAL_DELAY_MS)
      if (isFrustration) {
        etaAnchorRef.current = Date.now()   // 시작 시각 앵커(이후 이벤트와 무관)
        setEtaSeconds(etaIdleRef.current)
      }
    } else if (m.status === 'stopped') {
      if (initialNormalTimerRef.current) {
        clearTimeout(initialNormalTimerRef.current)
        initialNormalTimerRef.current = null
      }
      if (isFrustration) {
        etaAnchorRef.current = null
        setEtaSeconds(etaIdleRef.current)
      }
    }
  }, [setScenario, setPhase])

  useCarlaBridge({
    onScenarioEvent: onCarlaScenarioEvent,
    onWorldMetric: handleWorldMetric,
    onScenarioRuntime: handleScenarioRuntime,
  })

  // ── Gemini + TTS ──────────────────────────────────────────
  // turnId / turnStartMs are passed from sendMessage for experiment logging;
  // null when invoked outside a logged turn.
  const callGemini = async (text, turnId = null, turnStartMs = null, scenarioState = undefined) => {
    setIsAITyping(true)

    try {
      const needsCard = effectiveContext !== '' && !hasShownScenarioCard
      const stateForGemini = scenarioState ?? hydroState
      let aiText = await getGeminiResponse(text, effectiveContext, needsCard, speedLevelRef.current, activeScenario?.scenarioId, temperatureRef.current, fanSpeedRef.current, activeRouteRef.current, volumeRef.current, mutedRef.current, stateForGemini, currentPhaseRef.current)
      setIsAITyping(false)

      const aiTimestamp = new Date().toISOString()
      const responseLatencyMs =
        turnStartMs != null ? Math.round(performance.now() - turnStartMs) : null

      const speedMatch = aiText.match(/\[SPEED:(slow|normal|fast|very_fast)\]/i)
      if (speedMatch) {
        const level = speedMatch[1].toLowerCase()
        if (SPEED_LEVELS[level] !== undefined) {
          speedLevelRef.current = level
          speakingRateRef.current = SPEED_LEVELS[level]
          console.log('[tts] speed level →', level, `(rate=${SPEED_LEVELS[level]})`)
        }
        aiText = aiText.replace(speedMatch[0], '').trim()
      }

      // Voice-only: strip the situation/roundabout card tags so they never
      // surface as text, but never render the "자세히 보기" card — the
      // explanation is delivered by voice (TTS) only.
      const hasCard = false
      if (/\[SHOW_SITUATION\]/i.test(aiText) || aiText.includes('[SHOW_ROUNDABOUT_CARD]')) {
        aiText = aiText
          .replace(/\[SHOW_SITUATION\]/gi, '')
          .replace(/\[SHOW_ROUNDABOUT_CARD\]/g, '')
          .trim()
        setHasShownScenarioCard(true)
      }

      let options = null
      let isConfirmation = false
      let selectedOptionMatch = null

      const optionsMatch = aiText.match(/\[OPTIONS:(.*?)\]/)
      if (optionsMatch) {
        options = optionsMatch[1].split('|').map(s => s.trim())
        aiText = aiText.replace(optionsMatch[0], '').trim()
      }

      const selectedMatch = aiText.match(/\[SELECTED_OPTION:(.*?)\]/)
      if (selectedMatch) {
        selectedOptionMatch = selectedMatch[1].trim()
        isConfirmation = true
        aiText = aiText.replace(selectedMatch[0], '').trim()
      }

      // App control by intent: the model emits [OPEN_APP:<id>] / [CLOSE_APP].
      const openAppMatch = aiText.match(/\[OPEN_APP:(.*?)\]/i)
      if (openAppMatch) {
        const appId = resolveAppId(openAppMatch[1])
        aiText = aiText.replace(openAppMatch[0], '').trim()
        if (appId) {
          setActiveApp(appId)
          console.log('[app-control] open', appId)
        }
      }
      if (/\[CLOSE_APP\]/i.test(aiText)) {
        aiText = aiText.replace(/\[CLOSE_APP\]/i, '').trim()
        setActiveApp(null)
        console.log('[app-control] close')
      }

      // Voice-triggered call: [CALL:name] — open the Phone app and start
      // ringing. Favorites match by normalized name; an unknown name lands
      // as an ad-hoc contact (the AI should have confirmed with the user
      // before emitting [CALL] for unknowns).
      const callMatch = aiText.match(/\[CALL:(.*?)\]/i)
      if (callMatch) {
        const rawName = callMatch[1].trim()
        aiText = aiText.replace(callMatch[0], '').trim()
        const contact = findFavorite(rawName) ?? adhocContact(rawName)
        setActiveApp('Phone')
        startCall(contact)
        console.log('[phone] call →', contact.name)
      }

      // Roundabout scenario — passenger confirmed "변경하기". Pull an OSRM
      // alternative for the same origin→destination and swap activeRoute
      // with it (flagged so the nav UI colors the line differently and
      // surfaces the added time next to the arrival ETA).
      if (/\[ROUTE_ALTERNATIVE\]/i.test(aiText)) {
        aiText = aiText.replace(/\[ROUTE_ALTERNATIVE\]/gi, '').trim()
        const baseRoute = activeRouteRef.current
        const dest = baseRoute?.destination ?? {
          name: '강남역 2호선', addr: '서울 강남구 강남대로 396',
          lat: 37.4979, lng: 127.0276,
        }
        const origin = { lat: DEFAULT_CURRENT_LOCATION.lat, lng: DEFAULT_CURRENT_LOCATION.lng }
        setActiveApp('Navigation')
        ;(async () => {
          try {
            const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?alternatives=true&overview=full&geometries=geojson&steps=true`
            const res = await fetch(url)
            if (!res.ok) throw new Error(`OSRM ${res.status}`)
            const data = await res.json()
            // OSRM returns multiple routes when alternatives=true. Pick the
            // 2nd (the actual detour); if the demo server only returned one,
            // pad the duration so the "+N분" still reads as a real detour.
            const primary = data.routes?.[0]
            const alt = data.routes?.[1] ?? (primary ? { ...primary, duration: primary.duration + 7 * 60 } : null)
            if (!alt) throw new Error('no route')
            const baseDuration = baseRoute?.durationSec ?? primary?.duration ?? alt.duration
            const addedMin = Math.max(1, Math.round((alt.duration - baseDuration) / 60))
            const now = new Date()
            setActiveRoute({
              destination: dest,
              durationSec: alt.duration,
              distanceM: alt.distance,
              geometry: alt.geometry.coordinates,
              departureIso: now.toISOString(),
              baseArrivalIso: new Date(now.getTime() + alt.duration * 1000).toISOString(),
              isAlternative: true,
              addedMin,
            })
            console.log('[scenario] alternative route applied, +', addedMin, 'min')
          } catch (e) {
            console.warn('[scenario] alt route OSRM failed:', e.message)
          }
        })()
      }

      // Climate control by intent: [SET_TEMP:n] / [FAN:n] / [FAN_BOOST].
      const setTempMatch = aiText.match(/\[SET_TEMP:\s*(\d{1,2})\s*\]/i)
      if (setTempMatch) {
        const t = Math.min(29, Math.max(17, parseInt(setTempMatch[1], 10)))
        aiText = aiText.replace(setTempMatch[0], '').trim()
        setTemperature(t)
        setIsAutoClimate(false)
        console.log('[climate] temp →', t)
      }
      const fanMatch = aiText.match(/\[FAN:\s*([1-5])\s*\]/i)
      if (fanMatch) {
        aiText = aiText.replace(fanMatch[0], '').trim()
        clearTimeout(fanBoostTimerRef.current)
        setFanSpeed(parseInt(fanMatch[1], 10))
        console.log('[climate] fan →', fanMatch[1])
      }
      if (/\[FAN_BOOST\]/i.test(aiText)) {
        aiText = aiText.replace(/\[FAN_BOOST\]/i, '').trim()
        clearTimeout(fanBoostTimerRef.current)
        const prev = fanSpeedRef.current
        setFanSpeed(5)
        fanBoostTimerRef.current = setTimeout(() => setFanSpeed(prev), 8000)
        console.log('[climate] fan boost (8s) ← from', prev)
      }

      // System volume by intent: [VOLUME:0-10] / [MUTE] / [UNMUTE]
      const volMatch = aiText.match(/\[VOLUME:\s*(\d{1,2})\s*\]/i)
      if (volMatch) {
        const v = Math.min(10, Math.max(0, parseInt(volMatch[1], 10)))
        aiText = aiText.replace(volMatch[0], '').trim()
        setVolume(v / 10)
        if (muted && v > 0) setMuted(false)
        openVolume()
        console.log('[volume] →', v, '/10')
      }
      if (/\[MUTE\]/i.test(aiText)) {
        aiText = aiText.replace(/\[MUTE\]/i, '').trim()
        setMuted(true)
        openVolume()
        console.log('[volume] muted')
      }
      if (/\[UNMUTE\]/i.test(aiText)) {
        aiText = aiText.replace(/\[UNMUTE\]/i, '').trim()
        setMuted(false)
        openVolume()
        console.log('[volume] unmuted')
      }

      const displayText = aiText || '(응답을 받지 못했습니다)'

      // Log the completed turn (text shown to the user).
      if (turnId) {
        completeTurn(turnId, { aiResponse: displayText, aiTimestamp, responseLatencyMs })
      }

      setMessages((prev) => {
        let newMessages = [...prev]
        if (selectedOptionMatch) {
          // Find the last ai-card and update its selectedOption
          for (let i = newMessages.length - 1; i >= 0; i--) {
            if (newMessages[i].type === 'ai-card') {
              newMessages[i] = { ...newMessages[i], selectedOption: selectedOptionMatch }
              break
            }
          }
        }

        if (options) {
          newMessages.push({ id: Date.now(), type: 'ai-card', text: displayText, options })
        } else {
          newMessages.push({ id: Date.now(), type: 'ai', text: displayText, hasRoundaboutCard: hasCard, isConfirmation })
        }
        return newMessages
      })

      if (displayText && TTS_KEY) {
        // Echo guard (2026-06-25): the mic is NOT opened while TTS is speaking —
        // doing so let the recognizer ingest the assistant's own voice and echo
        // it back as a fake user turn. Instead we wait for the queue to finish
        // (.then = last sentence ended) and only THEN, for voice turns, open the
        // follow-up window. The tts speaking-state guard also pauses the
        // wake-word recognizer for the whole utterance.
        speakText(displayText, TTS_KEY, speakingRateRef.current)
          .then(() => {
            if (turnId) markTtsPlayed(turnId)
            if (lastInputMethodRef.current === 'voice') {
              // Small settle delay so the speaker tail doesn't trip the mic on
              // open, then start a listening session. 종료는 무발화 5초 / 종료 조건어 /
              // 취소 버튼이 담당(고정 6초 컷 폐기 — 발화 중 끊김 방지).
              setTimeout(() => {
                if (!micActiveRef.current) startListening()
              }, FOLLOWUP_OPEN_DELAY_MS)
            }
          })
          .catch((err) => { if (turnId) markTtsError(turnId, err.message) })
      }
    } catch (err) {
      console.error('Gemini error:', err)
      setIsAITyping(false)
      if (turnId) failTurn(turnId, err.message)
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), type: 'ai', text: `오류: ${err.message}` },
      ])
    }
  }

  // ── Text send ─────────────────────────────────────────────
  const sendMessage = async (text, inputMethod = 'text') => {
    const trimmed = text.trim()
    if (!trimmed) return
    lastInputMethodRef.current = inputMethod
    setMessages((prev) => [...prev, { id: Date.now(), type: 'user', text: trimmed }])
    setInputText('')

    // Hydroplaning session counters — advance the simulated current location
    // and remember how many briefings we've already given. The freshly
    // computed value is what the very next Gemini call needs to see, so it's
    // passed inline alongside the setState (state itself doesn't update in
    // time for the closure below).
    let nextHydroState = hydroState
    if (activeScenario?.scenarioId === 'anxiety_hydroplaning') {
      const locInc = LOC_QUERY_RE.test(trimmed) ? 1 : 0
      const briefInc = BRIEFING_QUERY_RE.test(trimmed) ? 1 : 0
      if (locInc || briefInc) {
        nextHydroState = {
          locationCount: hydroState.locationCount + locInc,
          briefingCount: hydroState.briefingCount + briefInc,
        }
        setHydroState(nextHydroState)
      }
    }

    // Record the user turn (no-op if no trial is active in the operator console).
    const turnStartMs = performance.now()
    const turnId = addPendingTurn({
      userRawTranscript: trimmed,
      userTimestamp: new Date().toISOString(),
      inputMethod,
    })

    await callGemini(trimmed, turnId, turnStartMs, nextHydroState)
  }

  // ── Web Speech API (STT) ──────────────────────────────────
  // Keep a ref mirror so async callbacks (TTS completion, wake word) read the
  // live listening state instead of a stale closure value.
  useEffect(() => {
    isListeningRef.current = isListening
  }, [isListening])

  useEffect(() => {
    micActiveRef.current = micActive
  }, [micActive])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // 언마운트 시 자동 진행/초기 정상 타이머 정리(누수 방지).
  useEffect(() => () => {
    c2AutoTimersRef.current.forEach(clearTimeout)
    if (initialNormalTimerRef.current) clearTimeout(initialNormalTimerRef.current)
  }, [])

  // Subscribe to the TTS speaking-state (echo guard). While the AI is speaking
  // we (1) pause the wake-word recognizer and (2) drop any command-STT result,
  // so the mic never re-ingests the assistant's own voice. We also stop a live
  // command recognizer the instant TTS starts to release the mic cleanly.
  useEffect(() => {
    const off = onSpeakingChange((v) => {
      ttsSpeakingRef.current = v
      setTtsSpeaking(v)
      if (v && micActiveRef.current) {
        // TTS 시작 → 청취 세션 종료(자동 재시작 막고 "듣는 중" 숨김). 음성 턴이면 발화 종료 후
        // 아래 post-TTS 경로가 startListening 으로 다시 연다.
        stopListeningSession()
      }
    })
    return off
  }, [])

  // Mirror climate state so the Gemini call always sends the current values.
  useEffect(() => { temperatureRef.current = temperature }, [temperature])
  useEffect(() => { fanSpeedRef.current = fanSpeed }, [fanSpeed])
  useEffect(() => { volumeRef.current = volume }, [volume])
  useEffect(() => { mutedRef.current = muted }, [muted])
  useEffect(() => { activeRouteRef.current = activeRoute }, [activeRoute])
  useEffect(() => { currentPhaseRef.current = currentPhase }, [currentPhase])
  // Keep the scenarioId mirror in sync so the CARLA bridge handler (and its WoZ
  // interplay) always compares against the live active scenario, including when
  // the operator switches via Alt+Q/W or resets via Alt+R.
  useEffect(() => { activeScenarioIdRef.current = activeScenario?.scenarioId ?? null }, [activeScenario?.scenarioId])

  // ── ETA 타이머 구동 (시각 HMI 와 동일 규칙 · 변인통제) ─────────────────────
  // 시나리오 활성 = activeScenario 존재(음성은 simStage 대신 activeScenario 로 판정).
  const etaScenarioActive = !!activeScenario?.scenarioId
  // (a) 시나리오 (정상) 시작 / idle 복귀 시 ETA 를 05:00(300s)로 초기화.
  //     실 eta 를 받기 시작했으면(liveEtaRef) 자유진행 자체를 안 쓰므로 리셋도 무의미하지만,
  //     리셋은 WoZ/시나리오 경계 정합용이라 그대로 둔다(실값 수신 시 다음 frame 이 덮어씀).
  useEffect(() => {
    // 시나리오 (재)시작/종류 변경 시에만 앵커 리셋(이벤트와 무관). idle 복귀 시 앵커 해제.
    etaAnchorRef.current = etaScenarioActive ? Date.now() : null
    setEtaSeconds(etaIdleRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etaScenarioActive, activeScenario?.scenarioId])
  // 비정상(hold) 판정용 ref — 현재 페이즈 status.tone 이 'normal' 이 아니면(🔴/🟠/🟡) hold.
  // (과거엔 tone==='warning' 만 hold 였으나, normal 외 모든 상태에서 hold 로 통일 — 시각 정본.)
  useEffect(() => {
    const tone = (getPhase(activeScenario?.scenarioId, currentPhase)?.status ?? DEFAULT_STATUS).tone
    etaProblemRef.current = tone !== 'normal'
  }, [activeScenario?.scenarioId, currentPhase])
  // (b) 1초 "벽시계" 틱 — 마운트부터 상시 돈다(deps []). 시나리오 활성 여부로 인터벌을
  //     게이팅하지 않는다(과거 버그: 인터벌이 시나리오/이벤트에 묶여 정상 구간엔 안 돌고
  //     이벤트가 시작돼야만 줄어드는 것처럼 반전). 감소 여부만 매 틱에서 판정한다:
  //       • 실 eta 수신 중(liveEtaRef) → 자유진행 정지(실값이 진실원천).
  //       • 비정상 상태(etaProblemRef) → hold.
  //       • 그 외(정상🟢) → 매초 -1(최소 0).
  useEffect(() => {
    const id = setInterval(() => {
      if (liveEtaRef.current) return            // 실 eta 우선 — 클라 자유진행 안 함
      if (etaAnchorRef.current == null) return   // 시나리오 미시작(idle) → 정지
      // 260625 사용자 지시: 정상🟢에서만 1초씩 감소, 오류(🔴/🟠/🟡) 상태에선 멈춤(hold).
      //   (Windows 3R-c의 '시작앵커 벽시계'는 오류 중에도 감소해 폐기 — 정상구간만 진행.)
      if (etaProblemRef.current) return          // 오류 상태 → 시간 멈춤(hold)
      setEtaSeconds((s) => Math.max(0, s - 1))   // 정상 → 1초 감소
    }, 1000)
    return () => clearInterval(id)
  }, [])
  // 콜론(:) 깜빡임 — 모든 런타임에서 0.5s 토글(1초당 1회 깜빡). 카운트다운과 독립.
  useEffect(() => {
    const id = setInterval(() => setEtaColonOn((v) => !v), 500)
    return () => clearInterval(id)
  }, [])
  // Alt+R / Operator 리셋(hmiResetNonce) 시 ETA 초기화(WoZ 정합).
  useEffect(() => {
    if (hmiResetNonce === 0) return
    etaAnchorRef.current = Date.now()   // 리셋 = 시작 앵커 재설정(카운트다운 재시작)
    setEtaSeconds(etaIdleRef.current)
  }, [hmiResetNonce])

  // ── 배경 라이브 맵 status 색 동기화 (시각 pushDriveBgStatus 미러링) ────────
  // 현재 페이즈의 status.color(AutopilotStatus 단일 진실원천)를 배경 map_live
  // iframe 에 postMessage 로 보낸다 → map_live 가 ego/route 색을 동기화한다.
  const currentDriveColor =
    (getPhase(activeScenario?.scenarioId, currentPhase)?.status ?? DEFAULT_STATUS).color
  const pushDriveBgStatus = useCallback(() => {
    const msg = {
      type: 'hmi-status',
      color: currentDriveColor,
      scenario: activeScenario?.scenarioId === 'anxiety_hydroplaning' ? 'aquaplaning' : 'roundabout',
      index: currentPhase,
    }
    // 배경 풀블리드 iframe + 우측 '내비게이션' 패널 iframe '둘 다'에 push (시각 HMI 미러링).
    driveBgRef.current?.contentWindow?.postMessage(msg, '*')
    mapPanelRef.current?.contentWindow?.postMessage(msg, '*')
  }, [currentDriveColor, activeScenario?.scenarioId, currentPhase])
  // 색/단계가 바뀔 때마다(ready 핸드셰이크 후) 색 전송.
  useEffect(() => {
    if (driveBgReadyRef.current) pushDriveBgStatus()
  }, [pushDriveBgStatus])
  // map_live 가 로드 시 보내는 drive-bg-ready 를 받으면 현재 색 1회 push.
  useEffect(() => {
    const onMsg = (ev) => {
      const d = ev.data
      if (d && typeof d === 'object' && d.type === 'drive-bg-ready') {
        driveBgReadyRef.current = true
        pushDriveBgStatus()
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [pushDriveBgStatus])

  // mm:ss 포맷(시각 fmtEta 동일).
  const fmtEta = (totalSec) => {
    const s = Math.max(0, Math.floor(totalSec))
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  // Speak the scripted SA line whenever the operator advances to a new drive
  // phase (Ctrl+→/← on the HMI, or the Operator Console phase panel). Voice
  // only — nothing is posted to the chat. Phase 0 (idle/reset) and silent
  // ('ㅡ') phases stay quiet. A ref guards against re-speaking on unrelated
  // re-renders; only an actual phase change fires TTS.
  const spokenPhaseRef = useRef(0)
  // speakPhaseLine 정의는 위(onCarlaScenarioEvent deps)로 이동했다 — TDZ 방지(260625).
  useEffect(() => {
    if (currentPhase === spokenPhaseRef.current) return
    spokenPhaseRef.current = currentPhase
    speakPhaseLine(currentPhase)
  }, [currentPhase, activeScenario?.scenarioId, speakPhaseLine])

  // Follow-up countdown — once set (when TTS ends) tick down to 0 every
  // second, then end the listening session. Cleared early when the session
  // ends (passenger speaks / cancels / timeout → micActive false).
  useEffect(() => {
    if (followUpCountdown == null) return
    if (followUpCountdown <= 0) {
      stopListeningSession()
      setFollowUpCountdown(null)
      return
    }
    const id = setTimeout(() => setFollowUpCountdown((c) => (c == null ? null : c - 1)), 1000)
    return () => clearTimeout(id)
  }, [followUpCountdown])

  // 세션이 끝나면(micActive false) 카운트다운도 정리. isListening 은 침묵 자동종료로
  // 깜빡이므로 micActive 기준으로 판단해야 follow-up 창이 조기 종료되지 않는다.
  useEffect(() => {
    if (!micActive) setFollowUpCountdown(null)
  }, [micActive])

  // Briefly expand the volume slider (manual click, bar drag, or AI tag).
  // Re-extends an auto-collapse timer each time it's called.
  const openVolume = () => {
    setVolumeOpen(true)
    clearTimeout(volumeCloseTimerRef.current)
    volumeCloseTimerRef.current = setTimeout(() => setVolumeOpen(false), 2500)
  }

  // 4-step icon (mute → low → mid → full) that mirrors the actual level.
  const renderVolumeIcon = () => {
    const v = muted ? 0 : volume
    if (v === 0) return <VolumeX size={22} />
    if (v < 0.34) return <Volume size={22} />
    if (v < 0.67) return <Volume1 size={22} />
    return <Volume2 size={22} />
  }

  // 한 청취 세션을 명시적으로 종료한다. micActive=false 로 내려 onend 의 자동 재시작을
  // 막은 뒤 인식기를 정지하고 세션 타이머를 정리한다. ("듣는 중" 표시도 사라진다.)
  const stopListeningSession = () => {
    setMicActive(false)
    micActiveRef.current = false               // onend 가 즉시 읽도록 동기 반영
    if (listenTimeoutRef.current) { clearTimeout(listenTimeoutRef.current); listenTimeoutRef.current = null }
    try { recognitionRef.current?.stop() } catch { /* noop */ }
  }

  // 대화창이 열려 있을 때 종료 조건어가 들어오면: "음성 대화를 종료합니다." 안내를
  // 텍스트로만(=TTS 없이, callGemini/speakText 경로를 타지 않음) 띄운 뒤 잠시 후 대화창을
  // 닫는다(setMessages([]) → idle 복귀). 대화가 없으면(=idle) 아무 것도 하지 않는다.
  const endVoiceConversation = () => {
    if (messagesRef.current.length === 0) return false   // 대화창 없음 → 호출자가 단순 mic 정지만
    setMessages((prev) => (prev.length === 0 ? prev : [
      ...prev,
      { id: Date.now(), type: 'ai', text: '음성 대화를 종료합니다.', isConfirmation: true },
    ]))
    setTimeout(() => setMessages([]), 1400)              // 안내를 읽을 시간 후 닫기
    return true
  }

  // 무발화 타이머(재무장). 발화/소리가 감지되면 호출해 5초 카운트를 리셋한다.
  // 5초간 아무 소리도 없으면 세션을 자동 종료한다.
  const armSilenceTimer = () => {
    if (listenTimeoutRef.current) clearTimeout(listenTimeoutRef.current)
    listenTimeoutRef.current = setTimeout(() => { stopListeningSession() }, LISTEN_SILENCE_MS)
  }

  // 인식기 인스턴스 1회 가동. 침묵으로 onend 되면, 세션(micActive)이 살아있는 한
  // armRecognizer 가 다시 호출되어 마이크를 계속 열어둔다(세션 자체는 startListening 이 관리).
  const armRecognizer = () => {
    if (isListeningRef.current) return         // 이미 인식기 가동 중

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now(), type: 'ai', text: 'Chrome 또는 Edge 브라우저에서 음성 기능을 사용할 수 있습니다.' },
      ])
      stopListeningSession()
      return
    }

    const rec = new SR()
    rec.lang = 'ko-KR'
    rec.interimResults = false
    rec.maxAlternatives = 1
    recognitionRef.current = rec

    rec.onstart = () => setIsListening(true)

    // 소리/발화가 감지되면 무발화 타이머 리셋 → 말하는 동안엔 5초 컷이 걸리지 않는다.
    rec.onsoundstart = () => { if (micActiveRef.current) armSilenceTimer() }
    rec.onspeechstart = () => { if (micActiveRef.current) armSilenceTimer() }

    rec.onresult = async (e) => {
      const transcript = e.results[0][0].transcript
      setIsListening(false)
      // 종료 조건어 → 명령으로 처리하지 않고 세션만 종료(공백·문장부호 제거 후 정확 매칭).
      const norm = transcript.replace(/[\s.,!?~]/g, '')
      if (CANCEL_WORDS.includes(norm)) {
        console.log('[stt] cancel word → end session:', transcript)
        stopListeningSession()
        endVoiceConversation()   // 대화창이 떠 있으면 "음성 대화를 종료합니다." 후 닫기(음성 없음)
        return
      }
      // 발화를 받았으니 세션 종료(자동 재시작 방지) — 그 다음 처리.
      stopListeningSession()
      // Echo guard: if the AI is mid-utterance, this result is almost certainly
      // the recognizer catching the assistant's own TTS — drop it so it never
      // becomes a (duplicate) user message.
      if (ttsSpeakingRef.current) {
        console.log('[stt] dropped self-echo while TTS speaking:', transcript)
        return
      }
      await sendMessage(transcript, 'voice')
    }

    rec.onerror = (e) => {
      // no-speech/aborted 는 침묵 종료에 해당 — onend 의 재시작 로직에 맡긴다.
      // 그 외(권한 거부 등)는 세션을 끝낸다.
      if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') {
        console.error('STT error:', e.error)
        stopListeningSession()
      }
      setIsListening(false)
    }

    // 인식기가 멈추면(침묵 자동종료 포함) isListening 은 내리되, 세션이 살아있고 TTS 가
    // 말하는 중이 아니면 잠시 뒤 인식기를 재가동해 마이크를 계속 열어둔다 → "듣는 중" 유지.
    // (무발화 타이머는 리셋하지 않는다 — 소리가 났을 때만 onsoundstart/onspeechstart 가 리셋.)
    rec.onend = () => {
      setIsListening(false)
      if (micActiveRef.current && !ttsSpeakingRef.current) {
        setTimeout(() => {
          if (micActiveRef.current && !isListeningRef.current && !ttsSpeakingRef.current) armRecognizer()
        }, LISTEN_RESTART_MS)
      }
    }

    try { rec.start() } catch { /* 직전 인스턴스가 아직 정리 안 됨 — onend 재시작이 곧 재시도 */ }
  }

  // 새 청취 세션 시작 — micActive 를 올리고 무발화 타이머를 건 뒤 인식기를 가동한다.
  const startListening = () => {
    setMicActive(true)
    micActiveRef.current = true                // 동기 반영(곧바로 armRecognizer/onend 가 읽음)
    armSilenceTimer()
    armRecognizer()
  }

  const handleMicClick = () => {
    // Bless audio playback under this user gesture so the WebSocket-driven phase
    // TTS (no gesture of its own) isn't muted by Chrome's autoplay policy.
    unlockAudio()
    if (micActiveRef.current) {
      stopListeningSession()                   // 토글 오프 — 세션을 끝내(재시작 안 함)
      return
    }
    startListening()
  }

  // ── Handle voice mic click on idle screen ─────────────────
  const handleVoiceMicClick = () => {
    handleMicClick()
  }

  // ── Wake word "자인아" → start STT ─────────────────────────
  useWakeWord({
    onWake: () => {
      if (!micActiveRef.current) handleMicClick()
    },
    // Pause the wake-word recognizer while a listening session owns the mic OR
    // while TTS is speaking — both prevent the recognizer from hearing the
    // assistant's own voice and false-firing the wake word. micActive(세션)으로
    // 판단해 인식기 재시작 사이의 깜빡임에도 웨이크워드가 끼어들지 않게 한다.
    isSttActive: micActive || isListening || ttsSpeaking,
  })

  const hasConversation = messages.length > 0
  const showSplitLayout = hasConversation || !!activeApp

  const APP_ICONS = [
    { id: 'Navigation', icon: iconNav },
    { id: 'Phone', icon: iconPhone },
    { id: 'Music', icon: iconMusic },
    { id: 'Mail', icon: iconMail },
    { id: 'Calendar', icon: iconCalendar },
  ]

  // 내비 패널 열림 = 메인 풀블리드 배경맵(.drive-bg-iframe)을 숨기고 패널 맵 하나만 보이게
  // (시각 HMI 미러링 · 변인통제). .screen 에 nav-panel-open 클래스를 토글한다.
  const isNavPanelOpen = activeApp === 'Navigation'

  // ── 시각 HMI 미러 chrome (변인통제) ─────────────────────────────
  // 현재 페이즈 status(🟢/🔴/🟠/🟡) — 상단 빛무리 + 가운데 pill 색/문구 구동.
  const phaseStatus = getPhase(activeScenario?.scenarioId, currentPhase)?.status ?? DEFAULT_STATUS
  // 주행 화면(idle/driving)에서만 상단 빛무리 + FAB 노출 — 대화/앱/팝업이 열리면 숨김.
  const showDrivingChrome = !hasConversation && !activeApp && !showCarStatus

  return (
    <div className="hmi-viewport">
      <div className={`screen${isNavPanelOpen ? ' nav-panel-open' : ''}`} ref={screenRef}>
      {/* ── 라이브 주행 맵 — 풀블리드 고정 배경 레이어 (시각 HMI 와 byte-동일 맵) ──
          map_live.html(public/map_live.html)을 iframe 으로 깔아 ws://127.0.0.1:8766 의
          라이브 CARLA ego 를 Town03/04 위에 표시한다. 시각 repo 의 동일 파일·동일 CSS
          (.drive-bg-iframe opacity 0.30 · z0 · pointer-events:none)를 미러링 = 변인통제.
          .screen 은 #f8f8f8 흰 받침이라 opacity 0.30 이어도 밝게 비친다.
          drive-bg-ready / hmi-status 핸드셰이크로 ego/route 색을 페이즈 status 색과 동기. */}
      <iframe
        ref={driveBgRef}
        className="drive-bg-iframe"
        src={`/map_live.html?map=${currentMap}&ws=${CARLA_WS}&v=${MAP_LIVE_CACHE_BUST}`}
        title="live drive map background"
        tabIndex={-1}
        aria-hidden="true"
        loading="eager"
        onLoad={() => { driveBgReadyRef.current = true; pushDriveBgStatus() }}
      />
      {/* 맵 위 은은한 흰 워시 — 보이스바·상태칩·앱카드 가독성 확보(맵은 순수 배경). */}
      <div className="drive-bg-scrim" aria-hidden="true" />

      {/* ── 상단 빛무리(Top color bloom) — 시각 HMI(311:6517) byte-동일 미러 = 변인통제.
          status 색(🟢/🔴/🟠/🟡)을 따라가는 부드러운 elliptical 글로우. 주행 화면에서만.
          status 전환 시 cross-fade, 일렁임은 opacity/scaleY 호흡. */}
      {showDrivingChrome && (
        <motion.div
          className="absolute pointer-events-none"
          style={{ top: 79, left: 0, width: 1920, height: 260, transformOrigin: 'top center', zIndex: 2 }}
          animate={{ opacity: [0.78, 0.96, 0.84, 0.88], scaleY: [0.97, 1.03, 0.99, 1.0] }}
          transition={{
            opacity: { duration: 5.2, repeat: Infinity, ease: 'easeInOut' },
            scaleY: { duration: 6.6, repeat: Infinity, ease: 'easeInOut' },
          }}
        >
          <AnimatePresence mode="popLayout">
            <motion.div
              key={phaseStatus.color}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: 'easeInOut' }}
              className="absolute inset-0"
              style={{
                background: `radial-gradient(ellipse 38% 70% at 50% -5%, ${phaseStatus.color}E6 0%, ${phaseStatus.color}80 25%, ${phaseStatus.color}40 45%, ${phaseStatus.color}1A 65%, ${phaseStatus.color}00 85%)`,
              }}
            />
          </AnimatePresence>
        </motion.div>
      )}

      {/* ── Top Status Bar ───────────────────────────────────── */}
      <div className="top-bar">
        <div className="top-bar-left">
          <span className="time">{formatTime(currentTime)}</span>
          <div className="weather">
            <img src={iconSun} alt="" />
            <span>24°C</span>
          </div>
        </div>
        <div className="top-bar-right">
          <img src={iconWifi} alt="" />
          <img src={iconBattery} alt="" />
          <span className="battery-text">100%</span>
        </div>
      </div>

      {/* ── Main Content: Unified Responsive Layout ───────────── */}
      <div className="layout-container" style={{ position: 'absolute', top: 104, left: 49, right: 51, height: 828, display: 'flex', gap: 11, zIndex: 10 }}>

        {/* Center Panel: Idle or Chat */}
        <motion.div
          layout
          className={`panel-main ${hasConversation ? 'chat-mode' : 'idle-mode'}`}
          style={{ flex: 1, position: 'relative', borderRadius: 24, overflow: 'hidden', background: hasConversation ? 'white' : 'transparent', transition: 'background 0.3s' }}
        >
          <AnimatePresence mode="wait">
            {!hasConversation ? (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ duration: 0.4 }}
                style={{ position: 'absolute', inset: 0 }}
              >
                {/* 2026-06-27 사용자 지시: 음성 검색바(VoiceBar) 제거 + 중앙을 시각 HMI 와
                    동일 구성(가운데 정렬 상태 pill + 큰 본문)으로 통일 = 변인통제.
                    웨이크워드 "자인아"는 useWakeWord 로 계속 동작(보이는 마이크 바 없이도 음성 입력).
                    top 283 = 시각 HMI 메인 캔버스(screen top 387) − layout-container top 104 → 좌표 정합. */}
                <div style={{ position: 'absolute', top: 283, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* AutopilotStatus pill (가운데) — 시각 HMI pill 과 동일 디자인·좌표. */}
                  <div style={{ height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={phaseStatus.text}
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.32, ease: 'easeOut' }}
                        className="flex items-center rounded-full"
                        style={{
                          gap: 11,
                          padding: '15px 29px',
                          background: 'rgba(255,255,255,0.85)',
                          backdropFilter: 'blur(6px)',
                          WebkitBackdropFilter: 'blur(6px)',
                          border: '1px solid rgba(255,255,255,0.6)',
                          boxShadow: '0px 4px 14px rgba(0,0,0,0.08)',
                        }}
                      >
                        <span
                          className="rounded-full shrink-0"
                          style={{ width: 13, height: 13, background: phaseStatus.color, boxShadow: `0 0 8px ${phaseStatus.color}80` }}
                        />
                        <span style={{ fontSize: 24, lineHeight: '24px', letterSpacing: '-0.48px', color: '#131417', fontWeight: 500, whiteSpace: 'nowrap' }}>
                          {phaseStatus.text}
                        </span>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Hero — 웨이크워드 안내(고정). 음성 모달리티는 SA 설명을 화면에 띄우지 않고
                      TTS 로만 발화 → 오류 시나리오 중에도 이 안내문을 고정(사용자 게이트 2026-06-27). */}
                  <p style={{ marginTop: 15, marginBottom: 0, fontSize: 62, lineHeight: 1.28, letterSpacing: '-2.48px', fontWeight: 600, color: '#676767', textAlign: 'center', maxWidth: 1478 }}>
                    필요한 게 있으면 ‘자인아’ 라고 불러주세요.
                  </p>

                  {/* "듣는 중" subtext — 웨이크워드 "자인아" 인식 후 STT 활성(isListening) 동안만 노출.
                      검색바(VoiceBar) 제거로 사라진 청취 피드백을 본문 아래 한 줄로 대체(이미지 정본 2026-06-27).
                      column 이 top-anchored 라 등장/퇴장해도 hero 위치는 고정. */}
                  <AnimatePresence>
                    {micActive && (
                      <motion.div
                        key="listening-sub"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                      >
                        <span style={{ fontSize: 38, lineHeight: 1.4, letterSpacing: '-1.2px', fontWeight: 400, color: '#a0a0a0' }}>
                          듣는 중
                        </span>
                        <span style={{ display: 'inline-flex', gap: 7 }}>
                          {[0, 1, 2, 3].map((i) => (
                            <motion.span
                              key={i}
                              style={{ width: 7, height: 7, borderRadius: '50%', background: '#c2c2c2', display: 'inline-block' }}
                              animate={{ opacity: [0.25, 1, 0.25] }}
                              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }}
                            />
                          ))}
                        </span>
                        {/* 취소(kill) 버튼 — 즉시 청취 종료. (조건어 "취소/종료/아니야" · 무발화 5초로도 종료) */}
                        <motion.button
                          whileTap={{ scale: 0.94 }}
                          onClick={() => stopListeningSession()}
                          style={{ marginLeft: 18, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 9999, border: '1px solid rgba(19,20,23,0.12)', background: 'rgba(255,255,255,0.7)', color: '#8a8a8a', fontSize: 26, fontWeight: 500, cursor: 'pointer', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
                          aria-label="음성 입력 취소"
                        >
                          <X size={22} strokeWidth={2.2} />
                          취소
                        </motion.button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="panel-chat"
                style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}
              >
                {/* 대화 창 닫기 X — 웨이크워드/음성 명령으로 열린 대화 창을 닫고 idle 로 복귀.
                    앱 패널 헤더 X(둥근 흰 버튼)와 시각적으로 일관. 대화만 비우므로 진행 중
                    TTS/페이즈/배경맵 status 색에는 영향 없음(messages 상태만 초기화). */}
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  whileHover={{ scale: 1.05 }}
                  onClick={() => setMessages([])}
                  aria-label="대화 닫기"
                  style={{
                    position: 'absolute', top: 20, right: 20, zIndex: 5,
                    width: 52, height: 52, borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.92)', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  <X size={28} color="#131417" strokeWidth={2.2} />
                </motion.button>

                {/* Chat Messages */}
                <div className="chat-messages">
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28 }}
                      className={`message-row ${msg.type === 'user' ? 'user' : ''}`}
                    >
                      {/* Voice-only mode: no "자세히 보기" detail card and no
                          option chips — every AI turn is a plain text bubble and
                          the actual guidance is spoken via TTS. */}
                      <div className={`message-bubble ${msg.type === 'ai-card' ? 'ai' : msg.type} ${msg.isConfirmation ? 'confirmation' : ''}`}>
                        {msg.text}
                      </div>
                    </motion.div>
                  ))}

                  <AnimatePresence>
                    {isAITyping && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="message-row"
                      >
                        <div className="message-bubble ai" style={{ padding: '20px 32px' }}>
                          <TypingDots />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div ref={messagesEndRef} />
                </div>

                {/* 2026-06-27: 하단 음성 검색바(VoiceBar) 제거 — 웨이크워드 "자인아"로
                    대화 중에도 이어 말할 수 있다. 대신 청취 중(micActive)에는 하단에
                    "듣는 중 ····" 표시를 유지(대화 창에서도 마이크 상태가 보이도록). */}
                <AnimatePresence>
                  {micActive && (
                    <motion.div
                      key="listening-sub-chat"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '18px 0 26px' }}
                    >
                      <span style={{ fontSize: 32, letterSpacing: '-1px', fontWeight: 400, color: '#a0a0a0' }}>듣는 중</span>
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        {[0, 1, 2, 3].map((i) => (
                          <motion.span
                            key={i}
                            style={{ width: 6, height: 6, borderRadius: '50%', background: '#c2c2c2', display: 'inline-block' }}
                            animate={{ opacity: [0.25, 1, 0.25] }}
                            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }}
                          />
                        ))}
                      </span>
                      {/* 취소(kill) 버튼 — 즉시 청취 종료. */}
                      <motion.button
                        whileTap={{ scale: 0.94 }}
                        onClick={() => stopListeningSession()}
                        style={{ marginLeft: 14, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9999, border: '1px solid rgba(19,20,23,0.12)', background: 'rgba(255,255,255,0.85)', color: '#8a8a8a', fontSize: 22, fontWeight: 500, cursor: 'pointer' }}
                        aria-label="음성 입력 취소"
                      >
                        <X size={18} strokeWidth={2.2} />
                        취소
                      </motion.button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Status pill stays visible during conversation so the
                    driving alert state never disappears. */}
                <StatusPill status={getPhase(activeScenario?.scenarioId, currentPhase)?.status ?? DEFAULT_STATUS} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Right Popup Panel (Roundabout Details) */}
        <AnimatePresence>
          {showCarStatus && (
            <motion.div
              layout
              initial={{ width: 0, opacity: 0, marginLeft: 0 }}
              animate={{ width: 593, opacity: 1, marginLeft: 11 }}
              exit={{ width: 0, opacity: 0, marginLeft: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              style={{ overflow: 'hidden', flexShrink: 0, borderRadius: 24, background: '#d9d9d9', position: 'relative' }}
            >
              <motion.div
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0, right: 0.6 }}
                dragMomentum={false}
                onDragEnd={(_, info) => {
                  if (info.offset.x > 120 || info.velocity.x > 600) setShowCarStatus(false)
                }}
                style={{ width: '100%', height: '100%', cursor: 'grab', position: 'relative' }}
                whileDrag={{ cursor: 'grabbing' }}
              >
                {(() => {
                  const animSrc = animationForScenario(activeScenario?.scenarioId)
                  // Animation plays once and auto-closes on ended. If no
                  // scenario is active we fall through to the static image.
                  return animSrc ? (
                    <video
                      key={animSrc}
                      src={animSrc}
                      autoPlay
                      muted
                      playsInline
                      onEnded={() => setShowCarStatus(false)}
                      onError={() => {
                        console.warn('[scenario-anim] missing or failed to load:', animSrc)
                        // Leave the popup open with no content; user can close
                        // manually (drag or X). Avoid mutating state mid-render.
                      }}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', background: '#000' }}
                    />
                  ) : (
                    <img
                      src={imgNavigation}
                      alt="navigation view"
                      draggable={false}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                    />
                  )
                })()}
              </motion.div>
              <motion.button
                whileTap={{ scale: 0.9 }}
                whileHover={{ scale: 1.05 }}
                onClick={() => setShowCarStatus(false)}
                aria-label="닫기"
                style={{
                  position: 'absolute', top: 20, right: 20,
                  width: 52, height: 52, borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.92)', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <X size={28} color="#131417" strokeWidth={2.2} />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Right Panel: App View */}
        <AnimatePresence>
          {activeApp && (
            <motion.div
              // 패널 너비 615 = 시각 HMI(HCI-prototype-interface) App Side Panel 과 동일(변인통제).
              // marginLeft 11 = layout-container gap 과 정합(시각 패널 마진 미러).
              initial={{ opacity: 0, width: 0, marginLeft: 0 }}
              animate={{ opacity: 1, width: 615, marginLeft: 11 }}
              exit={{ opacity: 0, width: 0, marginLeft: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              style={{ overflow: 'hidden', flexShrink: 0, borderRadius: 24 }}
            >
              <div className="panel-app" style={{ width: 615, height: '100%', borderRadius: 24, overflow: 'hidden', background: '#f5f5f7' }}>
                {/* GNB '내비게이션' 버튼이 여는 화면 = 배경에 깔린 라이브 맵(map_live)을
                    전경(opacity 1)으로 띄운 뷰어. 시각 HMI(HCI-prototype-interface) 미러링 =
                    변인통제. (음성 목적지 검색용 Kakao NavigationAppMap 은 AppView 안에 보존되나
                    GNB 내비 버튼은 시각과 동일하게 라이브 맵 뷰어를 연다.)
                    map_live 는 iframe 안(window.self!==top)에서 .embed 모드라 편집 패널/테두리 없이
                    맵만 채운다. 패널이 열렸을 때만 마운트(닫히면 언마운트 → WS/WebGL 해제). */}
                {activeApp === 'Navigation' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
                    {/* Header — 닫기 X 는 기존 패널 닫기 패턴(setActiveApp(null)) 유지. */}
                    <div
                      style={{
                        height: 96, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14,
                        padding: '0 28px', background: '#ffffff',
                        borderBottom: '1px solid rgba(19, 20, 23, 0.08)',
                      }}
                    >
                      <motion.button
                        whileTap={{ scale: 0.92 }}
                        onClick={() => setActiveApp(null)}
                        aria-label="닫기"
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: 6, color: '#131417', borderRadius: 16,
                          width: 56, height: 56, marginLeft: -8,
                        }}
                      >
                        <ChevronLeft size={40} strokeWidth={2.2} />
                      </motion.button>
                      <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: -1, color: '#131417' }}>
                        내비게이션
                      </span>
                    </div>
                    <iframe
                      ref={mapPanelRef}
                      className="map-panel-iframe"
                      src={`/map_live.html?map=${currentMap}&ws=${CARLA_WS}&v=${MAP_LIVE_CACHE_BUST}`}
                      title="네비게이션 라이브 맵"
                      loading="eager"
                      style={{ flex: 1, width: '100%', minHeight: 0, border: 'none', display: 'block', opacity: 1 }}
                      onLoad={() => pushDriveBgStatus()}
                    />
                  </div>
                ) : (
                  <AppView
                    id={activeApp}
                    onClose={() => setActiveApp(null)}
                    activeRoute={activeRoute}
                    setActiveRoute={setActiveRoute}
                    callingContact={callingContact}
                    callState={callState}
                    startCall={startCall}
                    endCall={endCall}
                    currentLocation={
                      activeScenario?.scenarioId === 'anxiety_hydroplaning' && hydroState.locationCount > 0
                        ? (hydroState.locationCount >= 5
                            ? HYDRO_FINAL_LOCATION
                            : HYDRO_LOCATIONS[hydroState.locationCount] ?? DEFAULT_CURRENT_LOCATION)
                        : DEFAULT_CURRENT_LOCATION
                    }
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── FAB — 주행 판단 과정(시각 HMI 미러, 우하단 GNB 위). 음성 모달리티이므로
          텍스트 패널을 열지 않고 현재 페이즈의 판단 SA 문장을 TTS 로 다시 읽어준다
          (화면 텍스트 노출 X → 모달리티 격리 유지). 주행 화면에서만 표시. */}
      {showDrivingChrome && (
        <motion.button
          whileTap={{ scale: 0.94 }}
          whileHover={{ scale: 1.04 }}
          onClick={() => {
            if (ttsSpeakingRef.current) return            // 발화 중 중복 방지
            if (activeScenario?.scenarioId && currentPhase > 0) speakPhaseLine(currentPhase)
            else if (TTS_KEY) speakText('정상 주행 중입니다', TTS_KEY, speakingRateRef.current).catch(() => {})
          }}
          className="absolute bg-transparent border-0 p-0 cursor-pointer"
          style={{ top: 745, left: 1664, width: 187, height: 187, zIndex: 25 }}
          aria-label="주행 판단 과정 듣기"
        >
          <img src={iconCarAlert} alt="" className="block w-full h-full select-none" style={{ pointerEvents: 'none' }} />
        </motion.button>
      )}

      {/* ── Bottom App Bar ────────────────────────────────────── */}
      <div className="bottom-bar">
        {/* Left: Home, Climate Controls */}
        <div className="bottom-left">
          <motion.button
            whileTap={{ scale: 0.92 }}
            className="btn-home"
            onClick={() => {
              setMessages([])
              setActiveApp(null)
              setShowCarStatus(false)
            }}
          >
            <img src={iconHome} alt="Home" />
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            className="btn-chevron"
            onClick={() => { setTemperature((v) => Math.max(17, v - 1)); setIsAutoClimate(false) }}
          >
            <img src={iconChevronDown} alt="Temp down" />
          </motion.button>

          <div className="climate-display">
            <span className={`climate-temp ${!isAutoClimate ? (temperature <= 22 ? 'cool' : 'heat') : ''}`}>
              {temperature}.0
            </span>
            <button
              className="climate-mode"
              onClick={() => setIsAutoClimate(true)}
            >
              {isAutoClimate ? (
                <img src={iconAC} alt="" />
              ) : temperature <= 22 ? (
                <Snowflake size={18} color="#4A90D9" />
              ) : (
                <Flame size={18} color="#E85D5D" />
              )}
              <span className={!isAutoClimate ? (temperature <= 22 ? 'cool' : 'heat') : ''}>
                {isAutoClimate ? 'AUTO' : temperature <= 22 ? 'COOL' : 'HEAT'}
              </span>
            </button>
          </div>

          <motion.button
            whileTap={{ scale: 0.92 }}
            className="btn-chevron"
            onClick={() => { setTemperature((v) => Math.min(29, v + 1)); setIsAutoClimate(false) }}
          >
            <img src={iconChevronUp} alt="Temp up" />
          </motion.button>

        </div>

        {/* Center: ETA (minutes-until-arrival) + current speed. The Figma
            (311:7556) replaced the absolute arrival clock with a "N 분 뒤"
            countdown and dropped distance in favor of a live km/h readout. */}
        <div className="bottom-center">
          {/* 도착 예정 = etaSeconds(mm:ss) · 현재 속도 = currentSpeed(km/h).
              둘 다 CARLA(:8766) 라이브로 구동 — 시각 HMI 의 fmtEta·speed 와 동일 규칙
              (변인통제). idle/리셋 시 03:00 으로 복귀. */}
          <div className="gnb-eta-block">
            <span className="gnb-eta-label">도착 예정</span>
            <span className="gnb-eta-value">
              {(() => { const [mm, ss] = fmtEta(etaSeconds).split(':'); return (
                <>{mm}<span style={{ opacity: etaColonOn ? 1 : 0 }}>:</span>{ss}</>
              ) })()}
            </span>
          </div>
          <div className="gnb-eta-block">
            <span className="gnb-eta-label">현재 속도</span>
            <span className="gnb-eta-value">
              {Math.round(currentSpeed)}<span className="gnb-eta-unit"> km/h</span>
            </span>
          </div>
        </div>

        {/* Right: App icons + Menu (volume / fan are accessible via voice
            and the Control Panel — hidden from the GNB per the new layout). */}
        <div className="bottom-right">
          {APP_ICONS.map((item) => (
            <motion.button
              key={item.id}
              whileTap={{ scale: 0.9 }}
              onClick={() => setActiveApp((v) => (v === item.id ? null : item.id))}
              className={`app-icon-btn ${activeApp === item.id ? 'active' : ''}`}
            >
              <img src={item.icon} alt={item.id} />
            </motion.button>
          ))}
          <motion.button
            whileTap={{ scale: 0.92 }}
            className="btn-menu"
            onClick={() => setIsControlPanelOpen(v => !v)}
            aria-label="메뉴"
          >
            <img src={iconMenu} alt="Menu" />
          </motion.button>
        </div>
      </div>

      {/* ── Control Panel Drawer (Vehicle controls + Media apps) ── */}
      <AnimatePresence>
        {isControlPanelOpen && (
          <ControlPanel onClose={() => setIsControlPanelOpen(false)} />
        )}
      </AnimatePresence>
      </div>
    </div>
  )
}

// ── App shell: router + experiment provider ────────────────
// /hmi      → participant-facing vehicle screen (new design)
// /operator → researcher operator console (drives scenarios, logs sessions)
function App() {
  return (
    <BrowserRouter>
      <ExperimentProvider>
        <Routes>
          <Route path="/hmi" element={<VehicleHMI />} />
          <Route path="/operator" element={<OperatorConsole />} />
          <Route path="*" element={<Navigate to="/hmi" replace />} />
        </Routes>
      </ExperimentProvider>
    </BrowserRouter>
  )
}

export default App
