// ── CARLA ↔ HMI WebSocket bridge (config + event mapping) ──────────────────
//
// CARLA(`data-server/sender/websocket_sender.py`)가 8766 포트로 브로드캐스트하는
//   • scenario_event  (top-level scenario/event + payload) → HMI 화면 넘김
//   • world_metric    (speed/yaw_rate/accel/brake/lane_offset, ≥20Hz) → 실시간 게이지
// 를 구독하고, 사용자 반응(hmi_interaction)을 같은 소켓으로 되돌려 보낸다(왕복).
//
// 화면 매핑 근거(정본):
//   04_design/CARLA/C1_beat_event_map.md  (C1 변곡점→event→화면)
//   scenarios/hmi_test_client.html        (레퍼런스 테스트 클라이언트 — 이 모듈은 그 로직의 React 이식)
//   hmi_carla_sync_logging_260531.md §2   (메시지 계약)
//
// ⚠️ 로컬 실행 필수: ws:// 는 HTTPS(예: Vercel) 페이지에서 mixed-content 로 차단된다.
//    반드시 `npm run dev`(http://localhost) 또는 동일 LAN http 로 띄워서 연결할 것.

// ── 연결 대상 ───────────────────────────────────────────────────────────────
// PC-LAN-IP 는 시뮬레이터 PC(CARLA 가 도는 PC)의 LAN IP. 태블릿/다른 PC 에서 붙을 땐
// 여기(또는 .env 의 VITE_CARLA_HOST)를 그 IP 로 바꾼다. 같은 PC면 127.0.0.1.
// 런타임 host 오버라이드(env 수정·vite 재시작 불필요): IP 가 자주 바뀌어도
// 대시보드 launch 링크가 ?carla=<IP> 를 붙여 주면 그 값으로 즉시 붙는다.
//   우선순위: 1) ?carla= (URL 쿼리)  2) localStorage('carlaHost')  3) VITE_CARLA_HOST  4) 127.0.0.1
// ?carla= 가 오면 localStorage 에 기억 → 이후 쿼리 없이 새로고침해도 유지.
function _resolveCarlaHost() {
  try {
    const q = new URLSearchParams(window.location.search).get('carla')
    if (q && q.trim()) { localStorage.setItem('carlaHost', q.trim()); return { host: q.trim(), override: true } }
    const ls = localStorage.getItem('carlaHost')
    if (ls) return { host: ls, override: true }
  } catch (_) { /* no-DOM guard */ }
  return { host: import.meta.env.VITE_CARLA_HOST || '127.0.0.1', override: false }
}
const _carla = _resolveCarlaHost()
export const CARLA_HOST = _carla.host
// 포트는 반드시 8766 (8765 는 B안 음성/wake-word 서버와 충돌 → 2026-06-19 8765→8766 이동).
export const CARLA_PORT = import.meta.env.VITE_CARLA_PORT || '8766'
// 런타임 오버라이드가 있으면 그 host 로 URL 구성(최우선). 없을 때만 전체 URL env(VITE_CARLA_WS_URL) 존중.
export const CARLA_WS_URL = _carla.override
  ? `ws://${CARLA_HOST}:${CARLA_PORT}`
  : (import.meta.env.VITE_CARLA_WS_URL || `ws://${CARLA_HOST}:${CARLA_PORT}`)

export const RECONNECT_DELAY_MS = 1500 // WS 끊기면 이 간격으로 재연결 시도

// WS end-to-end 지연(latency) 계측용 ping 송신 주기(ms). HMI 가 주기적으로 ping 을
// 보내면 서버가 즉시 pong 으로 에코하고, HMI 는 RTT=now-t_client_send 를 산출해
// ws_latency 레코드로 되돌려 보낸다(서버 JSONL 로깅). 0/음수면 계측 비활성.
export const PING_INTERVAL_MS = 2000

// ── CARLA scenario 식별자 → HMI scenarioId (data/scenarios.js) ──────────────
const SCENARIO_TO_HMI = {
  roundabout: 'frustration_roundabout_loop', // C1 답답함
  aquaplaning: 'anxiety_hydroplaning',        // C2 수막현상
}

// ── event → HMI 화면 상태(commentary) 매핑 ──────────────────────────────────
// status: AutopilotStatus 5-state. zin = Zoom-In(윗줄), zout = Zoom-Out(아랫줄).
// {recommended_kmh}/{Nsec_to_recover} 등 동적수치는 payload 로 치환(fillTemplate).
// 출처: C1_beat_event_map.md §4 + ScenarioSetting.md(C1 13장).
export const EVENT_SCREENS = {
  // ── C1 roundabout ──
  junction_arrive: { status: 'normal', tone: '#2ea043', zin: '출구 진출을 시도합니다.', zout: '진입 각을 확보하는 중입니다.' },
  junction_deadlock_start: { status: 'normal', tone: '#2ea043', zin: '출구 진입에 실패해 한 바퀴 더 회전합니다.', zout: '다음 진출 기회를 탐색합니다.' },
  to_inner: { status: 'normal', tone: '#2ea043', zin: '진출에 다시 실패해 또 한 바퀴 회전합니다.', zout: '진입 가능 구간을 재탐색합니다.' },
  abnormal_loop: { status: 'error', tone: '#f85149', zin: '비정상적으로 여러 바퀴를 회전하고 있습니다.', zout: '정상 진출 범위를 초과했습니다.' },
  stuck_stop: { status: 'diagnosing', tone: '#db6d28', zin: '출구의 주차 차량이 진입 각을 막고 있습니다.', zout: '앞 차량을 정차로 오판한 것이 원인입니다.' },
  force_merge: { status: 'resolving', tone: '#d29922', zin: '한 바퀴 돌아 목표 출구로 진출합니다.', zout: '약 {Nsec_to_recover}초 후 진출 예정입니다.' },
  exit_success: { status: 'normal', tone: '#2ea043', zin: '출구 탈출에 성공했습니다.', zout: '정상 주행을 재개합니다.' },
  cleared: { status: 'normal', tone: '#2ea043', zin: '정상 주행으로 복귀했습니다.', zout: '경로를 따라 주행합니다.' },
  // ── C2 aquaplaning (puddle_enter = 요동→감속 묶음) ──
  puddle_enter: {
    status: 'diagnosing', tone: '#db6d28',
    zin: '노면의 물웅덩이를 감지하지 못해 수막현상이 발생했습니다.',
    zout: '권장 {recommended_kmh}km/h로 감속합니다. 약 {Nsec_to_recover}초 후 정상 마찰로 복귀합니다.',
  },
}

// {token} 자리를 payload 값으로 치환. 없으면 임시로 'N'.
export function fillTemplate(str, payload) {
  return (str || '').replace(/\{(\w+)\}/g, (_, k) =>
    payload && payload[k] != null ? payload[k] : 'N'
  )
}

// CARLA scenario 문자열 → HMI scenarioId. 모르는 값이면 null.
export function hmiScenarioId(carlaScenario) {
  return SCENARIO_TO_HMI[carlaScenario] ?? null
}

// ── CARLA event → 새 디자인 SEQUENCES step index 매핑 ───────────────────────
// 새 시각 HMI(origin/main)는 EVENT_SCREENS 의 오버레이 텍스트가 아니라
// App.jsx 의 SEQUENCES[simType] 배열(sequence.md 정본)을 sequenceIndex 로
// 가리켜 화면을 구성한다. 따라서 브리지는 "이 CARLA 이벤트는 시퀀스 몇 번째
// step 으로 점프해야 하는가"만 알려주면 된다(텍스트는 App 이 lookup).
//
// 매핑 근거: 2026-06-24 드라이런 실측 scenario_event 스펙 + sequence.md.
//   roundabout(C1): 9-step(idx 0..8 = C1-1..C1-9).
//   aquaplaning(C2): 13-step(idx 0..12 = C2-1..C2-13), 3 지형 블록.
//
// roundabout: CARLA 발화 순서 ≠ 새 서사 순서라 의미(narrative)로 대응.
//   gap_attempt 는 "움찔 시도" 반복 이벤트 → 진입 간격 확보 어려움(C1-2) 유지.
// 2026-06-25 정합 수정: 매핑이 VLA 정본 표(VLA_mapping_v5_260623.md) 및 CARLA
//   ego_controller.py 작성자 주석과 어긋나 있던 것을 바로잡음.
// 2026-06-25 C1 이벤트 계약 개정(확정 표 미러):
//   • junction_arrive: 1→0  (교차로 도착은 정상 C1-1. 기존 1=C1-2 였던 것을 정정)
//   • gap_attempt: 테이블 고정값 제거 → 아래 mapEventToSequenceIndex 에서
//       payload.attempt_n>=2 ? 1 : 0 조건 처리(2회째 시도부터 C1-2 errored).
//   • enter_success: 신규 2  (진입 성공 직후 C1-3 정상)
//   • lane_change:   신규 5  (차선변경 사전고지 C1-6)
// 2026-06-25 R2 계약: drive_start 신규(시작 즉시 C1-1 정상), merge_done 제거
//   (CARLA 더는 미발행 — force_merge 직후 곧장 abnormal_loop(C1-8)이 온다).
//   junction_deadlock_start 는 매핑은 같은 idx 3 이지만 App.jsx 에서 payload.lap
//   증가 시 같은 idx 라도 재플래시(바퀴마다 재노출).
//   • to_inner(2)·junction_deadlock_start(3)·stuck_stop/force_merge(5)·
//     abnormal_loop(7)·exit_success/cleared(8) 은 유지.
const C1_EVENT_TO_INDEX = {
  drive_start:             0, // C1-1 시나리오 시작(t≈0) · 정상 주행(normal)
  junction_arrive:         0, // C1-1 교차로 도착 · 정상 주행(normal)
  // gap_attempt 는 테이블 고정값이 아니라 mapEventToSequenceIndex 에서
  //   payload.attempt_n>=2 ? 1 : 0 으로 조건 처리(여기 두지 않음).
  enter_success:           2, // C1-3 진입 성공 직후 · 정상(normal)
  to_inner:                2, // C1-3 회전교차로 진입 성공 · 정상 순환(normal)
  junction_deadlock_start: 3, // C1-4 비정상 반복 회전 감지(errored) — 바퀴마다 재플래시(App.jsx)
  // C1-5(원인 파악·idx 4)·C1-7(idx 6, merge_done 제거)은 대응 이벤트 없음 → 전이 공백.
  lane_change:             5, // C1-6 차선변경 사전고지(resolving)
  stuck_stop:              5, // C1-6 정차 후 진입(resolving)
  // 3R-b(2026-06-25 피드백): force_merge 를 C1-7(강제 진입 후 '정상 주행' 비트)로 재활성.
  //   CARLA 가 force_merge 후 5s '정상 주행' → abnormal_loop(C1-8) 발행하도록 변경한 것과 미러.
  //   (R2 에서 merge_done 제거로 비었던 C1-7(idx 6) 슬롯을 force_merge 가 채운다.)
  force_merge:             6, // C1-7 2차로 강제 진입 후 정상 주행(normal) — 5s 후 abnormal_loop
  abnormal_loop:           7, // C1-8 2차로 변경 후 바로 진출 실패 → 또 한 바퀴 회전(errored)
  exit_success:            8, // C1-9 진출 성공 · 정상 복귀(normal)
  // cleared 는 아래에서 마지막 step 으로 별도 처리.
  // circling_start / exit_blocked 는 매핑 없음(no-op): circling_start=링 진입 알림(서사 단계 아님),
  //   exit_blocked=비활성 레거시(_track_laps_and_circle, 미발행).
}

// aquaplaning: puddle_enter 한 종류만 발화(지형별 1회). payload.terrain 으로
// 평지/오르막/내리막 블록의 "요동(errored)" step 으로 점프.
const C2_TERRAIN_TO_INDEX = {
  flat:     1,  // C2-2  평지 요동 · 미끄럼 감지(errored)
  uphill:   5,  // C2-6  오르막 요동 재감지(errored)
  downhill: 9,  // C2-10 내리막 요동 감지(errored)
}

/**
 * mapped(=mapScenarioEvent 결과) → 새 디자인 sequenceIndex.
 * 대응 step 이 없으면 null(= App 이 화면 점프를 생략, graceful no-op).
 */
export function mapEventToSequenceIndex(mapped) {
  if (!mapped) return null
  if (mapped.scenario === 'roundabout') {
    if (mapped.event === 'cleared') return 8 // 마지막 정상 step(C1-9)
    // gap_attempt: 조건부(2회째 시도부터 C1-2). attempt_n 이 숫자가 아니면 0(정상) 취급.
    if (mapped.event === 'gap_attempt') {
      const n = Number(mapped.payload?.attempt_n)
      return Number.isFinite(n) && n >= 2 ? 1 : 0
    }
    const idx = C1_EVENT_TO_INDEX[mapped.event]
    return idx == null ? null : idx
  }
  if (mapped.scenario === 'aquaplaning') {
    if (mapped.event === 'puddle_enter') {
      const terrain = mapped.payload?.terrain
      const idx = C2_TERRAIN_TO_INDEX[terrain]
      return idx == null ? 1 : idx // terrain 미상이면 평지 블록으로 fallback
    }
    return null
  }
  return null
}

// scenario_event 1건 → HMI 가 쓰기 좋은 형태(화면 정보 + 매핑된 scenarioId)로 정규화.
export function mapScenarioEvent(msg) {
  const event = msg.event
  const payload = msg.payload || {}
  const screen = EVENT_SCREENS[event] || null
  return {
    scenario: msg.scenario,
    event,
    payload,
    tSim: msg.t_sim ?? null,
    scenarioId: hmiScenarioId(msg.scenario),
    status: screen?.status ?? null,
    tone: screen?.tone ?? '#8b949e',
    zin: screen ? fillTemplate(screen.zin, payload) : `(매핑 없는 이벤트: ${event})`,
    zout: screen ? fillTemplate(screen.zout, payload) : '',
    mapped: !!screen,
  }
}
