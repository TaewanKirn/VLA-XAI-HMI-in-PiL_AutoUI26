#!/usr/bin/env python3
# tools/scenarioQA.py
# [분석도구] WS JSONL 세션 로그 → 시나리오 정량 6지표 산출 (시나리오 종료 후 평가)
#
# 결정 정본: 04_design/feedback_260604_decisions.md 결정 ⑦
#   "시나리오 지표 평가는 websocket에 기록된 값들을 토대로 시나리오 종료 후 평가한다."
# 지표 정의 정본: 08_data_analysis/analysis_plan.md §2.6 (시나리오 정량 6지표)
#   = 최소 TTC · 최대 Jerk · 최대 Yaw rate/lateral accel · Brake Response Delay ·
#     Overshoot·Recovery time · 차선 이탈 거리.
#   ⚠ 이 6지표는 **가설 종속변수(DV)가 아니다.** 시나리오의 객관적 재현성·동결
#      (frozen replay) 일관성 근거로만 쓰이는 기술통계용 산출이다(analysis_plan §2.6-a).
#
# 입력: ws_monitor.html 의 "JSONL 내보내기" 산출(수신 원본 + t_recv) 또는
#       서버측 JSONL 로거(hmi_carla_sync_logging_260531 §5)의 세션 로그.
#       1줄 = 1 JSON 메시지(NDJSON).
#
# ──────────────────────────────────────────────────────────────────────────
# ⚠⚠ 구현 현황 (반드시 읽을 것) ⚠⚠  ※ 2026-06-19 검증으로 정정(옛 "0% 로깅" 폐기)
#   carla_collector._viewer_frame 이 이미 world_metric 스키마를 발행한다(검증됨):
#     type=="world_metric" + t_sim + speed_kmh +
#     long_accel/lat_accel/yaw_rate/brake/throttle/steer/lane_offset_m,
#   그리고 websocket_sender 가 모든 프레임에 session_id·t_bus 를 중앙 스탬프한다.
#   ⇒ 6지표의 **연속 물리필드는 이미 100% 로깅된다.** (옛 "필드 0% 로깅 / world_metric
#      미구현" 서술은 stale — 폐기. carla_collector.py §_build_data/_viewer_frame 참조.)
#
#   따라서 NaN 의 실제 원인은 '필드 미구현'이 아니라 다음 둘이다:
#     (1) 이벤트 미발행 — TTC(lead_distance_m)·Brake Response Delay·Recovery·성공률은
#         scenario_event(또는 선행차 거리 필드)가 로그에 있어야 산출된다. FSM 이 해당
#         이벤트를 실제로 발행했는지가 NaN 잔존의 주원인(dryrun_verification G1-1 로 판정).
#     (2) 시간축 슬로모 — C2 SIM_DELTA 설계 대비 서버 틱이 느려 real-time factor<1.0 이면
#         wall-clock 폴백(t_bus/t_recv/t)이 미분지표(jerk·yaw_rate·lat_accel)를 왜곡한다.
#         → 본 스크립트는 미분지표를 **t_sim 기준으로만** 산출하고(아래 _ts_seconds·_sim_seconds),
#           t_sim 결손/슬로모 구간엔 경고 플래그를 남긴다(가짜 값 생성 금지).
#
# 필드 매핑 가정 (hmi_carla_sync_logging_260531 §2.2 world_metric 스키마, 현행 collector 검증):
#   시간:        t_sim(초, sim-time, 미분지표 정본) ≫ t_bus(초, 서버 monotonic) >
#                t_recv(ms, ws_monitor) > t(현 collector wall-clock, 초)
#                ⚠ 미분/시간기반 지표(jerk·yaw_rate·lat_accel·*_delay·recovery)는 t_sim 만 사용.
#                  t_bus/t_recv/t 는 wall-clock 이라 슬로모 시 미분을 왜곡 → 폴백 시 경고.
#   속도:        speed_kmh(우선) > speed(현 collector, km/h)
#   가속(종/횡): long_accel, lat_accel (m/s²)  [없으면 속도 미분으로 종가속 폴백]
#   yaw rate:    yaw_rate (rad/s)              [없으면 yaw(deg) 미분으로 폴백]
#   제동:        brake (0~1)
#   차선 이탈:   lane_offset_m (m)
#   위치:        x, y (m)                      [TTC 추정 보조]
#   이벤트:      type=="scenario_event" 의 event/scenario (Brake Response Delay 기준점),
#                payload.recommended_kmh / current_kmh (overshoot 보조)
#   선행차 거리: lead_distance_m, lead_speed_kmh (있으면 TTC 직접 산출)
#
# 출력: 지표 dict(stdout, JSON) + CSV 1행(--out). CSV에 피험자/세션 식별자 컬럼 포함
#       (식별자는 로그의 session_id 키만 사용 — 개인식별정보 미기록, CLAUDE.md §3).
#
# 재현성: **난수 없음·완전 결정론적** → 시드 불필요(결정 ⑦). 표준 라이브러리만 사용
#         (numpy 있으면 사용, 없으면 순수 python 폴백).

import argparse
import json
import math
import os
import sys
import csv as _csv

try:
    import numpy as _np  # 선택: 있으면 사용, 없으면 순수 python 폴백
    _HAVE_NP = True
except Exception:
    _HAVE_NP = False

NAN = float("nan")
WARN = []  # 누적 경고(미구현/결측 필드)


def _warn(msg):
    if msg not in WARN:
        WARN.append(msg)


# ──────────────────────────────────────────────────────────────────────────
# 1. 로그 파싱 (NDJSON)
# ──────────────────────────────────────────────────────────────────────────
def load_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                _warn(f"L{ln}: JSON 파싱 실패 → 건너뜀")
    return rows


def _get(d, *keys):
    """첫 번째로 존재하는 키의 값을 반환(중첩 dict는 마지막 단계까지 점 표기 없이 평탄 가정)."""
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def _sim_seconds(msg):
    """미분/시간기반 지표 전용 시간축 = **sim-time(t_sim) 만**.
    슬로모(real-time factor<1.0)에서 wall-clock 폴백을 쓰면 d/dt 가 왜곡되므로,
    jerk·yaw_rate(미분)·lat_accel(미분)·brake_delay·recovery 는 t_sim 이 없으면 산출하지 않는다.
    반환: sim-time(초) 또는 None(=t_sim 결손)."""
    v = _get(msg, "t_sim")
    return float(v) if v is not None else None


def _wall_seconds(msg):
    """wall-clock(실시간) 축 — real-time factor(슬로모) 산정 전용.
    우선순위: t_bus(서버 monotonic 초) > t(collector wall-clock 초) > t_recv(ms)."""
    v = _get(msg, "t_bus")
    if v is not None:
        return float(v)
    v = _get(msg, "t")
    if v is not None:
        return float(v)
    v = _get(msg, "t_recv")
    if v is not None:
        return float(v) / 1000.0
    return None


def _ts_seconds(msg):
    """일반(비미분) 타임스탬프를 '초' 단위 float로 정규화 — 이벤트 정렬·구간 매칭용.
    우선순위: t_sim(sim-time) ≫ t_bus(서버 monotonic 초) > t_recv(ms) > t(wall-clock 초).
    ⚠ t_bus 는 websocket_sender._now_bus() 가 '초' 단위로 찍는다(과거 ms 가정은 버그였음).
    ⚠ 미분지표에는 이 폴백을 쓰지 말 것 — 슬로모 시 wall-clock 폴백이 d/dt 를 왜곡한다.
      미분지표는 반드시 _sim_seconds(t_sim) 만 사용한다(G0-4)."""
    v = _get(msg, "t_sim")
    if v is not None:
        return float(v)
    v = _get(msg, "t_bus")
    if v is not None:
        return float(v)             # 초 단위(서버 monotonic) — /1000 아님
    v = _get(msg, "t_recv")
    if v is not None:
        return float(v) / 1000.0    # ws_monitor 수신시각(ms)
    v = _get(msg, "t")
    if v is not None:
        return float(v)             # collector wall-clock(초)
    return None


def extract_series(rows, scenario=None):
    """world_metric/위치 프레임을 시계열로, scenario_event를 이벤트 리스트로 분리."""
    metrics = []   # [{t, speed_kmh, long_accel, lat_accel, yaw, yaw_rate, brake,
                   #   lane_offset_m, x, y, lead_distance_m, lead_speed_kmh}]
    events = []    # [{t, scenario, event, payload}]
    session_id = None

    for msg in rows:
        if not isinstance(msg, dict):
            continue
        sid = _get(msg, "session_id")
        if sid is not None and session_id is None:
            session_id = sid

        mtype = (msg.get("type") or "").lower()

        if mtype == "scenario_event":
            # scenario 필터: 인자로 받은 C1/C2(또는 로그상 scenario 문자열)와 매칭
            events.append({
                "t": _ts_seconds(msg),
                "scenario": _get(msg, "scenario"),
                "event": _get(msg, "event"),
                "manual": bool(msg.get("manual", False)),
                "payload": msg.get("payload", {}) or {},
            })
            continue

        # world_metric 또는 현행 collector 프레임({map,id,x,y,z,yaw,speed,t})
        t = _ts_seconds(msg)
        if t is None:
            continue
        speed = _get(msg, "speed_kmh", "speed")
        rec = {
            "t": t,
            "t_sim": _sim_seconds(msg),     # 미분지표 전용 sim-time 축(없으면 None)
            "t_wall": _wall_seconds(msg),   # real-time factor 산정용 wall-clock 축
            "speed_kmh": float(speed) if speed is not None else None,
            "long_accel": _to_f(_get(msg, "long_accel")),
            "lat_accel": _to_f(_get(msg, "lat_accel")),
            "yaw": _to_f(_get(msg, "yaw")),
            "yaw_rate": _to_f(_get(msg, "yaw_rate")),
            "brake": _to_f(_get(msg, "brake")),
            "lane_offset_m": _to_f(_get(msg, "lane_offset_m", "lane_offset")),
            "x": _to_f(_get(msg, "x")),
            "y": _to_f(_get(msg, "y")),
            "lead_distance_m": _to_f(_get(msg, "lead_distance_m")),
            "lead_speed_kmh": _to_f(_get(msg, "lead_speed_kmh")),
        }
        # world_metric 만 받으려면 type 검사 가능하나, 현행 collector는 type이 없으므로
        # 위치/속도 프레임도 포함(graceful degrade).
        if rec["speed_kmh"] is not None or rec["x"] is not None:
            metrics.append(rec)

    metrics.sort(key=lambda r: r["t"])
    events.sort(key=lambda r: (r["t"] is None, r["t"]))
    return metrics, events, session_id


def _to_f(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


SLOWMO_THR = 0.95  # real-time factor 가 이보다 낮으면 슬로모로 간주(설계 1.0x 대비)


def real_time_factor(metrics):
    """real-time factor = Δ(sim-time) / Δ(wall-clock).  1.0=실시간, <1.0=슬로모.
    t_sim·t_wall 둘 다 있는 첫/끝 프레임으로 산정(결정론). 둘 중 하나라도 없으면 None."""
    sim = [(m["t_sim"], m["t_wall"]) for m in metrics
           if m.get("t_sim") is not None and m.get("t_wall") is not None]
    if len(sim) < 2:
        return None
    d_sim = sim[-1][0] - sim[0][0]
    d_wall = sim[-1][1] - sim[0][1]
    if d_wall <= 1e-6:
        return None
    return d_sim / d_wall


def _sim_axis_ok(metrics):
    """미분지표를 t_sim 으로 낼 수 있는지(=프레임에 t_sim 이 충분히 있는지) 점검 + 슬로모 경고.
    반환: True(=t_sim 기반 산출 가능). t_sim 결손이면 False(미분지표 산출 보류)."""
    have_sim = sum(1 for m in metrics if m.get("t_sim") is not None)
    if have_sim < 2:
        _warn("미분지표(jerk·yaw_rate·lat_accel): t_sim(sim-time) 프레임 부족 → 산출 보류 "
              "(wall-clock 폴백은 슬로모 왜곡 위험으로 금지). collector world_metric t_sim 확인 요")
        return False
    rtf = real_time_factor(metrics)
    if rtf is not None and rtf < SLOWMO_THR:
        _warn(f"⚠ 슬로모 감지: real-time factor≈{rtf:.3f}x (<{SLOWMO_THR}). "
              "미분지표는 t_sim 기준이라 값 자체는 유효하나, 슬로모 구간 = 수막 버즈(11~14Hz) 등 "
              "고주파 거동이 실제 주행과 다를 수 있음(dryrun_verification R1/T10). flag 표기.")
    return True


# ──────────────────────────────────────────────────────────────────────────
# 2. 수치 보조 (결정론)
# ──────────────────────────────────────────────────────────────────────────
def _col(metrics, key):
    return [m[key] for m in metrics]


def _valid_pairs(ts, vals):
    """(t, v) 쌍 중 둘 다 유효(None/NaN 아님)한 것만."""
    out = []
    for t, v in zip(ts, vals):
        if t is None or v is None:
            continue
        if isinstance(v, float) and math.isnan(v):
            continue
        out.append((t, v))
    return out


# ── 물리 방어 한도 (CARLA 물리엔진 스파이크 제거) ────────────────────────────
# 2026-06-24 진단(dryrun_C1/C2): max jerk 가 C1 654.7·C2 906.4 m/s³ 로 비현실적.
#   원인 = (b) accel 신호 자체의 프레임간 점프(정차·stop-start·접촉 시 CARLA
#   get_acceleration()의 과도 임펄스). Δt 는 깨끗했다(C1≈38ms·C2≈25ms 균일,
#   Δt≤0 0건·<5ms 0건) → 분모폭발(a) 아님. 따라서 한도는 "분모"가 아니라
#   "미분 결과(=jerk)"와 "원신호(accel)" 양쪽의 물리 타당성에 건다.
#
# MIN_DT_S: 그래도 Δt 0 근처 분모폭발은 구조적으로 차단(향후 프레임드롭 대비).
#   5ms = 200Hz, 어떤 로깅 틱보다 빠르므로 이보다 작은 Δt 는 타임스탬프 글리치.
MIN_DT_S = 0.005
# JERK_PHYS_CEILING: 승용차 종방향 jerk 물리 상한.
#   ISO 2631 승차감: 쾌적 <0.9, 허용 <2 m/s³. 긴급제동 onset 실측 피크 ~10–15.
#   공격적 AEB/스텝입력(차량동역학 문헌) 최대 ~30–50 m/s³. 파워트레인·브레이크
#   액추에이션의 절대 물리한계조차 ~50 m/s³ 를 넘기 어렵다.
#   → 이를 초과하는 프레임간 jerk 는 실제 거동이 아니라 물리엔진 임펄스(아티팩트).
#   본 캡처 검증: C1 p95 jerk≈34·C2 p95≈51 → 정상 거동 피크는 이 한도 아래라
#   진짜 피크를 죽이지 않는다(과필터 아님). 한도 초과분만 max 후보에서 제외.
JERK_PHYS_CEILING_M_S3 = 50.0
# 횡가속 물리 상한(타이어 접지한계 ~1g, 일반 주행 «1g). lat_accel 도 같은 임펄스
#   아티팩트(본 캡처 raw max C1 15.5·C2 14.5 m/s² ≈1.5g+ 비현실)를 받으므로 동일 방어.
LAT_ACCEL_PHYS_CEILING_M_S2 = 12.0  # ≈1.22g (드라이 접지한계 여유 상한)
# Yaw rate 물리 상한(rad/s). jerk·lat_accel 과 동일하게 정차·접촉(C2 collision) 시 CARLA
#   물리엔진 임펄스가 yaw_rate 에도 비현실 스파이크를 만든다. 승용차 yaw rate 는 일반주행
#   «0.5 rad/s(≈29°/s), 공격적 선회·짐카나 ~1 rad/s, 수막현상 스핀(제어상실) 최대 ~2 rad/s.
#   파워트레인·타이어 물리한계로 정상 차량거동이 ~4 rad/s(≈229°/s)를 넘기는 사실상 불가능.
#   → 이를 초과하는 표본은 접촉 임펄스 아티팩트로 보고 max 후보에서 제외(클램프 아님).
#   ⚠ C2 수막 스핀의 *진짜* 피크(loss-of-control)를 죽이지 않도록 보수적으로 높게 설정.
#   본수집 캡처에서 p95 yaw_rate 분포를 확인해 과필터 아님을 검증할 것(jerk 게이트와 동일 절차).
YAW_RATE_PHYS_CEILING_RAD_S = 4.0

# ── 기준 이벤트·정착시간 정의 (analysis_plan §2.6 C1/C2 강조지표) ──────────────
# Brake Response Delay·Recovery time 은 "교란(hazard) 발생 시점 → 반응/정착"이라
#   *어느 이벤트를 기준점으로 잡느냐* 가 값의 의미를 좌우한다. 시나리오 무관하게
#   '첫 이벤트'(=C1 drive_start t≈0)를 쓰면 무의미한 큰 지연이 나온다(구버전 결함).
#   → 시나리오별 hazard-onset 이벤트를 명시 매핑한다(아래). 정본 = ego_controller.py /
#   anxiety/Puddle/main.py 의 실제 emit 이벤트명(2026-06-29 grep 확인).
TRIGGER_EVENTS = {
    # C1(답답/roundabout): 교착 시작 = 제동·정지 onset. 우선순위 = 가장 이른 hazard.
    "C1": ("junction_deadlock_start", "stuck_stop", "force_merge"),
    # C2(불안/aquaplaning): 수막 진입 = 제어교란 onset.
    "C2": ("puddle_enter",),
}
# 정착(settled) 판정용 — control-systems 정착시간 관례(밴드 내 '지속 유지'):
SETTLE_DWELL_S = 2.0          # 밴드 안에 이 시간 이상 '연속' 머물러야 정착으로 인정(false-touch 방지)
YAW_SETTLE_BAND_RAD_S = 0.10  # C2 yaw rate 정착 밴드(≈5.7°/s, 직진 복귀 근사). HITL 확정 전 잠정값
SPEED_RECOVER_BAND_FRAC = 0.10  # C1 속도 정착 밴드 = baseline ±10%. HITL 확정 전 잠정값
# ⚠ 위 SETTLE_DWELL_S·*_BAND_* 는 자극물 동결 전 HITL 게이트(research_plan §10)에서 확정.
#   값 자체를 '발명한 최종치'로 제시하지 말 것 — 본수집 분포를 보고 고정.


def _derivative(ts, vals):
    """결정론적 전진 차분 d(vals)/d(t). 반환: [(t_mid, slope), ...].
    Δt < MIN_DT_S 인 쌍은 분모폭발 방지로 스킵(타임스탬프 글리치 차단)."""
    pairs = _valid_pairs(ts, vals)
    out = []
    for i in range(1, len(pairs)):
        t0, v0 = pairs[i - 1]
        t1, v1 = pairs[i]
        dt = t1 - t0
        if dt < MIN_DT_S:
            continue
        out.append(((t0 + t1) / 2.0, (v1 - v0) / dt))
    return out


def _max_abs(seq_pairs):
    if not seq_pairs:
        return NAN
    return max(abs(v) for _, v in seq_pairs)


def _max_abs_gated(seq_pairs, ceiling, warn_label):
    """물리 타당성 게이트: |값| > ceiling 인 표본은 물리엔진 아티팩트로 보고 제외한 뒤
    살아남은 표본의 max|값| 을 반환. 전부 제외되면 NaN.
    (한도를 '클램프'하지 않고 '제외'한다 → 결과가 한도에 핀 고정되지 않고
     실제 물리 피크를 보고. analysis_plan §2.6-a 재현성 기술통계 목적.)"""
    if not seq_pairs:
        return NAN
    kept = [abs(v) for _, v in seq_pairs if abs(v) <= ceiling]
    n_drop = len(seq_pairs) - len(kept)
    if n_drop:
        _warn(f"{warn_label}: 물리한도(|값|>{ceiling:g}) 초과 {n_drop}/{len(seq_pairs)} 표본 "
              f"제외(CARLA 물리엔진 임펄스 아티팩트 — 정차·stop-start·접촉 과도값). "
              f"한도 이하 실제 피크만 보고.")
    return max(kept) if kept else NAN


def _max_val(vals):
    clean = [v for v in vals if v is not None and not (isinstance(v, float) and math.isnan(v))]
    return max(clean) if clean else NAN


def _min_val(vals):
    clean = [v for v in vals if v is not None and not (isinstance(v, float) and math.isnan(v))]
    return min(clean) if clean else NAN


def _trigger_event_time(events, scenario):
    """시나리오별 hazard-onset 기준 이벤트의 (시각, 이벤트명) 반환.
    - scenario 지정 시: TRIGGER_EVENTS[scenario] 중 **가장 이른** 이벤트(결정론). 없으면 (None,None).
    - scenario 미지정 시: 첫 유효-타임스탬프 이벤트로 폴백(레거시). drive_start(t≈0) 오염 위험은
      warn 으로 표기(기준점 미상)."""
    names = TRIGGER_EVENTS.get((scenario or "").upper())
    if not names:
        e = next((e for e in events if e["t"] is not None), None)
        if e is None:
            return None, None
        _warn(f"기준 이벤트: 시나리오 미지정 → 첫 이벤트('{e.get('event')}')를 기준점으로 폴백 "
              f"(C1 drive_start 등 t≈0 오염 가능 — --scenario C1/C2 지정 권장)")
        return e["t"], e.get("event")
    cand = [e for e in events if e["t"] is not None and (e.get("event") or "") in names]
    if not cand:
        return None, None
    cand.sort(key=lambda e: e["t"])
    return cand[0]["t"], cand[0].get("event")


def _settling_time(samples, t_trig, center, band, dwell):
    """제어공학 정착시간: 교란 t_trig 이후 |v-center|<=band 가 **dwell 초 이상 연속 유지**되기
    시작하는 첫 시각 t* 를 찾아 (t* - t_trig) 반환. 한 번 닿았다 벗어나는 false-touch 는 배제.
    samples=[(t,v)] (정렬 무관, 내부 정렬). 로그가 t*+dwell 전에 끝나 '유지'를 확인 못하면 None
    (보수적 — 가짜 정착 보고 금지). 반환: (recovery_s 또는 None, settled_confirmed: bool)."""
    post = sorted((t, v) for t, v in samples
                  if t is not None and v is not None and t >= t_trig)
    n = len(post)
    if n == 0:
        return None, False
    t_end = post[-1][0]
    for i in range(n):
        t0 = post[i][0]
        ok = True
        covered = False
        for j in range(i, n):
            tj, vj = post[j]
            if abs(vj - center) > band:
                ok = False
                break
            if tj - t0 >= dwell:
                covered = True
                break
        if ok and covered:
            return (t0 - t_trig), True
    # 밴드엔 들어왔으나 로그가 짧아 dwell 확인 불가한 경우 구분(보수적 None)
    if t_end - t_trig < dwell:
        _warn("정착시간: 트리거 후 로그 길이 < 정착 dwell → '지속 유지' 확인 불가(보수적 NaN)")
    return None, False


# ──────────────────────────────────────────────────────────────────────────
# 3. 6지표 산출 (analysis_plan §2.6)
# ──────────────────────────────────────────────────────────────────────────
def metric_min_ttc(metrics):
    """최소 TTC(s). lead_distance_m / 상대속도(우선); 없으면 NaN+경고."""
    best = NAN
    have = False
    for m in metrics:
        d = m["lead_distance_m"]
        if d is None:
            continue
        have = True
        ego = m["speed_kmh"]
        lead = m["lead_speed_kmh"]
        if ego is None:
            continue
        rel_kmh = ego - (lead if lead is not None else 0.0)  # 접근속도(km/h)
        rel_ms = rel_kmh / 3.6
        if rel_ms <= 1e-3:   # 접근 아님 → TTC 무한대(위험 아님), 후보 제외
            continue
        ttc = d / rel_ms
        if math.isnan(best) or ttc < best:
            best = ttc
    if not have:
        _warn("최소 TTC: lead_distance_m/lead_speed_kmh 필드 없음 → NaN "
              "(CARLA collector에 선행차 거리 로깅 미구현)")
    return best


def metric_max_jerk(metrics):
    """최대 |Jerk| = |d(accel)/d(t_sim)| (m/s³). long_accel 우선, 없으면 속도→가속→jerk 폴백.
    시간축은 **t_sim(sim-time)** 만 사용(G0-4) — 슬로모 시 wall-clock 미분 왜곡 방지."""
    if not _sim_axis_ok(metrics):
        return NAN
    ts = _col(metrics, "t_sim")   # sim-time 축(미분 정본)
    la = _col(metrics, "long_accel")
    if any(v is not None for v in la):
        # 물리 타당성 게이트: jerk>JERK_PHYS_CEILING 표본(=물리엔진 임펄스 아티팩트) 제외
        return _max_abs_gated(_derivative(ts, la),
                              JERK_PHYS_CEILING_M_S3, "최대 Jerk")
    # 폴백: speed(km/h)→m/s→가속→jerk (2차 미분)
    sp = [s / 3.6 if s is not None else None for s in _col(metrics, "speed_kmh")]
    accel = _derivative(ts, sp)
    if not accel:
        _warn("최대 Jerk: long_accel 및 speed 모두 부족 → NaN")
        return NAN
    _warn("최대 Jerk: long_accel 없음 → speed 2차 미분 폴백(노이즈 민감, 보조값)")
    at = [t for t, _ in accel]
    av = [v for _, v in accel]
    return _max_abs_gated(_derivative(at, av),
                          JERK_PHYS_CEILING_M_S3, "최대 Jerk(폴백)")


def metric_max_yaw_rate(metrics):
    """최대 |yaw rate| (rad/s). yaw_rate(직접값) 우선, 없으면 yaw(deg) 미분 폴백.
    미분 폴백 시 시간축은 **t_sim** 만 사용(G0-4)."""
    yr = _col(metrics, "yaw_rate")
    if any(v is not None for v in yr):
        # 물리 타당성 게이트: |yaw_rate|>YAW_RATE_PHYS_CEILING 표본(접촉 임펄스 아티팩트) 제외
        #   — jerk·lat_accel 과 동일 방어. C2 수막 스핀의 진짜 피크는 한도 아래로 보존.
        return _max_abs_gated([(0, v) for v in yr if v is not None],
                              YAW_RATE_PHYS_CEILING_RAD_S, "최대 Yaw rate")
    # 미분 폴백 → sim-time 필요
    if not _sim_axis_ok(metrics):
        return NAN
    ts = _col(metrics, "t_sim")
    yaw = _col(metrics, "yaw")
    if any(v is not None for v in yaw):
        _warn("최대 Yaw rate: yaw_rate 없음 → yaw(deg) 미분 폴백(deg/s→rad/s, t_sim 기준)")
        deriv = _derivative(ts, yaw)  # deg/s
        return _max_abs_gated([(t, math.radians(v)) for t, v in deriv],
                              YAW_RATE_PHYS_CEILING_RAD_S, "최대 Yaw rate(폴백)")
    _warn("최대 Yaw rate: yaw_rate/yaw 모두 없음 → NaN")
    return NAN


def metric_max_lat_accel(metrics):
    """최대 |lateral accel| (m/s²). lat_accel 직접; 없으면 yaw_rate*speed 폴백."""
    la = _col(metrics, "lat_accel")
    if any(v is not None for v in la):
        # lat_accel 도 정차·접촉 시 동일 임펄스 아티팩트 → 횡가속 물리한도로 게이트
        return _max_abs_gated([(0, v) for v in la if v is not None],
                              LAT_ACCEL_PHYS_CEILING_M_S2, "최대 lateral accel")
    # 폴백: a_lat ≈ yaw_rate(rad/s) * v(m/s)
    best = NAN
    used = False
    for m in metrics:
        yr, sp = m["yaw_rate"], m["speed_kmh"]
        if yr is None or sp is None:
            continue
        used = True
        a = abs(yr * (sp / 3.6))
        if math.isnan(best) or a > best:
            best = a
    if used:
        _warn("최대 lateral accel: lat_accel 없음 → yaw_rate×speed 폴백(근사)")
    else:
        _warn("최대 lateral accel: lat_accel/(yaw_rate,speed) 부족 → NaN")
    return best


def metric_brake_response_delay(metrics, events, scenario=None):
    """Brake Response Delay(s): **시나리오별 hazard-onset 이벤트**(C1=junction_deadlock_start/
       stuck_stop, C2=puddle_enter) → 첫 유의 제동(brake>thr)까지. C1(답답) 강조 지표.
       구버전 결함(첫 이벤트=drive_start t≈0 기준)을 시나리오-키 기준점으로 교정(2026-06-29)."""
    if not events:
        _warn("Brake Response Delay: scenario_event 없음 → NaN (트리거 시점 미상)")
        return NAN
    t_trig, trig_name = _trigger_event_time(events, scenario)
    if t_trig is None:
        names = TRIGGER_EVENTS.get((scenario or "").upper())
        _warn(f"Brake Response Delay: hazard-onset 이벤트{tuple(names) if names else ''} 미발행 → NaN "
              f"(FSM 이벤트 실발행 = dryrun G1-1 확인 필요)")
        return NAN
    THR = 0.1  # 유의 제동 임계(0~1) — 동결 전 HITL에서 확정 가능, 보수적 기본값
    have_brake = any(m["brake"] is not None for m in metrics)
    if not have_brake:
        _warn("Brake Response Delay: brake 필드 없음 → NaN (제동 로깅 미구현)")
        return NAN
    for m in metrics:
        if m["t"] is None or m["t"] < t_trig:
            continue
        if m["brake"] is not None and m["brake"] > THR:
            return m["t"] - t_trig
    _warn(f"Brake Response Delay: 트리거('{trig_name}') 후 brake>{THR} 구간 없음 → NaN")
    return NAN


def metric_overshoot_recovery(metrics, events, scenario=None):
    """Overshoot(km/h, 권고속도 초과 최대분) + Recovery time(s, 교란→정착).
       Recovery 정의(2026-06-29 시나리오별 신호 분리):
         · C2(불안/수막) = **yaw rate 정착시간** — 제어상실(스핀) 후 |yaw_rate| 이
           정착밴드 내로 SETTLE_DWELL_S 이상 연속 복귀할 때까지(차량이 방향 안정 회복).
         · C1(답답/교착) = **속도 정착시간** — 교착 후 속도가 baseline ±10% 로 복귀·유지될 때까지.
         · scenario 미지정 = 속도 정착(레거시), 단 기준점 폴백 warn.
       기준점 = _trigger_event_time(시나리오별 hazard-onset). 정착 = _settling_time(지속유지)."""
    overshoot = NAN
    recovery = NAN

    # ── Overshoot: scenario_event.payload 의 recommended_kmh 대비 이후 최대 초과분 ──
    rec_kmh = None
    t_ref = None
    for e in events:
        p = e.get("payload") or {}
        if "recommended_kmh" in p:
            rec_kmh = _to_f(p.get("recommended_kmh"))
            t_ref = e["t"]
            break
    if rec_kmh is not None:
        over = [m["speed_kmh"] - rec_kmh for m in metrics
                if m["speed_kmh"] is not None and (t_ref is None or (m["t"] or 0) >= t_ref)]
        over = [o for o in over if o > 0]
        overshoot = max(over) if over else 0.0
    else:
        _warn("Overshoot: payload.recommended_kmh 없음 → NaN (권고속도 미주입; C1 이벤트엔 정상)")

    # ── Recovery time: 시나리오별 hazard-onset → 신호 정착(지속유지) ──
    t_trig, trig_name = _trigger_event_time(events, scenario)
    if t_trig is None:
        _warn("Recovery time: hazard-onset 이벤트 없음 → NaN (트리거 미발행)")
        return overshoot, recovery

    scn = (scenario or "").upper()
    if scn == "C2":
        # yaw rate 정착: 직진 복귀(center=0), 밴드=YAW_SETTLE_BAND. 미분 아님(직접 필드)이라 t축은 t(정렬용).
        samples = [(m["t"], abs(m["yaw_rate"])) for m in metrics
                   if m["t"] is not None and m["yaw_rate"] is not None]
        if not samples:
            _warn("Recovery time(C2): yaw_rate 필드 없음 → NaN")
            return overshoot, recovery
        rec, ok = _settling_time(samples, t_trig, center=0.0,
                                 band=YAW_SETTLE_BAND_RAD_S, dwell=SETTLE_DWELL_S)
        if ok:
            recovery = rec
        else:
            _warn(f"Recovery time(C2 yaw): 트리거('{trig_name}') 후 yaw 정착(밴드±{YAW_SETTLE_BAND_RAD_S}"
                  f"/{SETTLE_DWELL_S}s 유지) 미관측 → NaN")
    else:
        # C1(또는 미지정): 속도 정착(baseline ±10% 유지)
        speeds = [(m["t"], m["speed_kmh"]) for m in metrics
                  if m["t"] is not None and m["speed_kmh"] is not None]
        pre = [v for t, v in speeds if t < t_trig]
        baseline = (sum(pre) / len(pre)) if pre else rec_kmh
        if baseline is None:
            _warn("Recovery time(C1 speed): baseline 속도 산정 불가 → NaN")
            return overshoot, recovery
        band = SPEED_RECOVER_BAND_FRAC * baseline
        rec, ok = _settling_time(speeds, t_trig, center=baseline,
                                 band=band, dwell=SETTLE_DWELL_S)
        if ok:
            recovery = rec
        else:
            _warn(f"Recovery time(C1 speed): 트리거('{trig_name}') 후 baseline±10%"
                  f"/{SETTLE_DWELL_S}s 유지 복귀 미관측 → NaN")

    return overshoot, recovery


def metric_lane_departure(metrics):
    """차선 이탈 거리(m): |lane_offset_m| 최대. 없으면 NaN+경고."""
    vals = [abs(m["lane_offset_m"]) for m in metrics if m["lane_offset_m"] is not None]
    if not vals:
        _warn("차선 이탈 거리: lane_offset_m 필드 없음 → NaN (차선 오프셋 로깅 미구현)")
        return NAN
    return max(vals)


def metric_success_fail(metrics, events):
    """C1 성공/실패율 보조(시도당). gap_attempt vs cleared 이벤트로 추정.
       이벤트 없으면 NaN. (성공률 = cleared / gap_attempt)"""
    attempts = sum(1 for e in events if (e.get("event") or "") == "gap_attempt")
    cleared = sum(1 for e in events if (e.get("event") or "") == "cleared")
    if attempts == 0:
        _warn("성공/실패율(C1): gap_attempt/cleared 이벤트 없음 → NaN")
        return NAN, attempts, cleared
    return cleared / attempts, attempts, cleared


# ──────────────────────────────────────────────────────────────────────────
# 4. 오케스트레이션
# ──────────────────────────────────────────────────────────────────────────
def compute_metrics(rows, scenario, session_id_arg=None):
    metrics, events, session_id = extract_series(rows, scenario)
    if scenario:
        # scenario 인자로 이벤트 필터(로그상 scenario 라벨이 있을 때만 의미 있음)
        labeled = [e for e in events if e.get("scenario")]
        if labeled:
            events = [e for e in labeled
                      if (e.get("scenario") or "").lower() in
                      (scenario.lower(), _scenario_alias(scenario))]

    n_metric = len(metrics)
    if n_metric == 0:
        _warn("world_metric/위치 프레임 0건 → 모든 시계열 지표 NaN")

    rtf = real_time_factor(metrics)                       # sim/wall 비율(슬로모 진단)
    slowmo = (rtf is not None and rtf < SLOWMO_THR)

    overshoot, recovery = metric_overshoot_recovery(metrics, events, scenario)
    succ, attempts, cleared = metric_success_fail(metrics, events)

    out = {
        "session_id": session_id_arg or session_id or "UNKNOWN",
        "scenario": scenario or "UNSPEC",
        "n_metric_frames": n_metric,
        "n_events": len(events),
        "real_time_factor": (round(rtf, 4) if rtf is not None else NAN),
        "slowmo_flag": bool(slowmo),     # 미분지표 시간축 슬로모 경고 플래그(G0-4)
        # 6지표 (analysis_plan §2.6)
        "min_ttc_s": metric_min_ttc(metrics),
        "max_jerk_m_s3": metric_max_jerk(metrics),
        "max_yaw_rate_rad_s": metric_max_yaw_rate(metrics),
        "max_lat_accel_m_s2": metric_max_lat_accel(metrics),
        "brake_response_delay_s": metric_brake_response_delay(metrics, events, scenario),
        "overshoot_kmh": overshoot,
        "recovery_time_s": recovery,
        "lane_departure_m": metric_lane_departure(metrics),
        # C1 보조
        "c1_success_rate": succ,
        "c1_gap_attempts": attempts,
        "c1_cleared": cleared,
    }
    return out, list(WARN)


def _scenario_alias(scn):
    """C1/C2 ↔ 로그상 scenario 문자열 매핑(analysis_plan: C1=roundabout, C2=aquaplaning)."""
    a = {"c1": "roundabout", "c2": "aquaplaning"}
    return a.get(scn.lower(), scn.lower())


# 시나리오별 강조 지표(출력 구분용) — analysis_plan §2.6
EMPHASIS = {
    "C1": ["recovery_time_s", "c1_success_rate", "brake_response_delay_s"],
    "C2": ["max_yaw_rate_rad_s", "max_lat_accel_m_s2"],
}


def print_report(result, warnings, scenario):
    print("=" * 64)
    print(f"[분석도구] scenarioQA — 시나리오 정량 6지표 (analysis_plan §2.6)")
    print(f"  session_id : {result['session_id']}")
    print(f"  scenario   : {result['scenario']}  "
          f"(metric frames={result['n_metric_frames']}, events={result['n_events']})")
    rtf = result.get("real_time_factor", NAN)
    rtf_s = "N/A" if (isinstance(rtf, float) and math.isnan(rtf)) else f"{rtf:.3f}x"
    flag = "  ⚠SLOW-MO(미분지표 슬로모 구간)" if result.get("slowmo_flag") else ""
    print(f"  sim-time   : real-time factor={rtf_s}  (미분지표 시간축=t_sim){flag}")
    print("-" * 64)
    label = {
        "min_ttc_s": "최소 TTC (s)",
        "max_jerk_m_s3": "최대 Jerk (m/s³)",
        "max_yaw_rate_rad_s": "최대 Yaw rate (rad/s)",
        "max_lat_accel_m_s2": "최대 lateral accel (m/s²)",
        "brake_response_delay_s": "Brake Response Delay (s)",
        "overshoot_kmh": "Overshoot (km/h)",
        "recovery_time_s": "Recovery time (s)",
        "lane_departure_m": "차선 이탈 거리 (m)",
        "c1_success_rate": "C1 성공률",
    }
    emph = set(EMPHASIS.get((scenario or "").upper(), []))
    for k, lab in label.items():
        v = result.get(k, NAN)
        mark = "  ★강조" if k in emph else ""
        vs = "NaN" if (isinstance(v, float) and math.isnan(v)) else f"{v:.4g}"
        print(f"  {lab:<26} : {vs}{mark}")
    print("-" * 64)
    if warnings:
        print("  ⚠ 경고/미구현 필드:")
        for w in warnings:
            print(f"    - {w}")
    else:
        print("  (경고 없음 — 모든 필드 존재)")
    print("=" * 64)


def write_csv(result, warnings, out_path):
    cols = [
        "session_id", "scenario", "n_metric_frames", "n_events",
        "real_time_factor", "slowmo_flag",
        "min_ttc_s", "max_jerk_m_s3", "max_yaw_rate_rad_s", "max_lat_accel_m_s2",
        "brake_response_delay_s", "overshoot_kmh", "recovery_time_s",
        "lane_departure_m", "c1_success_rate", "c1_gap_attempts", "c1_cleared",
        "n_warnings",
    ]
    row = {c: result.get(c, "") for c in cols}
    row["n_warnings"] = len(warnings)
    # NaN은 빈칸으로(분석 도구에서 결측으로 읽히게)
    for c in cols:
        v = row[c]
        if isinstance(v, float) and math.isnan(v):
            row[c] = ""
    exists = os.path.exists(out_path)
    with open(out_path, "a", newline="", encoding="utf-8") as f:
        w = _csv.DictWriter(f, fieldnames=cols)
        if not exists:
            w.writeheader()
        w.writerow(row)
    print(f"[분석도구] CSV 1행 append → {out_path}")


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="[분석도구] WS JSONL 세션 로그 → 시나리오 정량 6지표 (결정론, 시드 불필요)")
    ap.add_argument("--input", required=True, help="WS JSONL 세션 로그 경로(NDJSON)")
    ap.add_argument("--scenario", choices=["C1", "C2"], default=None,
                    help="시나리오 라벨(강조 지표·이벤트 필터). C1=답답/roundabout, C2=불안/aquaplaning")
    ap.add_argument("--out", default=None, help="CSV 누적 출력 경로(미지정 시 stdout만)")
    ap.add_argument("--session-id", default=None,
                    help="세션 식별자 강제 지정(로그에 session_id 없을 때). 개인식별정보 금지")
    args = ap.parse_args(argv)

    if not os.path.exists(args.input):
        print(f"[오류] 입력 파일 없음: {args.input}", file=sys.stderr)
        return 2

    rows = load_jsonl(args.input)
    if not rows:
        print("[오류] 유효한 JSONL 메시지가 없습니다.", file=sys.stderr)
        return 3

    result, warnings = compute_metrics(rows, args.scenario, args.session_id)
    print_report(result, warnings, args.scenario)
    if args.out:
        write_csv(result, warnings, args.out)
    # 기계 판독용 dict도 stdout(JSON) 마지막 줄로
    print(json.dumps({"metrics": result, "warnings": warnings}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
