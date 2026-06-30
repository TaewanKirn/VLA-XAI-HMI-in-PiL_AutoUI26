import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Flame, Snowflake, Search, Menu, ArrowLeft, Send } from 'lucide-react'

import { ExperimentProvider, useExperiment } from './context/ExperimentContext'
import OperatorConsole from './components/OperatorConsole'
import { getGeminiResponse } from './services/gemini'
import { useCarlaBridge } from './hooks/useCarlaBridge'
import { mapEventToSequenceIndex, CARLA_WS_URL } from './services/carlaBridge'

// map_live.html 은 public/ 정적 파일이라 Vite HMR 대상이 아니고, iframe 문서는
// 브라우저가 적극 캐시한다 → 파일을 수정해도 부모 새로고침만으로 옛 버전이 뜨는
// 함정이 있다. 페이지 로드마다 새 토큰을 붙여(?v=) 매 로드 최신 파일을 받게 한다.
// (모듈 로드 시 1회 고정 → 리렌더로 iframe 이 매번 reload 되지는 않음.)
const MAP_LIVE_CACHE_BUST = Date.now()

// === ASSET IMPORTS ===
// Icons
import iconSun from '../assets/icons/Icon-15.svg'       // sun / weather
import iconWifi from '../assets/icons/Icon-14.svg'       // wifi
import iconBattery from '../assets/icons/Icon-12.svg'    // battery
import iconHome from '../assets/icons/Icon-8.svg'        // home
import iconChevronDown from '../assets/icons/Icon-7.svg' // chevron down
import iconChevronUp from '../assets/icons/Icon-4.svg'   // chevron up
import iconAC from '../assets/icons/Icon-6.svg'          // ac / snowflake
import iconSend from '../assets/icons/Icon-3.svg'        // send / navigation
import iconPhone from '../assets/icons/Icon-5.svg'       // phone
import iconMusic from '../assets/icons/Icon-2.svg'       // music
import iconMail from '../assets/icons/Icon-1.svg'        // mail
import iconCalendar from '../assets/icons/Icon.svg'      // calendar
import iconCarAlert from '../assets/icons/car-icon.svg'  // FAB — vehicle alert (Figma 304:1138)

import MusicApp from './components/MusicApp'
import MailApp from './components/MailApp'
import PhoneApp from './components/PhoneApp'
import CalendarApp from './components/CalendarApp'
import NavigationApp from './components/NavigationApp'
import ControlPanel from './components/ControlPanel'

// ── AutopilotStatus pill variants (single design, dot color + text vary) ──
// 각 시퀀스 step의 status 키가 이 표를 lookup해서 pill 색과 텍스트를 결정.
// sequence.md 의 이모지 색에 맞춤 (Apple system palette):
//   🟢 normal #34C759 / 🔴 errored #FF3B30 / 🟠 progressing #FF9500 / 🟡 resolving #FFCC00
const STATUS_VARIANTS = {
  normal:      { text: '정상 주행 중입니다',       color: '#34C759' }, // 🟢
  errored:     { text: '오류가 감지되었습니다',     color: '#FF3B30' }, // 🔴
  progressing: { text: '오류 원인을 파악 중입니다', color: '#FF9500' }, // 🟠
  resolving:   { text: '오류를 해결 중입니다',      color: '#FFCC00' }, // 🟡
}

// ── VLA scenario sequences (출처: sequence.md) ───────────────────
// 시나리오 활성 시 Ctrl+Left/Right 로 step 이동.
// 각 step: {
//   status   — pill variant 키
//   hero     — XAI zoom-in 텍스트
//   sub      — XAI zoom-out 텍스트 (없으면 null)
//   judgment — 주행 판단 과정 패널(Figma 311:7163) 로그 라인.
//              시퀀스 진행 시(처음 방문하는 step 한정) 누적 append.
// }
const SEQUENCES = {
  roundabout: [
    { status: 'normal',      hero: '목적지까지 안전하게 주행 중입니다.',                                       sub: null,                                                              judgment: '회전교차로 입구 도착 · 진입 간격 탐색' }, // C1-1
    { status: 'errored',     hero: '교차로 진입 간격 확보에 어려움을 겪고 있습니다.',                           sub: '안전 간격을 만들면 진입합니다.',                                  judgment: '입구 진입 간격 확보 어려움' },             // C1-2 (260627: 정본 따라 '회전교차로'→'교차로')
    { status: 'normal',      hero: '목적지까지 안전하게 주행 중입니다.',                                       sub: null,                                                              judgment: '회전교차로 진입 성공' },                   // C1-3
    { status: 'errored',     hero: '비정상적인 반복 회전이 감지되었습니다.',                                   sub: '2차로 진출에 실패해 같은 구간을 다시 주행합니다.',                  judgment: '2바퀴 후 같은 구간 재회전(바퀴마다 반복)' },// C1-4 (260625: 2바퀴 후 감지·바퀴마다 반복)
    { status: 'progressing', hero: '차선 변경에 필요한 간격 기준이 너무 보수적입니다.',                         sub: '간격이 확보되면 차선 변경을 시도합니다.',                          judgment: '2·3바퀴 같은 이유로 반복 회전' },           // C1-5
    { status: 'resolving',   hero: '2차로 차선 변경을 시도합니다.',                                            sub: '잠시 정차 후 진입하겠습니다.',                                    judgment: '2차로 강제 진입 시도' },                   // C1-6
    { status: 'normal',      hero: '목적지까지 안전하게 주행 중입니다.',                                       sub: null,                                                              judgment: '2차로(바깥) 진입 성공' },                  // C1-7
    { status: 'errored',     hero: '출구를 빠져나가지 못해 한 바퀴 더 회전합니다.',     sub: '다음 바퀴에 진출합니다.',                                          judgment: '2차로에서 바로 진출 실패' },               // C1-8
    { status: 'normal',      hero: '출구 진출에 성공했습니다.',                                                sub: '정상 주행 중입니다.',                                             judgment: '진출 성공 · 정상 복귀' },                  // C1-9 (260625: 윗줄 진출 성공/아랫줄 정상 주행 → 4초 뒤 '정상 주행 중입니다' 1줄)
  ],
  aquaplaning: [
    { status: 'normal',      hero: '목적지까지 안전하게 주행 중입니다.',                                       sub: null,                                                              judgment: '평지 구간 정상 주행' },                    // C2-1
    { status: 'errored',     hero: '차량이 순간적으로 크게 요동쳤습니다.',                                     sub: '타이어 접지력이 급격히 떨어져 미끄럼이 발생했습니다.',              judgment: '접지력 급감 · 미끄럼 감지' },              // C2-2
    { status: 'progressing', hero: '노면의 물웅덩이를 미리 감지하지 못했습니다.',                                sub: '이로 인해 수막현상이 발생했습니다.',                              judgment: '수막현상 원인 분석' },                     // C2-3
    { status: 'resolving',   hero: '재발 방지를 위해 속도를 낮춰 서행합니다.',                                 sub: '약 N초 후 정상 마찰 상태로 복귀할 예정입니다.',                    judgment: '평지 감속 · 서행 진입' },                   // C2-4
    { status: 'normal',      hero: '목적지까지 안전하게 주행 중입니다.',                                       sub: null,                                                              judgment: '평지 정상 마찰 복귀' },                    // C2-5
    { status: 'errored',     hero: '다시 차량이 요동쳤습니다.',                                                sub: '노면 접지력 저하가 원인입니다.',                                  judgment: '오르막 요동 재감지' },                     // C2-6
    { status: 'progressing', hero: '오르막 중턱 물웅덩이를 파악하지 못했습니다.',                                sub: '수막현상 방지를 위해 보수적으로 주행합니다.',                      judgment: '오르막 중턱 물웅덩이 미감지' },             // C2-7 (260626 동치: 음성·정본과 '중턱' 통일)
    { status: 'resolving',   hero: '지형 경사까지 고려해 더 일찍 감속합니다.',                                  sub: '도착 예정 시간에는 큰 차이가 없습니다.',                          judgment: '경사 고려 조기 감속' },                     // C2-8
    { status: 'normal',      hero: '목적지까지 안전하게 주행 중입니다.',                                       sub: null,                                                              judgment: '오르막 정상 마찰 복귀' },                   // C2-9
    { status: 'errored',     hero: '내리막 구간에서 차량이 크게 흔들렸습니다.',                                 sub: '노면 접지력을 잃었습니다.',                                        judgment: '내리막 요동 감지' },                       // C2-10
    { status: 'progressing', hero: '센서 시야에 물웅덩이가 파악되지 않았습니다.',                                sub: '내리막 가속이 더해져 요동이 커졌습니다.',                          judgment: '센서 사각 + 내리막 가속' },                 // C2-11
    { status: 'resolving',   hero: '더이상 수막현상이 발생하지 않도록 주행 속도를 낮춥니다.',                    sub: '규정속도의 40%인 25km/h로 속도를 유지합니다.',                    judgment: '25km/h 보수 주행 유지' },                    // C2-12
    { status: 'normal',      hero: '목적지까지 안전하게 주행 중입니다.',                                       sub: null,                                                              judgment: '내리막 정상 마찰 복귀' },                   // C2-13
  ],
}

// 주행 판단 과정 패널(Figma 311:7194 등)에서 보여줄
// status 별 라벨 + dot 색.  STATUS_VARIANTS의 pill 텍스트와는 다른 짧은 형태.
const JUDGMENT_LABELS = {
  normal:      { label: '정상 주행중',    color: '#34C759' },
  errored:     { label: '오류 감지',      color: '#FF3B30' },
  progressing: { label: '오류 원인 파악', color: '#FF9500' },
  resolving:   { label: '오류 해결 중',   color: '#FFCC00' },
}

// CARLA scenario 문자열 → 해당 simStage(키보드 Alt+Q/W 와 동일). 브리지 자동시작용.
const SCENARIO_STAGE = { roundabout: 'attempting', aquaplaning: 'aquaplaning_active' }

// C2(수막현상) HMI 블록 자동 진행 ─────────────────────────────────────────────
// CARLA 가 보내는 terrain 이벤트(flat/uphill/downhill)는 각 지형 블록의 '요동 감지'
// (errored) 단계만 발화한다(C2-2/6/10). 그 뒤의 SA 아크(원인→해결→정상 =
// C2-3·4·5 / 7·8·9 / 11·12·13)는 대응하는 CARLA 물리 이벤트가 없으므로, errored
// 단계 진입 후 일정 간격으로 HMI 가 스스로 다음 3단계를 진행한다(시각·음성 동일 간격=변인통제).
const C2_BLOCK_FOLLOWUP_STEPS = 3   // errored 뒤로 자동 진행할 단계 수(원인·해결·정상)
const C2_BLOCK_STEP_MS = 4000       // 단계 간 간격(4초)

// 초기 정상 안내(C1-1·C2-1 "정상 주행 중입니다") 자동 재생 지연 ─────────────────
// 이벤트(drive_start·puddle_enter) 트리거가 아니라, CARLA 구동(scenario_runtime
// started) 후 이 시간이 지나면 시나리오를 정상 단계로 띄워 초기 안내를 재생한다.
const INITIAL_NORMAL_DELAY_MS = 5000   // 시나리오 시작 5초 뒤 C-X-1 재생

const fmtJudgmentTime = (d) => {
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function VehicleHMI() {
  const { activeScenario, hmiResetNonce } = useExperiment()
  const [activeApp, setActiveApp] = useState(null)
  const [isMusicFullscreen, setIsMusicFullscreen] = useState(false)
  const [isMailFullscreen, setIsMailFullscreen] = useState(false)
  const [isPhoneFullscreen, setIsPhoneFullscreen] = useState(false)
  const [isCalendarFullscreen, setIsCalendarFullscreen] = useState(false)
  const [isNavigationFullscreen, setIsNavigationFullscreen] = useState(false)
  const [simStage, setSimStage] = useState('idle')
  const [simType, setSimType] = useState('roundabout')
  // VLA 시퀀스 step 인덱스. Shift+Alt+Q/W 로 시나리오 시작 시 0으로 리셋,
  // Ctrl+Left/Right 로 step 이동.
  const [sequenceIndex, setSequenceIndex] = useState(0)
  // C1-9(진출 성공) 진입 후 4초 뒤 '출구 진출에 성공했습니다 / 정상 주행 중입니다' 2줄을
  //   '정상 주행 중입니다' 1줄로 접는다(사용자 지시 260625). 단계가 바뀌면 false 로 리셋.
  const [c1ExitCollapsed, setC1ExitCollapsed] = useState(false)
  const [isBriefingOpen, setIsBriefingOpen] = useState(false)
  const [temperature, setTemperature] = useState(20)
  const [isAutoClimate, setIsAutoClimate] = useState(true)
  const [currentSpeed, setCurrentSpeed] = useState(52)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [isControlPanelOpen, setIsControlPanelOpen] = useState(false)
  const [navInitialView, setNavInitialView] = useState(null) // 'search' when opened from greeting
  // ── Town03 답답함 시나리오가 '실제로' 실행 중인가 (scenario_runtime started/stopped) ──
  // CARLA frustration/main.py 가 시작 시 started, 종료(finally) 시 stopped 를 보낸다.
  // (배경 맵 iframe 은 이제 상시 마운트 — 이 플래그는 ETA 카운트다운 활성/리셋에만 쓰인다.)
  const [isTown03FrustrationRuntimeActive, setIsTown03FrustrationRuntimeActive] = useState(false)
  // 우측 '네비게이션' 패널의 map_live iframe — 상태색 postMessage 타깃(배경 iframe 과 함께).
  const mapPanelRef = useRef(null)
  // 현재 표시 맵 — map_live iframe src(?map=)를 결정. CARLA scenario_runtime/world_metric 의
  // map 정보로 전환(frustration=Town03, anxiety/puddle=Town04). 기본 Town03.
  const [currentMap, setCurrentMap] = useState('Town03')

  // 시나리오 타입으로도 맵을 맞춘다(roundabout=Town03 / aquaplaning=Town04).
  // CARLA m.map 메시지가 없는 경로(키보드 Alt+Q/W·오퍼레이터 트리거)에서도 C2 가 Town04 로
  // 전환되도록 보장 — 이게 없으면 C2 를 띄워도 맵이 Town03 그대로 남는다.
  useEffect(() => {
    if (simType === 'aquaplaning') setCurrentMap('Town04')
    else if (simType === 'roundabout') setCurrentMap('Town03')
  }, [simType])

  // ── 도착 예정(ETA) 타이머 (mm:ss) ──────────────────────────────────────────
  // 기본 05:00(300s). 규칙(2026-06-25 사용자 지시, 정본):
  //   • 콜론(:)은 모든 런타임에서 1초에 한 번 깜빡인다(초 흐름 표시, 0.5s 토글).
  //   • 정상 상태(🟢)에서는 매 실시간 1초마다 1씩 감소(최소 00:00).
  //   • 문제 상태(🔴/🟠/🟡 = currentBgStatusKey !== 'normal')에서는 증감 없이 그대로 유지(hold).
  //   • 카운트다운은 시나리오 이벤트 수신 여부와 무관하게 '벽시계'로 자유진행한다
  //     (틱 인터벌은 마운트 시점부터 상시 동작 — simStage/이벤트 도착에 게이팅하지 않는다).
  //     게이팅 대상은 '감소 여부'뿐이며, 그 판정은 currentBgStatusKey(정상/문제)다.
  //   우선순위: CARLA 메시지의 실제 ETA 필드(eta_seconds 등)가 있으면 그 값을 그대로 쓴다(이중 안전).
  // 시나리오별 ETA 시작값(260626 사용자 결정): C1(회전교차로)=7:00, C2(수막)=3:00.
  //   ETA 는 '경로 도착 예정시간' 표시값(시나리오 길이 아님). 정상🟢=1초감소·오류=hold 는 공통.
  const ETA_IDLE_BY_SIM = { roundabout: 420, aquaplaning: 180 }
  const etaIdleSeconds = ETA_IDLE_BY_SIM[simType] ?? 420
  const etaIdleRef = useRef(etaIdleSeconds)   // 콜백/인터벌이 항상 현재 simType 의 idle 값을 보도록
  etaIdleRef.current = etaIdleSeconds
  const [etaSeconds, setEtaSeconds] = useState(etaIdleSeconds)
  // 콜론 깜빡임(0.5s 토글 → 1초당 1회) · 문제상태 hold 판정용 최신 status ref.
  const [etaColonOn, setEtaColonOn] = useState(true)
  const etaProblemRef = useRef(false)
  // 라이브 ETA(eta_seconds 등 실 필드)를 한 번이라도 받았는가 — 받았으면 클라이언트 카운트다운 정지.
  const liveEtaRef = useRef(false)
  // 3R-c(2026-06-25 피드백): ETA 는 '시나리오 시작 시각' 기준 벽시계 카운트다운.
  //   이벤트 트리거와 무관 — 시작 시 앵커(ms)를 잡고 remaining = IDLE - 경과초 를 매 틱 계산.
  //   (옛 '감소 카운터 + 문제시 hold + 트리거 리셋'은 이벤트마다 7:00 으로 튀던 원인.)
  const etaAnchorRef = useRef(null)

  // ── 주행 판단 과정 패널 (Figma 311:7163) ─────────────────────
  // FAB 토글로 열림. 시퀀스 step 처음 방문 시 누적 append, Alt+R 로 초기화.
  // maxVisitedIdxRef = 현재 시나리오에서 도달한 최대 sequenceIndex.
  //   advance forward 시에만 push (Ctrl+Left 로 뒤로 갔다 다시 forward 가도
  //   같은 step 중복 추가되지 않음).
  const [isJudgmentOpen, setIsJudgmentOpen] = useState(false)
  const [judgmentLog, setJudgmentLog] = useState([])
  const maxVisitedIdxRef = useRef(-1)
  const judgmentEndRef = useRef(null)
  // ── C1 deadlock 바퀴마다 재노출(R2) ─────────────────────────
  // junction_deadlock_start 가 같은 idx(C1-4)로 다시 와도 — 특히 payload.lap 이
  // 증가하면 — 상태배너/문구를 재플래시한다. deadlockFlash 를 hero/sub 의
  // AnimatePresence key 에 섞어 key 가 바뀌게 해 exit→enter 애니메이션을 재실행.
  // deadlockLapRef = 마지막으로 재플래시한 lap(중복 폭주 가드).
  const [deadlockFlash, setDeadlockFlash] = useState(0)
  const deadlockLapRef = useRef(null)
  // simStage 의 최신값을 ref 로 추적 — CARLA 브리지 콜백(빈 deps)이 stale closure
  // 없이 "지금 시나리오가 진행 중인가"를 판정하는 데 쓴다.
  const simStageRef = useRef('idle')
  // simType(현재 시나리오)의 최신값 ref — C2 블록 자동 진행 타이머가 "아직 같은
  // 시나리오인가"를 콜백 시점에 판정(시나리오 전환 후 stale 타이머 발화 방지)하는 데 쓴다.
  const simTypeRef = useRef('roundabout')
  // C2 지형 블록 자동 진행 setTimeout 핸들들(리셋·재스케줄 시 일괄 취소).
  const c2AutoTimersRef = useRef([])
  // 시작 5초 뒤 초기 정상(C-X-1) 자동 재생 타이머(시나리오 (재)시작·종료 시 취소).
  const initialNormalTimerRef = useRef(null)

  // ── Keyboard chat (Gemini) ──────────────────────────────────
  // Searchbox doubles as a typing input. Sending fires getGeminiResponse,
  // a chat bubble overlay renders the back-and-forth above the searchbox.
  // No voice / TTS / wake-word — this variant is keyboard-only.
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [isAITyping, setIsAITyping] = useState(false)
  const messagesEndRef = useRef(null)
  const chatInputRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isAITyping])

  const sendChatMessage = async (raw) => {
    const text = raw?.trim()
    if (!text || isAITyping) return
    setMessages((prev) => [...prev, { id: Date.now(), type: 'user', text }])
    setInputText('')
    setIsAITyping(true)
    try {
      const ai = await getGeminiResponse(text)
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, type: 'ai', text: ai || '(빈 응답)' },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, type: 'ai', text: `오류: ${err?.message ?? err}` },
      ])
    } finally {
      setIsAITyping(false)
      requestAnimationFrame(() => chatInputRef.current?.focus())
    }
  }

  const openNavSearch = () => {
    setNavInitialView('search')
    setActiveApp('Navigation')
  }

  // activeRoute is set by NavigationApp after the user confirms a destination.
  // The left widget mirrors it; null means "no destination yet".
  const [activeRoute, setActiveRoute] = useState(null)
  // Tick once a minute so the left widget's remaining-time / arrival values
  // stay current while a route is active.
  const [, setRouteTick] = useState(0)
  useEffect(() => {
    if (!activeRoute) return
    const id = setInterval(() => setRouteTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [activeRoute])

  // (옛 좌측 위젯의 경로 dot 애니메이션용 trafficPattern useMemo는 제거됨 —
  //  새 디자인은 메인 캔버스에 라이브 맵 슬롯이라 위젯 내 SVG 경로 dot이 없음)

  // (Chime/사운드 효과 제거 — 사용자 요구)

  // ── Operator-driven scenario control (via ExperimentContext + BroadcastChannel) ──
  useEffect(() => {
    if (!activeScenario) return
    const id = activeScenario.scenarioId
    if (id === 'frustration_roundabout_loop' && simStage === 'idle') {
      setSimType('roundabout')
      setSequenceIndex(0)
      setSimStage('attempting')
    } else if (id === 'anxiety_hydroplaning' && simStage === 'idle') {
      setSimType('aquaplaning')
      setSequenceIndex(0)
      setSimStage('aquaplaning_active')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScenario?.scenarioId])

  // Operator-triggered HMI reset (BC.RESET_HMI / BC.INITIALIZE_HMI / END_TRIAL)
  useEffect(() => {
    if (hmiResetNonce === 0) return
    setSimStage('idle')
    // ETA 초기화: 05:00(300s)로 복귀 + 라이브 ETA 플래그 해제(클라이언트 자유진행 재개).
    liveEtaRef.current = false
    setEtaSeconds(etaIdleRef.current)
    // 지도 ego/route 색은 simStage=idle → currentBgColor(정상=초록)로 reactive 복귀(별도 처리 불필요).
    setIsBriefingOpen(false)
    setActiveApp(null)
    setIsMusicFullscreen(false)
    setIsMailFullscreen(false)
    setIsPhoneFullscreen(false)
    setIsCalendarFullscreen(false)
    setIsNavigationFullscreen(false)
  }, [hmiResetNonce])

  // Keyboard shortcuts (e.code 사용 — Mac Option+letter가 unicode 문자로
  // 바뀌어도 layout-independent 하게 동작):
  //   Alt(Option)+Q              → C1 회전교차로 시퀀스 시작
  //   Alt(Option)+W              → C2 수막현상 시퀀스 시작
  //   Alt(Option)+R              → 상황 초기화 (simStage=idle, sequenceIndex=0)
  //   Ctrl+Alt+Shift+O           → 오퍼레이터 콘솔 새 탭에서 열기
  //   Ctrl+Right                 → 시퀀스 다음 step
  //   Ctrl+Left                  → 시퀀스 이전 step
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Operator console: Ctrl + Alt + Shift + O — modifier-heaviest 조합부터 먼저 매치.
      if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyO') {
        e.preventDefault()
        window.open('/operator', '_blank', 'noopener,noreferrer')
        return
      }
      // Scenario controls: Alt(Option) + Q/W/R, 다른 modifier 없이.
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        if (e.code === 'KeyQ') {
          e.preventDefault()
          maxVisitedIdxRef.current = -1
          setJudgmentLog([])
          setSimType('roundabout')
          setSequenceIndex(0)
          setSimStage('attempting')
          return
        }
        if (e.code === 'KeyW') {
          e.preventDefault()
          maxVisitedIdxRef.current = -1
          setJudgmentLog([])
          setSimType('aquaplaning')
          setSequenceIndex(0)
          setSimStage('aquaplaning_active')
          return
        }
        if (e.code === 'KeyR') {
          e.preventDefault()
          maxVisitedIdxRef.current = -1
          setJudgmentLog([])
          setSimStage('idle')
          setSequenceIndex(0)
          return
        }
      }
      // Sequence step navigation: Ctrl + Left/Right (only while scenario active)
      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const seq = SEQUENCES[simType]
        if (!seq || simStage === 'idle') return
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setSequenceIndex(i => Math.min(seq.length - 1, i + 1))
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setSequenceIndex(i => Math.max(0, i - 1))
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [simType, simStage])

  // 시퀀스 step 처음 방문 시 주행 판단 과정 패널에 한 줄 append.
  // (Ctrl+Left 로 뒤로 갔다가 forward 다시 와도 같은 step 중복 추가 안 됨).
  useEffect(() => {
    if (simStage === 'idle') return
    if (sequenceIndex <= maxVisitedIdxRef.current) return
    const seq = SEQUENCES[simType]
    const step = seq?.[sequenceIndex]
    if (!step?.judgment) return
    maxVisitedIdxRef.current = sequenceIndex
    setJudgmentLog((prev) => [
      ...prev,
      {
        id: `${simType}-${sequenceIndex}-${prev.length}`,
        status: step.status,
        judgment: step.judgment,
        time: new Date(),
      },
    ])
  }, [sequenceIndex, simType, simStage])

  // 새 entry 추가 시 패널 하단으로 자동 스크롤.
  useEffect(() => {
    judgmentEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [judgmentLog.length])

  useEffect(() => { simStageRef.current = simStage }, [simStage])
  useEffect(() => { simTypeRef.current = simType }, [simType])
  // 언마운트 시 자동 진행/초기 정상 타이머 정리(누수 방지).
  useEffect(() => () => {
    c2AutoTimersRef.current.forEach(clearTimeout)
    if (initialNormalTimerRef.current) clearTimeout(initialNormalTimerRef.current)
  }, [])

  // C1-9 진입 4초 뒤 2줄→1줄 접기. 단계/시나리오/스테이지 변하면 false 로 리셋하고,
  //   roundabout C1-9(idx 8)에서만 4초 타이머를 건다.
  useEffect(() => {
    setC1ExitCollapsed(false)
    if (simStage === 'idle' || simType !== 'roundabout' || sequenceIndex !== 8) return
    const t = setTimeout(() => setC1ExitCollapsed(true), 4000)
    return () => clearTimeout(t)
  }, [sequenceIndex, simType, simStage])

  // ── CARLA WebSocket 브리지 (:8766) — 라이브 sim 이벤트로 시퀀스를 구동 ──────
  // 부가적·옵션: WS 미연결이어도 키보드 데모(Alt+Q/W, Ctrl+←/→)는 그대로 동작.
  // scenario_event 가 오면 (a) 해당 시나리오를 idle 일 때만 자동 시작(키보드
  // Alt+Q/W 와 같은 리셋 경로) (b) 이벤트에 대응하는 sequenceIndex 로 점프.
  // step 점프 시 주행 판단 로그 append 는 기존 sequenceIndex effect 가 처리한다.
  const startScenarioFromCarla = useCallback((scenario) => {
    const targetStage = SCENARIO_STAGE[scenario]
    if (!targetStage) return
    // idle 이거나 다른 시나리오가 떠 있으면 (재)시작. 같은 시나리오가 이미
    // 진행 중이면 중복 재시작·로그 리셋을 막는다(이벤트는 step 만 갱신).
    setSimType(prevType => {
      const alreadyRunning = simStageRef.current !== 'idle' && prevType === scenario
      if (alreadyRunning) return prevType
      maxVisitedIdxRef.current = -1
      deadlockLapRef.current = null // 새 런: deadlock lap 추적 리셋
      setJudgmentLog([])
      setSequenceIndex(0)
      setSimStage(targetStage)
      return scenario
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCarlaEvent = useCallback((mapped) => {
    if (!mapped || !mapped.scenario) return
    // (ETA 는 더는 이벤트로 점프하지 않는다 — 문제 상태에서는 hold, 정상에서 카운트다운.)
    // 지도 ego/route 색은 여기서 직접 쏘지 않는다. (b)에서 setSequenceIndex 가 바뀌면
    // currentBgColor(경고 UI 와 동일한 단일 진실원천)가 갱신되고, pushMapStatus effect 가
    // 배경+패널 iframe 둘 다에 그 색을 reactive 하게 전송한다 → ego/route/경고 UI 가 항상 일치.
    // (b) 이벤트 → 새 SEQUENCES step index 로 점프(대응 없으면 no-op).
    const idx = mapEventToSequenceIndex(mapped)
    // 초기 정상(C-X-1, idx 0)은 scenario_runtime started 의 +5초 타이머가 띄운다.
    // 따라서 시나리오가 아직 idle 인데 정상(idx 0) 이벤트(drive_start·junction_arrive)가
    // 오면 여기서 시작하지 않는다 — 초기 정상이 이벤트로 조기/중복 재생되는 것을 막는다.
    // (에러 이벤트 idx>0 는 fallback 으로 시작 허용: started 신호를 놓쳐도 진행되도록.)
    const scenarioActive = simStageRef.current !== 'idle'
    if (!scenarioActive && (idx == null || idx === 0)) return
    // (a) idle(에러 이벤트 fallback) 또는 진행 중이면 해당 시나리오 (재)시작/유지.
    startScenarioFromCarla(mapped.scenario)
    if (idx == null) return
    const seq = SEQUENCES[mapped.scenario] // simType 키 == scenario 문자열
    const maxIdx = seq ? seq.length - 1 : idx
    // 뒤로 점프는 막지 않되(서사상 force_merge→exit_success 등 단조 증가),
    // 범위만 clamp. setState 함수형으로 stale closure 회피.
    setSequenceIndex(() => Math.max(0, Math.min(maxIdx, idx)))
    // (b') C2 지형 블록 자동 진행: terrain 이벤트는 블록의 'errored' 단계(C2-2/6/10)만
    //   발화하므로, 나머지 SA 아크(원인→해결→정상)를 4초 간격으로 자동 전개한다.
    //   먼저 직전 블록의 미발화 타이머를 취소(블록 경계 안전), 그 뒤 3단계 예약.
    //   stale 타이머 가드: 콜백 시점에 (i) 아직 같은 시나리오(aquaplaning)이고
    //   (ii) 현재 index 가 이 블록 범위 안이며 (iii) 단조 증가일 때만 적용.
    c2AutoTimersRef.current.forEach(clearTimeout)
    c2AutoTimersRef.current = []
    const isC2Terrain =
      mapped.scenario === 'aquaplaning' &&
      (mapped.event === 'puddle_enter' || mapped.payload?.terrain != null)
    if (isC2Terrain) {
      const blockStart = Math.max(0, Math.min(maxIdx, idx)) // errored 단계 idx(1/5/9)
      for (let k = 1; k <= C2_BLOCK_FOLLOWUP_STEPS; k++) {
        const next = Math.min(maxIdx, blockStart + k)
        const t = setTimeout(() => {
          if (simTypeRef.current !== 'aquaplaning') return
          setSequenceIndex((cur) => (cur >= blockStart && cur < next ? next : cur))
        }, k * C2_BLOCK_STEP_MS)
        c2AutoTimersRef.current.push(t)
      }
    }
    // (c) C1 deadlock 바퀴마다 재노출: 같은 idx(C1-4)로 다시 와도 lap 이
    //   바뀌면(또는 lap 없으면 매 emit) 배너/문구를 재플래시. lap 이 같은
    //   중복 emit 은 무시(폭주 가드). 바퀴 간격 ~29초라 정상 1회/바퀴.
    if (mapped.event === 'junction_deadlock_start') {
      const lap = mapped.payload?.lap
      if (lap == null || lap !== deadlockLapRef.current) {
        deadlockLapRef.current = lap ?? null
        setDeadlockFlash((n) => n + 1)
      }
    }
  }, [startScenarioFromCarla])

  // ── #7 현재 속도 = 실 ego 속도(world_metric speed_kmh) ────────────────
  // CARLA(또는 mock):8766 의 world_metric 프레임에서 speed_kmh 를 받아 하단바
  // "현재 속도" 에 정수로 표시. WS 미수신이면 기존 fallback(아래 useEffect)이
  // 부드러운 더미 속도를 유지하므로 idle 데모에서도 빈 값이 안 뜬다.
  const liveSpeedRef = useRef(false)  // 한 번이라도 실측 speed 를 받았는가
  const handleWorldMetric = useCallback((m) => {
    if (!m) return
    // 텔레메트리 프레임에 map 이 있으면 맵 전환(보조 경로 — 같은 값이면 React 가 리렌더 생략).
    if (m.map === 'Town03' || m.map === 'Town04') setCurrentMap((prev) => (prev === m.map ? prev : m.map))
    if (typeof m.speed_kmh === 'number') {
      liveSpeedRef.current = true
      setCurrentSpeed(m.speed_kmh)
    }
    // 실제 ETA 가 메시지에 있으면 진실원천으로 사용(우선순위 ①). 없으면 이벤트 트리거 fallback.
    const realEta = [m.eta_seconds, m.remaining_time_s, m.remaining_time_sec, m.eta_s]
      .find((v) => typeof v === 'number')
    if (typeof realEta === 'number') {
      liveEtaRef.current = true   // 실 ETA 도착 → 클라이언트 자유진행 카운트다운 정지(진실원천 위임)
      setEtaSeconds(Math.max(0, Math.round(realEta)))
    }
  }, [])

  // ── scenario_runtime: Town03 답답함 시나리오 실행 게이팅 ──────────────
  // CARLA frustration/main.py 의 scenario_runtime(started/stopped) 신호로만
  // 라이브 맵 iframe 을 마운트/언마운트한다(평소엔 미마운트 → 불필요한 로드 없음).
  const handleScenarioRuntime = useCallback((m) => {
    if (!m) return
    // 맵 전환: 어떤 시나리오든 map 정보가 오면 iframe src 를 그 맵으로 맞춘다(frustration=Town03, puddle=Town04).
    if (m.map === 'Town03' || m.map === 'Town04') setCurrentMap(m.map)
    // 시나리오 종류 판별: frustration→roundabout(C1) · anxiety/puddle→aquaplaning(C2).
    const isFrustration =
      m.scenario === 'frustration' || m.scenario_id === 'frustration_roundabout_loop'
    const isPuddle =
      m.scenario === 'anxiety' || m.scenario_id === 'puddle' || m.map === 'Town04'
    const scenarioKey = isFrustration ? 'roundabout' : isPuddle ? 'aquaplaning' : null
    if (!scenarioKey) return

    if (m.status === 'started') {
      // 초기 정상 안내(C-X-1) 자동 재생: 이벤트와 무관하게 구동 5초 뒤 시나리오를
      // 정상 단계(idx 0)로 띄운다. startScenarioFromCarla 가 simStage active + idx 0 로
      // 세팅 → currentBgColor 초록 + 주행 판단 로그에 C-X-1 append("재생").
      if (initialNormalTimerRef.current) clearTimeout(initialNormalTimerRef.current)
      initialNormalTimerRef.current = setTimeout(() => {
        initialNormalTimerRef.current = null
        startScenarioFromCarla(scenarioKey)
      }, INITIAL_NORMAL_DELAY_MS)
      // ETA 앵커(현재 C1 frustration 전용 — Town03 런타임 플래그/카운트다운 기준).
      if (isFrustration) {
        setIsTown03FrustrationRuntimeActive(true)
        liveEtaRef.current = false
        etaAnchorRef.current = Date.now()   // 시작 시각 앵커(이후 이벤트와 무관하게 이 기준으로 카운트다운)
        setEtaSeconds(etaIdleRef.current)
      }
    } else if (m.status === 'stopped') {
      if (initialNormalTimerRef.current) {
        clearTimeout(initialNormalTimerRef.current)
        initialNormalTimerRef.current = null
      }
      if (isFrustration) {
        setIsTown03FrustrationRuntimeActive(false)
        liveEtaRef.current = false
        etaAnchorRef.current = null
        setEtaSeconds(etaIdleRef.current)
      }
    }
  }, [startScenarioFromCarla])

  const { isConnected: carlaConnected } =
    useCarlaBridge({
      onScenarioEvent: handleCarlaEvent,
      onWorldMetric: handleWorldMetric,
      onScenarioRuntime: handleScenarioRuntime,
    })

  // ── 배경 라이브 맵(map_live.html) status 색 동기화 ─────────────────
  // 현재 시나리오 단계의 status.color 를 배경 iframe(map_live)에 postMessage 로 보낸다.
  // map_live.html 은 받은 hmi-status 색으로 경로/ego 색(정상=초록/이벤트=빨강-주황)을 동기화한다.
  // 단일 진실원천 = 여기(STATUS_VARIANTS). 색을 하드코딩 중복하지 않고 그대로 전달.
  const driveBgRef = useRef(null)
  const driveBgReadyRef = useRef(false)

  // 현재 단계의 status 키/색을 component scope 에서 도출(아래 render IIFE 와 동일 규칙).
  const currentBgStatusKey = (() => {
    const isScenarioActive = simStage !== 'idle'
    const seq = SEQUENCES[simType]
    if (isScenarioActive && seq) {
      const step = seq[Math.min(sequenceIndex, seq.length - 1)]
      return step?.status ?? 'normal'
    }
    return 'normal'
  })()
  const currentBgColor = (STATUS_VARIANTS[currentBgStatusKey] ?? STATUS_VARIANTS.normal).color

  // ── ETA 타이머 구동 ────────────────────────────────────────────────
  // (a) 시나리오가 (정상) 시작되거나 idle 로 복귀할 때 ETA 를 05:00(300s)로 초기화.
  const etaScenarioActive = simStage !== 'idle'
  useEffect(() => {
    // 시나리오 (재)시작/종류 변경 시에만 앵커 리셋(이벤트와 무관). idle 복귀 시 앵커 해제.
    etaAnchorRef.current = etaScenarioActive ? Date.now() : null
    setEtaSeconds(etaIdleRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etaScenarioActive, simType])

  // 문제 상태 hold 판정용 ref(인터벌이 항상 최신 status 를 보도록).
  useEffect(() => { etaProblemRef.current = currentBgStatusKey !== 'normal' }, [currentBgStatusKey])

  // (b) 1초 틱: '벽시계'로 마운트 시점부터 상시 동작(시나리오 시작/이벤트 도착에 게이팅하지 않는다).
  //     정상(🟢) → 매 실시간 1초마다 -1(최소 0). 문제(🔴/🟠/🟡) → 증감 없이 hold.
  //     단, 실 ETA(eta_seconds 등)를 받은 적 있으면(liveEtaRef) 진실원천에 위임하고 자유진행 정지.
  //   ⚠️ 과거 버그(반전): 틱 인터벌을 simStage!=='idle' 에 게이팅해, 정상 주행 중엔
  //      (simStage가 아직 idle이거나 first scenario_event 미수신) 카운트다운이 아예 안 돌고,
  //      첫 오류 이벤트가 simStage를 깨워야만 줄어드는 것처럼 보였다(특히 runtime started 신호가
  //      없는 C2 aquaplaning). 이제 인터벌은 무조건 돌고, '감소 여부'만 정상/문제로 게이팅한다.
  useEffect(() => {
    const id = setInterval(() => {
      if (liveEtaRef.current) return            // 실 ETA 위임 → 클라이언트 자유진행 정지
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

  // mm:ss 포맷.
  const fmtEta = (totalSec) => {
    const s = Math.max(0, Math.floor(totalSec))
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  // 현재 status 색(currentBgColor = 경고 UI 와 동일한 단일 진실원천)을 배경 + 우측 패널
  // map_live iframe '둘 다'에 push. map_live 는 이 color 를 ego/route/trail 색으로 그대로 쓴다.
  const pushDriveBgStatus = useCallback(() => {
    const msg = {
      type: 'hmi-status',
      color: currentBgColor,
      status: currentBgStatusKey,
      scenario: simType,
      index: sequenceIndex,
    }
    driveBgRef.current?.contentWindow?.postMessage(msg, '*')
    mapPanelRef.current?.contentWindow?.postMessage(msg, '*')
  }, [currentBgColor, currentBgStatusKey, simType, sequenceIndex])

  // status/단계가 바뀔 때마다 (ready 핸드셰이크가 끝난 경우) 색 전송.
  useEffect(() => {
    if (driveBgReadyRef.current) pushDriveBgStatus()
  }, [pushDriveBgStatus])

  // drive_bg 가 로드되면 부모에게 {type:'drive-bg-ready'} 를 보낸다 → 받으면 현재 색 1회 push.
  // (iframe onload 와 race 가 나도 ready 메시지를 받는 시점에 확실히 동기화됨.)
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

  // Dynamic speed fluctuation — #7: 실측 world_metric speed 가 한 번이라도
  // 들어오면(liveSpeedRef) 더미 변동을 멈추고 실 ego 속도만 표시한다.
  useEffect(() => {
    const interval = setInterval(() => {
      if (liveSpeedRef.current) return  // 실측 속도 수신 중 → 더미 미적용
      setCurrentSpeed(prev => {
        const change = (Math.random() * 4 - 2).toFixed(0);
        const next = prev + parseInt(change);
        if (next > 60) return 60;
        if (next < 30) return 30;
        return next;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [])

  // Clock update
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // update every minute
    return () => clearInterval(timer);
  }, [])

  // Time formatter
  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  // (옛 simStage auto-timer / handleApproveDetour / getAlertConfig 모두 제거 —
  //  시나리오 진행은 Shift+Alt+Q/W 로 시작 후 Ctrl+Left/Right 로 수동 navigate.
  //  AutopilotStatus + XAI 텍스트는 SEQUENCES lookup이 직접 담당.)

  // #8 내비게이션 앱이 열렸는가 — 615px 패널에 내비를 띄우고 메인 맵을 숨긴다.
  const isNavPanelOpen = activeApp === 'Navigation'

  return (
    <div className="hmi-viewport">
      <div className={`screen${isNavPanelOpen ? ' nav-panel-open' : ''}`}>

      {/* ── 라이브 주행 맵 — 풀블리드 고정 배경 레이어 ──
          (구) drive_bg.html 을 폐기하고 map_live.html(public/map_live.html, URL=/map_live.html)로 교체.
          map_live 는 iframe 안(window.self!==top)에서 .embed 모드로 패널/테두리를 숨겨 깔끔한
          맵만 풀블리드로 깐다. ws://127.0.0.1:8766 의 라이브 CARLA ego 를 Town03 위에 표시.
          - .drive-bg-iframe CSS 그대로 사용(z 최하 0 · pointer-events:none · opacity 0.30).
          - drive-bg-ready / hmi-status 핸드셰이크 호환: map_live 가 로드 시 부모에 drive-bg-ready 를
            보내고, 부모의 hmi-status(status 색)를 받아 경로/ego 색을 동기화한다(driveBgRef 그대로).
          - (구) drive_bg.html 은 public/drive_bg/ 에 백업으로 남겨둠(미사용). */}
      <iframe
        ref={driveBgRef}
        className="drive-bg-iframe"
        src={`/map_live.html?map=${currentMap}&ws=${CARLA_WS_URL}&v=${MAP_LIVE_CACHE_BUST}`}
        title="live drive map background"
        tabIndex={-1}
        aria-hidden="true"
        loading="eager"
        onLoad={() => { driveBgReadyRef.current = true; pushDriveBgStatus() }}
      />
      {/* HMI 가독성용 은은한 어둠 오버레이(테슬라도 상단 그라데이션을 둠). */}
      <div className="drive-bg-scrim" aria-hidden="true" />

      {/* 좌측 사이드바(tint) 제거 — 새 디자인은 전체 캔버스 사용 (Figma 304:1100) */}

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
          {/* CARLA(:8766) 연결 표시 — 끊기면 회색. 진단용, 자율주행 화면엔 영향 X.
              WS 미연결이어도 키보드 데모(Alt+Q/W, Ctrl+←/→)는 그대로 동작. */}
          <span
            title={carlaConnected ? 'CARLA 연결됨 (:8766)' : 'CARLA 미연결 — 로컬(http) + 8766 확인'}
            style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              marginRight: 8, background: carlaConnected ? '#34C759' : '#c7ccd1',
              boxShadow: carlaConnected ? '0 0 6px #34C759' : 'none',
            }}
          />
          <img src={iconWifi} alt="" />
          <img src={iconBattery} alt="" />
          <span className="battery-text">100%</span>
        </div>
      </div>

      {/* ── Main Canvas — idle / scenario / app-open (Figma 304:1100/1128/1139/310:5694) ──
          activeApp이 켜지면 메인 캔버스가 좌측 1305px 영역으로 축소되고
          AutopilotStatus는 Progressing variant로 전환. 우측에 615×887 앱 패널 등장. */}
      <motion.div
        animate={{
          // 앱 열려도 페이드 안 함 — 좌측에서 reasoning 계속 표시
          opacity: 1,
        }}
        transition={{ duration: 0.4, ease: 'easeInOut' }}
        className="absolute inset-0 z-[5] pointer-events-none"
      >
        {/* FAB — 항상 표시. activeApp 시 좌측 1305 영역의 우측으로 가로 이동만.
            2026-06-27: 검색바 제거에 맞춰 우하단(GNB 위)으로 이동(top 122→745, 이미지 정본).
            캔버스 shift + 패널 슬라이드인이 동시에 일어나되
            패널은 화면 밖에서 시작해 우측 615 영역으로만 진입 → 겹침 없음. */}
        <motion.button
          animate={{
            left: (activeApp || messages.length > 0 || isAITyping || isJudgmentOpen) ? 'calc(40% + 326px - 28px)' : 'calc(80% + 156px - 28px)',
          }}
          transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
          whileTap={{ scale: 0.94 }}
          whileHover={{ scale: 1.04 }}
          onClick={() => setIsJudgmentOpen((v) => !v)}
          className="absolute bg-transparent border-0 p-0 cursor-pointer pointer-events-auto"
          style={{ top: 745, width: 187, height: 187, zIndex: 2 }}
          aria-label="주행 판단 과정 열기"
        >
          <img src={iconCarAlert} alt="" className="block w-full h-full pointer-events-none select-none" />
        </motion.button>

        {(() => {
          const isAppOpen = !!activeApp
          // 채팅이 한 번이라도 발생하면 layout이 좌측으로 shift — 앱 열린 것과
          // 동일한 1305 캔버스 + 우측 615 영역에 말풍선 패널 표시.
          const isChatActive = messages.length > 0 || isAITyping
          // 앱/채팅/주행판단 패널 중 하나라도 활성 → 좌측 1305 영역 사용.
          const isShifted = isAppOpen || isChatActive || isJudgmentOpen
          const isScenarioActive = simStage !== 'idle'

          // ── Sequence-driven content (sequence.md / SEQUENCES 상수 lookup) ──
          // 시나리오 활성화 → sequenceIndex가 SEQUENCES[simType] 안의 step을 가리킴.
          // idle 상태일 땐 default normal step (C1-1 / C2-1과 동일 내용)을 사용.
          const seq = SEQUENCES[simType]
          const currentStep = (isScenarioActive && seq)
            ? seq[Math.min(sequenceIndex, seq.length - 1)]
            : { status: 'normal', hero: '목적지까지 안전하게 주행 중입니다.', sub: null }

          const status = STATUS_VARIANTS[currentStep.status] ?? STATUS_VARIANTS.normal
          // C1-9 진출 성공 후 4초 경과(c1ExitCollapsed) → '정상 주행 중입니다' 1줄로 접기.
          const c1ExitDone = simType === 'roundabout' && sequenceIndex === 8 && c1ExitCollapsed
          const heroText = c1ExitDone ? '정상 주행 중입니다.' : currentStep.hero
          const subText = c1ExitDone ? null : currentStep.sub

          // 앱 열림 OR 채팅 활성 시 메인 캔버스는 좌측 1305px 영역 안에서 중앙 정렬.
          // top은 387로 고정 — 컴포넌트가 가로로만 이동, 세로 위치는 idle 기준 유지.
          const canvasWidth = isShifted ? 1305 : 1920
          const searchboxWidth = isShifted ? 994 : 1573

          return (
            <>
              {/* ── Top color bloom (Figma 311:6517 / 6521 / 6574) ──
                  Figma 사양에 충실한 2-layer 스택:
                  • Layer A — 세로 linear: top:status.color → 60% mid (0.4α) → 0% (투명).
                    opacity 0.55.
                  • Layer B — 가로로 길쭉한 radial (ellipse 672×115 at 50% 25%):
                    status.color(0.8α) → 0% (투명) at 65%. mix-blend-screen, opacity 0.553.
                  • 외부 컨테이너 opacity 0.71. (스택 합성 → 약 0.39α 의 부드러운 글로우)
                  컨테이너는 canvas shift 따라 가로 축소(1342→912) + 중앙 재정렬.
                  Status 색 전환 시 cross-fade. 일렁임은 외부 컨테이너 opacity 호흡. */}
              {/* ── Top color bloom (Figma 311:6517) ──
                  단일 radial gradient 한 장으로 부드러운 elliptical 블롭.
                  Container 자체에 직사각 background 없음 → box edge 발생 X.
                  좌우로 길쭉한 ellipse가 위쪽에 살짝 잠긴 채로 깔려서
                  자연스럽게 아래로 fade. canvas shift 시 가로 축소 + 중앙 재정렬. */}
              <motion.div
                className="absolute pointer-events-none"
                animate={{
                  left: isShifted ? 0 : 0,
                  width: isShifted ? 1305 : 1920,
                  opacity: [0.78, 0.96, 0.84, 0.88],
                  scaleY: [0.97, 1.03, 0.99, 1.0],
                }}
                transition={{
                  left: { duration: 0.36, ease: [0.16, 1, 0.3, 1] },
                  width: { duration: 0.36, ease: [0.16, 1, 0.3, 1] },
                  opacity: { duration: 5.2, repeat: Infinity, ease: 'easeInOut' },
                  scaleY: { duration: 6.6, repeat: Infinity, ease: 'easeInOut' },
                }}
                style={{ top: 79, height: 260, transformOrigin: 'top center' }}
              >
                <AnimatePresence mode="popLayout">
                  <motion.div
                    key={status.color}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: 'easeInOut' }}
                    className="absolute inset-0"
                    style={{
                      background: `
                        radial-gradient(ellipse 38% 70% at 50% -5%, ${status.color}E6 0%, ${status.color}80 25%, ${status.color}40 45%, ${status.color}1A 65%, ${status.color}00 85%)
                      `,
                    }}
                  />
                </AnimatePresence>
              </motion.div>

            <motion.div
              className="absolute pointer-events-auto"
              animate={{ left: 0, width: canvasWidth }}
              transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
              style={{ top: 387, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
            >
              {/* AutopilotStatus pill — 통일된 디자인 (Figma 311:7070 / 310:5239).
                  시퀀스 step 전환 시 pill 컨테이너(배경/도트/텍스트) 전체가 한 덩어리로
                  cross-fade. 텍스트가 컨테이너 안에서 슬라이드하는 어색함 제거. */}
              <div style={{ height: 54, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={status.text}
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
                      style={{
                        width: 13,
                        height: 13,
                        background: status.color,
                        boxShadow: `0 0 8px ${status.color}80`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 24,
                        lineHeight: '24px',
                        letterSpacing: '-0.48px',
                        color: '#131417',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {status.text}
                    </span>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* XAI block — pill로부터 15px 간격.
                  Hero 가 먼저 나타나고, sub 는 delay 후 등장 → 시퀀스 step
                  변할 때 두 라인이 동시에 랜덤 순서로 뜨는 인상 제거. */}
              <div className="flex flex-col items-center" style={{ marginTop: 15 }}>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={`${heroText}#${deadlockFlash}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    style={{
                      fontSize: 62,
                      lineHeight: 1.28,
                      letterSpacing: '-2.48px',
                      fontWeight: 600,
                      color: '#676767',
                      textAlign: 'center',
                      margin: 0,
                      maxWidth: 1478,
                    }}
                  >
                    {heroText}
                  </motion.p>
                </AnimatePresence>

                {/* Sub 영역 — 항상 reservation 공간 유지(높이 80 + mt 6)해
                    null ↔ 텍스트 전환 시 searchbox 점프 방지. sub 는 hero
                    가 어느 정도 자리잡은 후(delay 0.2s) 페이드 인.
                    260629: sub 62pt 통일로 reservation 63→80. */}
                <div style={{ marginTop: 6, height: 80, width: '100%', position: 'relative' }}>
                  <AnimatePresence mode="wait">
                    {subText && (
                      <motion.p
                        key={`${subText}#${deadlockFlash}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.2 }}
                        style={{
                          // 260629: Zoom-Out(SA-3)을 Zoom-In(SA-1+2)과 동일 62pt·600·#676767로 통일.
                          // 타이포 위계 폐기 — 위계는 시각 전용이라 음성과의 모달리티 교란이 되므로 제거(두 줄 등가).
                          fontSize: 62,
                          lineHeight: 1.28,
                          letterSpacing: '-2.48px',
                          fontWeight: 600,
                          color: '#676767',
                          textAlign: 'center',
                          margin: 0,
                          position: 'absolute',
                          inset: 0,
                        }}
                      >
                        {subText}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* 2026-06-27 사용자 지시: 검색바(키패드→Gemini 입력) 제거 — 정상 주행
                  화면은 상태 pill + XAI hero/sub 만 남긴 깔끔한 구성(이미지 정본).
                  키보드 채팅 입력 경로 삭제(말풍선 오버레이는 트리거되지 않아 휴면).
                  자유 대화가 필요하면 우측 앱/FAB 또는 음성 HMI 트랙을 사용. */}
            </motion.div>
            </>
          )
        })()}
      </motion.div>

      {/* 옛 디자인 잔재 모두 제거:
          - Floating SwipeSlider / hydroplaning 경고 카드 (CTA)
          - 상단 ambient shimmer 그라데이션 + alert pill
          모든 시나리오 reasoning 은 메인 캔버스의 AutopilotStatus pill +
          XAI hero/sub 텍스트로 통합. */}

      {/* ── 주행 판단 과정 Side Panel (Figma 311:7163) ─────────────
          FAB 클릭으로 토글. 시퀀스 step 처음 방문 시 누적 append.
          앱 패널이 열려있으면 양보(activeApp 우선). 채팅보다는 우선. */}
      <AnimatePresence>
        {!activeApp && isJudgmentOpen && (
          <motion.div
            key="judgment-panel"
            initial={{ opacity: 1, x: 615 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 1, x: 615, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } }}
            className="absolute overflow-hidden z-[11]"
            style={{
              left: 1305,
              top: 79,
              width: 615,
              height: 880,
              borderRadius: 16,
              background: '#f7f8fa',
              border: '1px solid rgba(19, 20, 23, 0.2)',
              boxShadow: '0px 6px 24px 0px rgba(0, 0, 0, 0.08)',
            }}
          >
            <div className="flex flex-col w-full h-full">
              {/* Header (Figma 311:7185) — back + title + 우측 small FAB icon */}
              <div
                className="flex items-center bg-white shrink-0"
                style={{
                  height: 100,
                  borderBottom: '1.072px solid rgba(19, 20, 23, 0.08)',
                  paddingLeft: 21,
                  paddingRight: 24,
                  gap: 15,
                }}
              >
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setIsJudgmentOpen(false)}
                  className="flex items-center justify-center bg-transparent border-0 cursor-pointer"
                  style={{ width: 52, height: 60, borderRadius: 21, padding: 6 }}
                  aria-label="주행 판단 과정 닫기"
                >
                  <ArrowLeft size={32} color="#343434" strokeWidth={2.2} />
                </motion.button>
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 600,
                    lineHeight: '51.418px',
                    letterSpacing: '-1.07px',
                    color: '#343434',
                    flex: 1,
                  }}
                >
                  주행 판단 과정
                </span>
                <img
                  src={iconCarAlert}
                  alt=""
                  style={{ width: 60, height: 60, display: 'block' }}
                />
              </div>
              {/* List — Figma 311:7194 .. 7275. Scrollable, scrollbar hidden. */}
              <div
                className="flex-1 hide-scrollbar"
                style={{
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {judgmentLog.length === 0 ? (
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 40,
                      fontSize: 22,
                      letterSpacing: '-0.44px',
                      color: '#a0a0a0',
                      textAlign: 'center',
                      lineHeight: 1.5,
                    }}
                  >
                    시나리오가 시작되면<br />주행 판단 과정이 여기에 표시됩니다.
                  </div>
                ) : (
                  judgmentLog.map((entry) => {
                    const meta = JUDGMENT_LABELS[entry.status] ?? JUDGMENT_LABELS.normal
                    return (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        style={{
                          width: '100%',
                          minHeight: 118,
                          padding: '15px 31px',
                          borderBottom: '1px solid rgba(19, 20, 23, 0.1)',
                          background: 'linear-gradient(to right, #ffffff 0%, #edeef2 100%)',
                          boxShadow: '0px 6px 6px rgba(0, 0, 0, 0.08)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          gap: 4,
                          flexShrink: 0,
                        }}
                      >
                        <div className="flex items-center" style={{ gap: 7 }}>
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 9999,
                              background: meta.color,
                              flexShrink: 0,
                              boxShadow: `0 0 6px ${meta.color}66`,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 22,
                              fontWeight: 500,
                              letterSpacing: '-0.44px',
                              color: '#99a1af',
                              lineHeight: '30.8px',
                            }}
                          >
                            {meta.label}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 26,
                              fontWeight: 500,
                              letterSpacing: '-1px',
                              color: '#131417',
                              lineHeight: '36.4px',
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {entry.judgment}
                          </span>
                          <span
                            style={{
                              fontSize: 22,
                              fontWeight: 500,
                              color: '#99a1af',
                              lineHeight: '30.8px',
                              flexShrink: 0,
                            }}
                          >
                            {fmtJudgmentTime(entry.time)}
                          </span>
                        </div>
                      </motion.div>
                    )
                  })
                )}
                <div ref={judgmentEndRef} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Chat Side Panel ─────────────────────────────────────────
          검색바에 타이핑 시작하면 활성. 앱 패널과 동일한 615×880 슬롯,
          헤더 + 메시지 리스트 + 자동 스크롤. 앱 패널과 동시에 뜨지는
          않음(앱이 우선). 닫기 버튼은 messages 초기화. */}
      <AnimatePresence>
        {!activeApp && !isJudgmentOpen && (messages.length > 0 || isAITyping) && (
          <motion.div
            key="chat-panel"
            initial={{ opacity: 1, x: 615 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 1, x: 615, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } }}
            className="absolute overflow-hidden z-[10]"
            style={{
              left: 1305,
              top: 79,
              width: 615,
              height: 880,
              borderRadius: 16,
              background: 'var(--bg-primary, #f7f8fa)',
              border: '1px solid rgba(19, 20, 23, 0.2)',
              boxShadow: '0px 6px 24px 0px rgba(0, 0, 0, 0.08)',
            }}
          >
            <div className="flex flex-col w-full h-full">
              {/* Header */}
              <div
                className="flex items-center bg-white shrink-0"
                style={{
                  height: 100,
                  borderBottom: '1.072px solid rgba(19, 20, 23, 0.08)',
                  paddingLeft: 21,
                  paddingRight: 32,
                  gap: 6,
                }}
              >
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={() => { setMessages([]); setInputText('') }}
                  className="flex items-center justify-center bg-transparent border-0 cursor-pointer"
                  style={{ width: 52, height: 60, borderRadius: 21, padding: 6 }}
                  aria-label="대화 닫기"
                >
                  <ArrowLeft size={32} color="#343434" strokeWidth={2.2} />
                </motion.button>
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 600,
                    lineHeight: '51.418px',
                    letterSpacing: '-1.07px',
                    color: '#343434',
                  }}
                >
                  대화
                </span>
              </div>
              {/* Body — scrollable message list */}
              <div
                className="flex-1 overflow-y-auto"
                style={{
                  padding: '24px 28px 32px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 18,
                }}
              >
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28 }}
                    className={`message-row ${msg.type === 'user' ? 'user' : ''}`}
                  >
                    <div className={`message-bubble ${msg.type}`}>{msg.text}</div>
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
                        <div className="typing-dots">
                          <div className="typing-dot" />
                          <div className="typing-dot" />
                          <div className="typing-dot" />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div ref={messagesEndRef} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── App Side Panel (Figma 310:5694) ────────────────────────
          앱이 켜졌을 때 우측 615×887 패널이 슬라이드 인. 헤더에 백 버튼 +
          앱 이름. 본문은 기존 앱 컴포넌트가 들어가는 자리 — 단, 기존 앱
          컴포넌트는 fullscreen 사이징(1410+)을 가정하고 있어 패널에 그대로
          넣으면 overflow됨. 다음 이터레이션에서 각 앱을 패널 사이즈에 맞게
          리팩토링 필요. 일단은 헤더만 보여주고 본문 자리에 placeholder. */}
      <AnimatePresence>
        {activeApp && (
          <motion.div
            key={`app-panel-${activeApp}`}
            // 패널 너비 615px만큼 우측 화면 밖에서 시작 (left:1305 + x:615 = 1920, 화면 오른쪽 경계).
            // 캔버스/searchbox/FAB와 동일한 duration·easing 으로 동시 진행하되,
            // 패널은 우측 외부 → 1305 영역으로만 진입하므로 캔버스 우측 빈 영역 안에서만
            // 이동 → 좌측 컴포넌트와 시각적 겹침 0.
            initial={{ opacity: 1, x: 615 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 1, x: 615, transition: { duration: 0.36, ease: [0.16, 1, 0.3, 1] } }}
            className="absolute overflow-hidden z-[10]"
            style={{
              left: 1305,
              top: 79,
              width: 615,
              // Figma 311:7072 — top 79 + bottom 121 → height 880 (이전 887은 GNB와 7px 겹쳐 둥근 모서리 잘렸음)
              height: 880,
              borderRadius: 16,
              background: 'var(--bg-primary, #f7f8fa)',
              border: '1px solid rgba(19, 20, 23, 0.2)',
              boxShadow: '0px 6px 24px 0px rgba(0, 0, 0, 0.08)',
            }}
          >
            <div className="flex flex-col w-full h-full">
              {/* Header — Figma 310:5698: bg-white, h-100, border-bottom */}
              <div
                className="flex items-center bg-white shrink-0"
                style={{
                  height: 100,
                  borderBottom: '1.072px solid rgba(19, 20, 23, 0.08)',
                  paddingLeft: 21,
                  paddingRight: 32,
                  gap: 6,
                }}
              >
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={() => {
                    setActiveApp(null)
                    setIsMusicFullscreen(false)
                    setIsMailFullscreen(false)
                    setIsPhoneFullscreen(false)
                    setIsCalendarFullscreen(false)
                    setIsNavigationFullscreen(false)
                    setNavInitialView(null)
                  }}
                  className="flex items-center justify-center bg-transparent border-0 cursor-pointer"
                  style={{ width: 52, height: 60, borderRadius: 21, padding: 6 }}
                  aria-label="뒤로"
                >
                  <ArrowLeft size={32} color="#343434" strokeWidth={2.2} />
                </motion.button>
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 600,
                    lineHeight: '51.418px',
                    letterSpacing: '-1.07px',
                    color: '#343434',
                  }}
                >
                  {activeApp === 'Navigation' ? '네비게이션'
                    : activeApp === 'Phone'    ? '전화'
                    : activeApp === 'Music'    ? '음악'
                    : activeApp === 'Mail'     ? '메일'
                    : activeApp === 'Calendar' ? '캘린더'
                    : activeApp}
                </span>
              </div>

              {/* Body — '네비게이션' 패널은 실제 라이브 맵(map_live.html)을 iframe 으로 띄운다.
                  배경 레이어가 아니라 실제 지도 화면이므로 opacity 1.0 으로 또렷하게 표시.
                  map_live 는 iframe 안(window.self!==top)에서 .embed 모드라 편집 패널/뱃지/테두리
                  없이 맵만 풀로 채운다. 패널이 열렸을 때만 마운트(닫히면 언마운트 → WS/WebGL 해제).
                  ⚠️ ws=127.0.0.1 은 '브라우저가 도는 그 기기 자신'을 의미 — 태블릿 등 외부 기기에서
                     HMI 를 열면 시뮬레이터 PC 의 LAN IP(예: ws://192.168.x.x:8766)로 바꿔야 한다. */}
              {activeApp === 'Navigation' ? (
                <iframe
                  ref={mapPanelRef}
                  className="map-panel-iframe"
                  src={`/map_live.html?map=${currentMap}&ws=${CARLA_WS_URL}&v=${MAP_LIVE_CACHE_BUST}`}
                  title="네비게이션 라이브 맵"
                  loading="eager"
                  style={{
                    flex: 1,
                    width: '100%',
                    minHeight: 0,      // flex 컬럼에서 헤더(100px) 아래 남는 높이를 정확히 채움
                    border: 'none',
                    display: 'block',
                    opacity: 1,
                  }}
                  onLoad={() => pushDriveBgStatus()}
                />
              ) : (
                <div
                  className="flex-1 flex items-center justify-center"
                  style={{ background: 'var(--bg-primary, #f7f8fa)' }}
                >
                  <span style={{ fontSize: 18, color: '#a0a0a0', letterSpacing: '-0.36px' }}>
                    앱 본문 (615px 패널용 리팩토링 필요)
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>



      {/* ── Bottom App Bar ────────────────────────────────────── */}
      {/* Bottom GNB — Figma node 286:2728.
          Left: HVAC (home, temp ↓, 20.0 AUTO, temp ↑). 풍량 제거.
          Right: 5 app icons + menu (모두 73px 원형, 메뉴는 회색 배경으로 시스템 구분).
          중앙 ETA/거리는 의도적으로 미반영 (음성 버전 전용 패널). */}
      <div className="bottom-bar">
        <div className="bottom-left">
          <motion.button
            whileTap={{ scale: 0.92 }}
            className="btn-home"
            onClick={() => {
              setActiveApp(null)
              setIsMusicFullscreen(false)
              setIsMailFullscreen(false)
              setIsPhoneFullscreen(false)
              setIsCalendarFullscreen(false)
              setIsNavigationFullscreen(false)
              setIsBriefingOpen(false)
            }}
          >
            <img src={iconHome} alt="Home" />
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.92 }}
            className="btn-chevron"
            onClick={() => { setTemperature(v => Math.max(17, v - 1)); setIsAutoClimate(false) }}
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
            onClick={() => { setTemperature(v => Math.min(29, v + 1)); setIsAutoClimate(false) }}
          >
            <img src={iconChevronUp} alt="Temp up" />
          </motion.button>
        </div>

        {/* Center: ETA + 현재 속도 (Figma 304:1621) — 도착 예정/현재 속도 두 그룹 */}
        <div className="gnb-center">
          {(() => {
            return (
              <>
                <div className="gnb-stat">
                  <span className="gnb-stat-label">도착 예정</span>
                  <span className="gnb-stat-value">
                    {/* #6 타이머 mm:ss — 정상 카운트다운/문제 시 hold. 콜론은 1초당 1회 깜빡. */}
                    <span className="num">
                      {(() => { const [mm, ss] = fmtEta(etaSeconds).split(':'); return (
                        <>{mm}<span style={{ opacity: etaColonOn ? 1 : 0 }}>:</span>{ss}</>
                      ) })()}
                    </span>
                  </span>
                </div>
                <div className="gnb-stat">
                  <span className="gnb-stat-label">현재 속도</span>
                  <span className="gnb-stat-value">
                    {/* #7 실 ego 속도(world_metric speed_kmh) 정수 표시. */}
                    <span className="num">{Math.round(currentSpeed)}</span>
                    <span className="unit">km/h</span>
                  </span>
                </div>
              </>
            )
          })()}
        </div>

        {/* Right: 5 app icons + system menu (Figma 'App' container 522×73) */}
        <div className="bottom-right">
          {[
            { id: 'Navigation', icon: iconSend },
            { id: 'Phone',      icon: iconPhone },
            { id: 'Music',      icon: iconMusic },
            { id: 'Mail',       icon: iconMail },
            { id: 'Calendar',   icon: iconCalendar },
          ].map((item) => (
            <motion.button
              key={item.id}
              whileTap={{ scale: 0.9 }}
              onClick={() => setActiveApp(prev => prev === item.id ? null : item.id)}
              className={`app-icon-btn ${activeApp === item.id ? 'active' : ''}`}
            >
              <img src={item.icon} alt={item.id} />
            </motion.button>
          ))}
          <motion.button
            whileTap={{ scale: 0.92 }}
            className="btn-menu-system"
            aria-label="시스템 메뉴"
            onClick={() => setIsControlPanelOpen(v => !v)}
          >
            <Menu size={28} color="#ffffff" strokeWidth={2.4} />
          </motion.button>
        </div>
      </div>

      {/* ── Control Panel Drawer (vehicle controls + media wireframes) ── */}
      <AnimatePresence>
        {isControlPanelOpen && (
          <ControlPanel onClose={() => setIsControlPanelOpen(false)} />
        )}
      </AnimatePresence>
      </div>
    </div>
  )
}

// ── App shell: router + experiment provider ───────────────────
// /              → participant-facing vehicle HMI
// /operator      → researcher operator console (drives scenarios, logs sessions)
// /operator opens cleanly in a separate window/tab; both windows sync via
// BroadcastChannel inside ExperimentContext.
function App() {
  return (
    <BrowserRouter>
      <ExperimentProvider>
        <Routes>
          <Route path="/" element={<VehicleHMI />} />
          <Route path="/hmi" element={<VehicleHMI />} />
          <Route path="/operator" element={<OperatorConsole />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ExperimentProvider>
    </BrowserRouter>
  )
}

export default App
