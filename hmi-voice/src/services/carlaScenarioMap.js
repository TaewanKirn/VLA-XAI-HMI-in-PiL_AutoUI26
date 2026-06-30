// ─────────────────────────────────────────────────────────────────────────
// carlaScenarioMap.js — CARLA scenario_event → 음성 HMI 페이즈 매핑
// ─────────────────────────────────────────────────────────────────────────
//
// 2026-06-25 (carla-bridge-on-collab-260625, hmi-voice-dev).
//
// 이 매핑은 **시각 HMI 정본을 미러링**한다(양 모달리티 동일 시퀀스 = SRT 변인통제 핵심).
//   시각 정본: HCI-prototype-interface/src/services/carlaBridge.js
//             (C1_EVENT_TO_INDEX, C2_TERRAIN_TO_INDEX — 0-based sequenceIndex)
//   음성 페이즈: drivePhases.js (C1=9 페이즈, C2=13 페이즈 · 1-based, PHASE_NONE=0)
//
//   ⇒ 음성 페이즈 = 시각 index + 1.
//
// 매핑 없는 이벤트 → null (= 페이즈 변경 안 함, graceful no-op).
//
// scenario 식별자 매핑:
//   roundabout  → frustration_roundabout_loop  (C1 답답함)
//   aquaplaning → anxiety_hydroplaning          (C2 불안)

import { getScenarioById } from '../data/scenarios'
import { getPhaseCount } from '../data/drivePhases'

// CARLA scenario 문자열 → HMI scenarioId.
export const CARLA_SCENARIO_TO_HMI = {
  roundabout: 'frustration_roundabout_loop',
  aquaplaning: 'anxiety_hydroplaning',
}

// ── C1 roundabout: event → 음성 페이즈(1-based) ──────────────────────────────
// 시각 정본 C1_EVENT_TO_INDEX(0-based) + 1.
// 2026-06-25 C1 이벤트 계약 개정(시각 carlaBridge.js 미러):
//   • junction_arrive: 2→1  (교차로 도착은 정상 C1-1)
//   • gap_attempt: 테이블 고정값 제거 → mapScenarioEvent 에서
//       attempt_n>=2 ? 2 : 1 조건 처리(2회째 시도부터 C1-2).
//   • enter_success: 신규 3  (진입 성공 직후 C1-3 정상)
//   • lane_change:   신규 6  (차선변경 사전고지 C1-6)
// 2026-06-25 R2 계약: drive_start 신규(시작 즉시 phase 1 = C1-1 정상),
//   merge_done 제거(CARLA 더는 미발행 — force_merge 직후 곧장 abnormal_loop).
//   junction_deadlock_start 는 phase 는 4 로 같지만 App.jsx 가 payload.lap
//   증가 시 멱등 가드를 우회해 바퀴마다 재발화한다.
const C1_EVENT_TO_PHASE = {
  drive_start:             1, // 시각 idx 0 + 1 · C1-1 시나리오 시작(t≈0) · 정상 주행
  junction_arrive:         1, // 시각 idx 0 + 1 · C1-1 교차로 도착 · 정상 주행
  // gap_attempt 는 테이블 고정값이 아니라 mapScenarioEvent 에서
  //   attempt_n>=2 ? 2 : 1 으로 조건 처리(여기 두지 않음).
  enter_success:           3, // 시각 idx 2 + 1 · C1-3 진입 성공 직후 · 정상
  to_inner:                3, // 시각 idx 2 + 1 · C1-3 진입 성공 · 정상 순환
  junction_deadlock_start: 4, // 시각 idx 3 + 1 · C1-4 비정상 반복 회전 감지 🔴 (바퀴마다 재발화: App.jsx)
  lane_change:             6, // 시각 idx 5 + 1 · C1-6 차선변경 사전고지
  stuck_stop:              6, // 시각 idx 5 + 1 · C1-6 정차 후 진입
  // 3R-b(2026-06-25 피드백): force_merge 를 C1-7(강제 진입 후 '정상 주행' 비트)로 재활성.
  //   CARLA 가 force_merge 후 5s '정상 주행' → abnormal_loop(C1-8) 발행하도록 변경한 것과 미러
  //   (시각 idx 6 + 1). R2 에서 비었던 phase 7 슬롯을 force_merge 가 채운다.
  force_merge:             7, // 시각 idx 6 + 1 · C1-7 2차로 강제 진입 후 정상 주행 — 5s 후 abnormal_loop
  abnormal_loop:           8, // 시각 idx 7 + 1 · C1-8 2차로 변경 후 진출 실패 → 또 한 바퀴 회전 🔴
  exit_success:            9, // 시각 idx 8 + 1 · C1-9 진출 성공 · 정상 복귀
  cleared:                 9, // 시각 마지막 step(idx 8) + 1 · C1-9 정상 복귀
}

// ── C2 aquaplaning: payload.terrain → 음성 페이즈(1-based) ────────────────────
// 시각 정본 C2_TERRAIN_TO_INDEX(0-based) + 1. puddle_enter 한 종류만 발화(지형별 1회).
const C2_TERRAIN_TO_PHASE = {
  flat:     2,  // 시각 idx 1 + 1 · C2-2  평지 요동 · 미끄럼 감지
  uphill:   6,  // 시각 idx 5 + 1 · C2-6  오르막 요동 재감지
  downhill: 10, // 시각 idx 9 + 1 · C2-10 내리막 요동 감지
}
const C2_TERRAIN_FALLBACK_PHASE = 2 // terrain 미상 → 평지 블록으로 fallback(시각 정본과 동일)

/**
 * CARLA scenario_event ({scenario, event, payload}) →
 *   { scenarioId, targetPhase } | null
 *
 * - scenarioId: HMI 시나리오 식별자(setScenario 인자). 모르는 scenario → null 반환.
 * - targetPhase: 1-based 음성 페이즈. 해당 scenarioId 의 페이즈 수로 클램프.
 *                매핑되는 페이즈가 없으면(예: 미지원 event) targetPhase = null.
 *
 * 전체가 null 이면(= scenarioId 미상) App 은 아무 것도 하지 않는다(graceful no-op).
 * scenarioId 는 있으나 targetPhase 가 null 이면 시나리오만 활성화하고 페이즈는 안 바꾼다.
 */
export function mapScenarioEvent(evt) {
  if (!evt || typeof evt !== 'object') return null
  const scenarioId = CARLA_SCENARIO_TO_HMI[evt.scenario] ?? null
  if (!scenarioId) return null

  let targetPhase = null
  if (evt.scenario === 'roundabout') {
    if (evt.event === 'gap_attempt') {
      // 조건부(2회째 시도부터 C1-2 phase 2). attempt_n 이 숫자가 아니면 1(정상 C1-1) 취급.
      const n = Number(evt.payload?.attempt_n)
      targetPhase = Number.isFinite(n) && n >= 2 ? 2 : 1
    } else {
      targetPhase = C1_EVENT_TO_PHASE[evt.event] ?? null
    }
  } else if (evt.scenario === 'aquaplaning') {
    // C2 는 payload.terrain 으로 지형 블록의 "요동" 페이즈로 점프.
    // (event 가 puddle_enter 가 아니어도 terrain 이 있으면 지형 기준으로 처리,
    //  terrain 이 없으면 평지 fallback. 매핑 모듈은 관대하게.)
    if (evt.event === 'puddle_enter' || evt.payload?.terrain != null) {
      const terrain = evt.payload?.terrain
      targetPhase = C2_TERRAIN_TO_PHASE[terrain] ?? C2_TERRAIN_FALLBACK_PHASE
    } else {
      targetPhase = null
    }
  }

  if (targetPhase != null) {
    // 클램프는 **방금 결정한 scenarioId** 기준(stale activeScenario 사용 금지).
    const max = getPhaseCount(scenarioId)
    if (max > 0) targetPhase = Math.max(1, Math.min(max, targetPhase))
    else targetPhase = null
  }

  return { scenarioId, targetPhase }
}

// 외부에서 직접 참조할 일이 있을 수 있어 테이블도 노출.
export const _tables = { C1_EVENT_TO_PHASE, C2_TERRAIN_TO_PHASE, C2_TERRAIN_FALLBACK_PHASE }

// getScenarioById 재노출(편의) — App 에서 scenario 유효성 검사에 쓸 수 있음.
export { getScenarioById }
