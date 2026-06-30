# scenarioQA 일관성 리포트 — 양식 `[분석도구]`

> **결정 정본:** `04_design/feedback_260604_decisions.md` 결정 ⑦
> ("피험자별로 일관적인 지표값이 나오는지 확인하는 `scenarioQAreport.md`도 필요")
> **지표 정의 정본:** `08_data_analysis/analysis_plan.md` §2.6 (시나리오 정량 6지표)
> **산출 도구:** `scenarios/tools/scenarioQA.py` (WS JSONL 세션 로그 → 6지표, 결정론)

---

## 0. 위상 (반드시 먼저)

- 본 리포트의 6지표는 **가설 종속변수(DV)가 아니다.** `analysis_plan.md` §2.6-(a)에 따라
  **시나리오의 객관적 재현성·동결(frozen replay) 일관성 근거**로만 쓰는 **기술통계**다.
  여기에 효과크기·가설 검정·p값을 붙이지 않는다(가설 검정 표와 분리; 트랙 라벨 유지).
- 공개 데이터셋 결과(`08_data_analysis/Results/`)·실험 결과(`Data_Analysis_Results.md`)와
  **절대 혼동하지 않는다.** 이 산출은 *자극물(시나리오) QA 트랙*이다.
- 본 문서는 **양식(템플릿)** 이다. 아래 표의 값 칸은 모두 `…`/`TBD` 플레이스홀더이며,
  실제 수치는 파일럿/세션 로그를 `scenarioQA.py`로 처리해 채운다. **예시 데이터 발명 금지.**

---

## 1. 목적

같은 시나리오(C1·C2)를 여러 피험자/세션에 재생했을 때, 6지표가 **피험자 간·세션 간
일관적**으로 나오는지(= 자극물이 충분히 동결되어 있는지)를 확인한다. 일관성이 낮으면
시나리오 재생이 시행마다 달라진다는 뜻이므로, **자극물 동결 전에 원인을 잡아야** 한다.

## 2. 입력

- `scenarioQA.py --out <csv>` 로 누적된 **CSV**(세션마다 1행 append).
  컬럼: `session_id, scenario, n_metric_frames, n_events, min_ttc_s, max_jerk_m_s3,
  max_yaw_rate_rad_s, max_lat_accel_m_s2, brake_response_delay_s, overshoot_kmh,
  recovery_time_s, lane_departure_m, c1_success_rate, c1_gap_attempts, c1_cleared, n_warnings`.
- 식별자는 **`session_id`만**(예: `P07_R2`) — 개인식별정보(이름·연락처) 미기록(CLAUDE.md §3).
- `n_warnings > 0` 행은 일부 지표가 NaN(미구현/결측 필드)일 수 있으니 일관성 판정에서
  해당 지표를 제외하고 각주로 표기한다.

## 3. 절차

1. C1·C2 각 시나리오의 세션 로그를 `scenarioQA.py`로 처리해 CSV에 누적.
2. CSV를 **시나리오별로 분리**(C1 / C2)해 아래 §4 매트릭스에 채운다.
3. 지표별 **평균 · SD · 변동계수(CV=SD/평균) · 범위(min–max)** 를 계산.
4. §5 일관성 가이드로 판정하고, 이상 세션(아웃라이어)·NaN 다발 지표를 §6에 기록.
5. 판정 결과를 자극물 동결 HITL 게이트(`research_plan.md` §10)에 보고.

---

## 4. 표 양식 — 피험자 × 지표 매트릭스 (시나리오별 분리)

### 4.1 C1 (답답 / roundabout) — 강조 지표: Recovery time · 성공률 · Brake Response Delay

| session_id | Recovery time (s) ★ | C1 성공률 ★ | Brake Resp. Delay (s) ★ | 최소 TTC (s) | 최대 Jerk (m/s³) | 차선이탈 (m) | n_warn |
|---|---|---|---|---|---|---|---|
| P01_… | … | … | … | … | … | … | … |
| P02_… | … | … | … | … | … | … | … |
| … | … | … | … | … | … | … | … |
| **평균** | … | … | … | … | … | … | — |
| **SD** | … | … | … | … | … | … | — |
| **CV** | … | … | … | … | … | … | — |
| **범위(min–max)** | …–… | …–… | …–… | …–… | …–… | …–… | — |

> ★ = C1 강조 지표(analysis_plan §2.6). C1에서 `max_yaw_rate`/`max_lat_accel`은 보조로만.

### 4.2 C2 (불안 / aquaplaning) — 강조 지표: 최대 Yaw rate · 최대 lateral accel

| session_id | 최대 Yaw rate (rad/s) ★ | 최대 lat. accel (m/s²) ★ | 최대 Jerk (m/s³) | 최소 TTC (s) | 차선이탈 (m) | Recovery time (s) | n_warn |
|---|---|---|---|---|---|---|---|
| P01_… | … | … | … | … | … | … | … |
| P02_… | … | … | … | … | … | … | … |
| … | … | … | … | … | … | … | … |
| **평균** | … | … | … | … | … | … | — |
| **SD** | … | … | … | … | … | … | — |
| **CV** | … | … | … | … | … | … | — |
| **범위(min–max)** | …–… | …–… | …–… | …–… | …–… | …–… | — |

> ★ = C2 강조 지표. C2 수막현상의 "제어상실/슬라이드" 특성은 yaw rate·lat accel에 반영(결정 ⑧).

### 4.3 지표별 일관성 요약(시나리오 통합 뷰, 선택)

| 지표 | 시나리오 | 평균 | SD | **CV** | 범위 | 일관성 판정 | 비고 |
|---|---|---|---|---|---|---|---|
| Recovery time | C1 | … | … | … | …–… | TBD(HITL) | 강조 |
| C1 성공률 | C1 | … | … | … | …–… | TBD(HITL) | 강조 |
| Brake Resp. Delay | C1 | … | … | … | …–… | TBD(HITL) | 강조 |
| 최대 Yaw rate | C2 | … | … | … | …–… | TBD(HITL) | 강조 |
| 최대 lateral accel | C2 | … | … | … | …–… | TBD(HITL) | 강조 |
| 최대 Jerk | C1/C2 | … | … | … | …–… | TBD(HITL) | 공통 |
| 최소 TTC | C1/C2 | … | … | … | …–… | TBD(HITL) | 공통 |
| 차선 이탈 거리 | C1/C2 | … | … | … | …–… | TBD(HITL) | 공통 |

---

## 5. 일관성 판정 가이드

- **판정 통계 = 변동계수(CV = SD / |평균|).** 단위가 다른 지표를 한 잣대로 비교하기 위함.
  (평균이 0에 가까운 지표는 CV가 불안정 → 범위(min–max)와 SD를 병기해 판단.)
- **CV 임계값은 임의로 발명하지 않는다.** 자극물 동결 전 **HITL 게이트(research_plan §10)** 에서
  지표별로 확정한다. 표·본문에는 **`TBD(HITL)`** 로 두고, 확정 후 이 문서에 한 줄로 고정한다.
  - (참고 틀, 수치 아님) 일반적으로 CV가 낮을수록 재생 일관성이 높다 — *낮음/보통/높음*의
    구간 경계는 파일럿 분포를 보고 HITL에서 정한다. 본 템플릿은 경계 숫자를 비워 둔다.
- **NaN 다발 지표:** `n_warnings>0`로 특정 지표가 다수 세션에서 NaN이면, 그 지표는 일관성
  판정에서 제외하고 "측정 미구현(로그 필드 부재)"으로 §6에 명시(아래 §7 한계 참조).
- **아웃라이어 세션:** 범위가 비정상으로 넓은 지표는 해당 세션 로그를 되짚어(재생 실패·트리거
  누락·6DOF/HMI 비동기 등) 원인을 §6에 기록한다. 자극물 문제와 측정 문제를 구분한다.

---

## 6. 판정·이슈 기록 (세션 처리 후 채움)

- C1 일관성 판정: TBD(HITL) — 근거 CV/범위: …
- C2 일관성 판정: TBD(HITL) — 근거 CV/범위: …
- NaN 다발 지표(원인 분류, §7): 연속 물리필드(jerk·yaw rate·lat accel·lane_departure)는
  collector 가 이미 로깅하므로 **NaN 이면 t_sim 결손/슬로모 또는 프레임 부족**이 원인이다.
  반면 `min_ttc_s`(lead_distance_m)·`brake_response_delay_s`·`recovery_time_s`·`c1_success_rate`
  의 NaN 은 **이벤트/선행차거리 미발행**이 원인(측정 미구현 아님 — dryrun_verification G1-1 로 판정).
- 아웃라이어/재생 이슈 세션: …
- 자극물 동결 권고: TBD(HITL 게이트 보고용)

---

## 7. analysis_plan §2.6 정합 & 한계 (재현성)

- **정합:** 본 리포트는 §2.6-(a) "시나리오 정량 특성화·동결(기술통계만)"의 운영 산출이다.
  C1 강조 = Recovery time·성공/실패율·Brake Response Delay, C2 강조 = 최대 yaw rate·최대
  lateral acceleration (§2.6, 결정 ⑦)과 일치한다. **조작 점검(§2.6-b, 정서 유발)은 별도**이며
  이 QA 리포트에 섞지 않는다.
- **현 측정 현황(2026-06-19 검증으로 정정):** 옛 서술("collector가 `{map,id,x,y,z,yaw,speed,t}`
  만 보내 6지표 필드가 0% 로깅 / world_metric 미구현")은 **stale 이라 폐기한다.** 현행
  `carla_collector._viewer_frame` 은 `type=="world_metric"` + `t_sim` +
  `long_accel/lat_accel/yaw_rate/brake/throttle/steer/lane_offset_m/speed_kmh` 를 발행하고,
  `websocket_sender` 가 모든 프레임에 `session_id`·`t_bus` 를 스탬프한다. ⇒ **연속 물리필드는
  이미 100% 로깅**되므로 jerk·yaw rate·lat accel·차선이탈은 수치로 나와야 한다.
  - 그러므로 NaN 의 실제 원인은 다음 둘로 한정된다(필드 미구현 아님):
    1. **이벤트/선행차거리 미발행** — `scenario_event`(브레이크 기준점·성공률·recovery) 와
       `lead_distance_m`(최소 TTC) 가 로그에 있어야 산출된다. FSM 실발행 여부 = dryrun G1-1 로 판정.
    2. **시간축 슬로모** — real-time factor<1.0 구간. 미분지표는 `scenarioQA.py` 가 `t_sim`(sim-time)
       기준으로만 산출하며(G0-4), `t_sim` 결손/슬로모 시 경고 플래그(`slowmo_flag`)와 함께 표기한다.
- **재현성:** `scenarioQA.py`는 **결정론(난수 없음)** 이라 같은 입력 로그 → 같은 출력.
  세션 로그(JSONL)·CSV·이 리포트는 자극물 동결 증거로 보관한다(원본 로그는 수정 금지).

---

*양식 작성: 2026-06-04 (결정 ⑦) · `[분석도구]` 트랙 · 페어: `scenarioQA.py`,
`08_data_analysis/analysis_plan.md` §2.6, `04_design/feedback_260604_decisions.md`.*
