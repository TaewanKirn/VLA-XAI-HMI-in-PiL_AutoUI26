// ─────────────────────────────────────────────────────────────────────────
// useCarlaBridge.js — CARLA WebSocket 브리지 (음성 HMI 측 수신 전용 · 최소 구현)
// ─────────────────────────────────────────────────────────────────────────
//
// 2026-06-25 (carla-bridge-on-collab-260625): voice-full-interface-260622 의 동명
// 훅을 정본 음성 디자인(collab-260623=Vercel 배포본) 위로 가져와, scenario_event
// 수신 → 자동 setScenario/setPhase 구동에 쓴다. WoZ 핫키는 그대로 유지(추가만).
//
// CARLA 측(WS 8766, `sender/websocket_sender.py` 계열)이 브로드캐스트하는 JSON 메시지 중
//   • `{ type: 'scenario_event', scenario, event, payload }` → onScenarioEvent  (페이즈 점프)
//   • `{ type: 'world_metric', speed_kmh, x, y, map, eta_seconds, ... }` → onWorldMetric (속도·ETA·맵)
//   • `{ type: 'scenario_runtime', status, scenario, map }` → onScenarioRuntime (시작/종료·맵)
// 를 콜백으로 흘린다. world_frame/motion 등 위치·모션 프레임은 HMI 와 무관 → 무시.
//
// 2026-06-25 (D 단계, hmi-voice-dev): 시각 훅(useCarlaBridge.js, onWorldMetric/onScenarioRuntime)을
// 미러링해 world_metric(속도·ETA) 과 scenario_runtime(맵 전환) 을 노출 — 음성 베이스 화면이
// 시각과 byte-동치(변인통제 핵심)로 CARLA 라이브에 붙도록 한다. scenario_event 파서(scenario
// 필드 보존)는 그대로.
//
// API 키 없이도(WS만 떠 있으면) 동작해야 한다는 게이트 요구사항: 이 훅은 Gemini/TTS 키와
// 무관하게 WS 만 연결한다. 발화는 App.jsx 의 페이즈 effect 가 TTS 직접 호출(Gemini 우회).
//
// (CARLA → HMI 일방향 수신만. 양방향화·t_bus 스탬프·HMI 반응 송신은 미구현 — sim-developer 소관.)

import { useEffect, useRef } from 'react'
import { CARLA_WS_URL } from '../carlaWs'

const DEFAULT_URL = CARLA_WS_URL  // 런타임 host 오버라이드(?carla=/localStorage→env→localhost) 단일 출처

// WS end-to-end 지연(latency) 계측용 ping 송신 주기(ms). 시각 HMI 와 동일(변인통제):
// HMI 가 주기적으로 ping → 서버가 pong 에코 → HMI 가 RTT 산출 → ws_latency 로 되돌려
// 서버 JSONL 로깅. 0/음수면 비활성.
const PING_INTERVAL_MS = 2000

// 메시지가 scenario_event 인지 판별하고 {scenario, event, payload} 로 정규화.
// CARLA 송신측 키 표기 흔들림(scenario/scenario_name, event/event_name/name,
// payload/data)을 흡수한다. scenario 는 음성에서 setScenario 분기에 필요해 보존한다.
function parseScenarioEvent(raw) {
  let msg
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
  if (!msg || typeof msg !== 'object') return null
  const type = msg.type ?? msg.kind
  if (type !== 'scenario_event') return null
  const event = msg.event ?? msg.event_name ?? msg.name
  if (!event) return null
  const scenario = msg.scenario ?? msg.scenario_name ?? null
  return {
    scenario: scenario != null ? String(scenario) : null,
    event: String(event),
    payload: msg.payload ?? msg.data ?? {},
  }
}

/**
 * CARLA WS 브리지 수신 훅.
 * @param {object}   opts
 * @param {function} opts.onScenarioEvent  ({scenario, event, payload}) => void
 * @param {function} [opts.onWorldMetric]  world_metric 원본 프레임을 받는다(선택 · 속도/ETA).
 * @param {function} [opts.onScenarioRuntime] scenario_runtime 프레임(started/stopped·map)을 받는다(선택).
 * @param {string}   [opts.url]            기본 ws://localhost:8766 (env VITE_CARLA_WS_URL)
 * @param {boolean}  [opts.enabled=true]   false 면 연결 안 함(No-HMI/시각 조건에서 끌 수 있음)
 */
export function useCarlaBridge({ onScenarioEvent, onWorldMetric, onScenarioRuntime, url = DEFAULT_URL, enabled = true } = {}) {
  // 콜백을 ref 로 미러링 — 재연결 없이 최신 핸들러를 부른다.
  const handlerRef = useRef(onScenarioEvent)
  const metricRef = useRef(onWorldMetric)
  const runtimeRef = useRef(onScenarioRuntime)
  useEffect(() => { handlerRef.current = onScenarioEvent }, [onScenarioEvent])
  useEffect(() => { metricRef.current = onWorldMetric }, [onWorldMetric])
  useEffect(() => { runtimeRef.current = onScenarioRuntime }, [onScenarioRuntime])

  useEffect(() => {
    if (!enabled) return
    if (typeof WebSocket === 'undefined') return

    let ws = null
    let retryTimer = null
    let closed = false
    // WS 지연 계측: 연결돼 있으면 PING_INTERVAL_MS 마다 ping 송신(시각 HMI 미러).
    const pingTimer = PING_INTERVAL_MS > 0
      ? setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'ping', t_client_send: Date.now() })) } catch { /* noop */ }
          }
        }, PING_INTERVAL_MS)
      : null

    const connect = () => {
      if (closed) return
      try {
        ws = new WebSocket(url)
      } catch (e) {
        console.warn('[carla-bridge] WS 생성 실패, 재시도 예약:', e?.message ?? e)
        scheduleRetry()
        return
      }
      ws.onopen = () => console.log('[carla-bridge] connected', url)
      ws.onmessage = (ev) => {
        // 원본을 한 번만 파싱해 type 으로 분기(시각 훅과 동일 구조).
        let m
        try { m = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data } catch { return }
        if (!m || typeof m !== 'object') return
        const type = m.type ?? m.kind
        if (type === 'scenario_event') {
          const parsed = parseScenarioEvent(m)        // scenario 필드 보존 파서(기존 동작 유지)
          if (parsed) handlerRef.current?.(parsed)
        } else if (type === 'world_metric') {
          metricRef.current?.(m)                       // 속도·ETA·맵 (선택)
        } else if (type === 'scenario_runtime') {
          runtimeRef.current?.(m)                      // started/stopped·맵 (선택)
        } else if (type === 'pong') {
          // WS 지연 계측(시각 HMI 미러): RTT=now-t_client_send, oneway≈RTT/2.
          // 산출값을 ws_latency 레코드로 되돌려 서버가 JSONL 에 t_bus 와 함께 기록.
          const rtt = Date.now() - (m.t_client_send ?? Date.now())
          const oneway = rtt / 2
          console.log(`[carla-bridge] WS RTT ${rtt.toFixed(1)}ms (oneway≈${oneway.toFixed(1)}ms)`)
          try {
            ws.send(JSON.stringify({
              type: 'ws_latency',
              modality: 'voice',
              rtt_ms: rtt,
              oneway_ms: oneway,
              t_client_send: m.t_client_send,
              t_server: m.t_server,
            }))
          } catch { /* noop — 계측 실패는 본동작에 영향 없음 */ }
        }
        // world_frame / motion 등 위치·모션 프레임은 HMI 와 무관 → 무시.
      }
      ws.onerror = () => { /* onclose 가 재연결 처리 */ }
      ws.onclose = () => {
        if (closed) return
        console.warn('[carla-bridge] disconnected, 2s 후 재연결')
        scheduleRetry()
      }
    }

    const scheduleRetry = () => {
      clearTimeout(retryTimer)
      retryTimer = setTimeout(connect, 2000)
    }

    connect()

    return () => {
      closed = true
      clearTimeout(retryTimer)
      if (pingTimer) clearInterval(pingTimer)
      if (ws) {
        ws.onclose = null
        ws.onmessage = null
        try { ws.close() } catch { /* noop */ }
      }
    }
  }, [url, enabled])
}

export default useCarlaBridge
