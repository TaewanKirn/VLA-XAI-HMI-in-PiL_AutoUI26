import { useCallback, useEffect, useRef, useState } from 'react'
import { CARLA_WS_URL, RECONNECT_DELAY_MS, PING_INTERVAL_MS, mapScenarioEvent } from '../services/carlaBridge'

/**
 * CARLA ↔ HMI WebSocket 브리지 훅.
 *
 * CARLA(`websocket_sender.py`, :8766)에 구독하여
 *   • scenario_event → `onScenarioEvent(mapped)`  (화면 넘김)
 *   • world_metric   → `onWorldMetric(raw)`        (실시간 게이지, 선택)
 * 를 콜백으로 흘리고, `sendInteraction(...)` 으로 hmi_interaction 을 왕복 송신한다.
 *
 * 연결 생명주기는 useWakeWord 패턴을 따른다(끊기면 RECONNECT_DELAY_MS 후 자동 재연결).
 *
 * ⚠️ 로컬 실행 전용: ws:// 는 HTTPS 페이지에서 mixed-content 로 차단된다.
 *    `npm run dev`(http://localhost) 또는 동일 LAN http 로 띄울 것.
 *
 * @param {object}   opts
 * @param {function} opts.onScenarioEvent  mapScenarioEvent() 결과를 받는다.
 * @param {function} [opts.onWorldMetric]  world_metric 원본 프레임을 받는다(선택).
 * @param {function} [opts.onScenarioRuntime] scenario_runtime 프레임(시나리오 실행 시작/종료)을 받는다(선택).
 * @param {boolean}  [opts.enabled=true]   false 면 연결하지 않는다.
 * @param {string}   [opts.url]            연결 URL 오버라이드(기본 CARLA_WS_URL).
 */
export function useCarlaBridge({ onScenarioEvent, onWorldMetric, onScenarioRuntime, enabled = true, url } = {}) {
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef(null)
  const cancelledRef = useRef(false)
  const reconnectTimerRef = useRef(null)

  // 콜백을 ref 에 담아 재연결 effect 의존성에서 제외(렌더마다 소켓 재생성 방지).
  const onEventRef = useRef(onScenarioEvent)
  const onMetricRef = useRef(onWorldMetric)
  const onRuntimeRef = useRef(onScenarioRuntime)
  useEffect(() => { onEventRef.current = onScenarioEvent }, [onScenarioEvent])
  useEffect(() => { onMetricRef.current = onWorldMetric }, [onWorldMetric])
  useEffect(() => { onRuntimeRef.current = onScenarioRuntime }, [onScenarioRuntime])

  const target = url || CARLA_WS_URL

  useEffect(() => {
    if (!enabled) return
    cancelledRef.current = false

    const scheduleReconnect = () => {
      if (cancelledRef.current) return
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS)
    }

    const connect = () => {
      if (cancelledRef.current) return
      let ws
      try {
        ws = new WebSocket(target)
      } catch (e) {
        console.warn('[carla-bridge] WebSocket 생성 실패:', e.message)
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        console.log('[carla-bridge] 연결됨', target)
      }

      ws.onmessage = (ev) => {
        let m
        try { m = JSON.parse(ev.data) } catch { return }
        if (!m || typeof m !== 'object') return
        if (m.type === 'scenario_event') {
          const mapped = mapScenarioEvent(m)
          console.log('[carla-bridge] scenario_event', mapped.scenario, '/', mapped.event)
          onEventRef.current?.(mapped)
        } else if (m.type === 'world_metric') {
          onMetricRef.current?.(m)
        } else if (m.type === 'scenario_runtime') {
          // 시나리오 프로세스 실행 시작/종료 신호(started/stopped). 라이브 맵 마운트 게이팅용.
          onRuntimeRef.current?.(m)
        } else if (m.type === 'pong') {
          // WS 지연 계측: pong 수신시각 - 송신시각 = RTT. oneway ≈ RTT/2.
          // 산출값을 ws_latency 레코드로 되돌려 보내 서버가 JSONL 에 t_bus 와 함께 기록.
          const rtt = Date.now() - (m.t_client_send ?? Date.now())
          const oneway = rtt / 2
          console.log(`[carla-bridge] WS RTT ${rtt.toFixed(1)}ms (oneway≈${oneway.toFixed(1)}ms)`)
          try {
            ws.send(JSON.stringify({
              type: 'ws_latency',
              modality: 'visual',
              rtt_ms: rtt,
              oneway_ms: oneway,
              t_client_send: m.t_client_send,
              t_server: m.t_server,
            }))
          } catch { /* noop — 계측 실패는 본동작에 영향 없음 */ }
        }
        // world_frame / motion 등 위치·모션 프레임은 HMI 와 무관 → 무시.
      }

      ws.onerror = () => {
        // onclose 가 이어서 재연결을 처리하므로 여기선 로그만.
        console.warn('[carla-bridge] 소켓 오류 (CARLA/포트 8766 확인)')
      }

      ws.onclose = () => {
        setIsConnected(false)
        wsRef.current = null
        if (!cancelledRef.current) scheduleReconnect()
      }
    }

    connect()

    // WS 지연 계측: 연결돼 있으면 PING_INTERVAL_MS 마다 ping 송신. 재연결과 무관하게
    // wsRef.current 를 매번 확인하므로 소켓이 갈려도 그대로 동작한다. 0/음수면 비활성.
    let pingTimer = null
    if (PING_INTERVAL_MS > 0) {
      pingTimer = setInterval(() => {
        const ws = wsRef.current
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'ping', t_client_send: Date.now() })) } catch { /* noop */ }
        }
      }, PING_INTERVAL_MS)
    }

    return () => {
      cancelledRef.current = true
      clearTimeout(reconnectTimerRef.current)
      if (pingTimer) clearInterval(pingTimer)
      const ws = wsRef.current
      if (ws) {
        ws.onclose = null // 정리 중 재연결 방지
        try { ws.close() } catch { /* noop */ }
      }
      wsRef.current = null
    }
  }, [enabled, target])

  // hmi_interaction 왕복 송신 — CARLA WS 서버가 t_bus·session_id 를 스탬프해 JSONL 로깅.
  const sendInteraction = useCallback(({ action, value, modality = 'visual' }) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[carla-bridge] 미연결 — hmi_interaction 송신 생략', action)
      return false
    }
    ws.send(JSON.stringify({
      type: 'hmi_interaction',
      modality,
      action,
      value,
      client_ts: Date.now(),
    }))
    console.log('[carla-bridge] 송신 hmi_interaction', action, '=', value)
    return true
  }, [])

  return { isConnected, sendInteraction }
}
