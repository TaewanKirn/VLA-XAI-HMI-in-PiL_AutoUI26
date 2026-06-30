#!/usr/bin/env python3
# tools/test_scenarioQA.py
# [SYNTHETIC / LOGIC-TEST] scenarioQA.py 의 세 지표(최대 yaw rate · brake response delay ·
#   overshoot/recovery) 로직을 **합성(가짜) 입력**으로 검증한다.
#   ⚠ 여기서 만드는 프레임은 실제 CARLA 캡처가 아니라 **손으로 만든 검증 픽스처**다.
#     출력 수치는 '로직이 맞는지'만 증명하며, 원고/결과에 실측치로 쓰면 안 된다([SIMULATED]).
#   실제 6지표 수치는 Windows CARLA 캡처(JSONL)를 scenarioQA.py 로 처리해야 산출된다.
#
# 실행: python3 test_scenarioQA.py   (CARLA·numpy 불필요, 표준 라이브러리만)

import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scenarioQA as Q


def _wm(t, **kw):
    """world_metric 합성 프레임. t_sim=t_bus=t 로 둬 real-time factor=1(슬로모 없음)."""
    base = {"type": "world_metric", "session_id": "SYN_TEST", "t_sim": t, "t_bus": t, "t": t}
    base.update(kw)
    return base


def _ev(t, event, scenario, **payload):
    return {"type": "scenario_event", "session_id": "SYN_TEST", "t_sim": t, "t_bus": t,
            "scenario": scenario, "event": event, "payload": payload}


def build_c2_rows():
    """C2(수막) 합성: puddle_enter@1.0 / 진짜 yaw 피크 1.5 / 임펄스 아티팩트 6.0(게이트 제거 대상)
       / brake>0.1 첫 시점 1.3 / yaw 정착 3.0부터 2s 유지."""
    rows = []
    # pre-trigger 직진(0.0~0.9): yaw~0, speed 78, brake 0
    t = 0.0
    while t < 0.95:
        rows.append(_wm(round(t, 2), speed_kmh=78.0, yaw_rate=0.0, brake=0.0, lat_accel=0.5))
        t += 0.1
    rows.append(_ev(1.0, "puddle_enter", "aquaplaning", recommended_kmh=40, current_kmh=78))
    # 교란 구간 1.0~2.9: yaw 요동 + 임펄스 아티팩트 + 제동
    disturb = {
        1.0: (0.8, 0.0), 1.1: (1.2, 0.05), 1.2: (1.5, 0.05),   # 진짜 피크 1.5
        1.3: (1.3, 0.30),                                       # brake>0.1 첫 시점
        1.4: (1.0, 0.40), 1.5: (6.0, 0.40),                    # 6.0 = 접촉 임펄스(게이트 제거)
        1.6: (0.9, 0.30), 1.8: (0.6, 0.20), 2.0: (0.4, 0.10),
        2.3: (0.25, 0.05), 2.6: (0.15, 0.0), 2.9: (0.12, 0.0),
    }
    for tt in sorted(disturb):
        yr, br = disturb[tt]
        rows.append(_wm(tt, speed_kmh=60.0, yaw_rate=yr, brake=br, lat_accel=2.0))
    # 정착 구간 3.0~5.5: yaw 0.02 (<0.10) 지속 유지 → 정착시간 = 3.0-1.0 = 2.0s
    t = 3.0
    while t <= 5.55:
        rows.append(_wm(round(t, 2), speed_kmh=42.0, yaw_rate=0.02, brake=0.0, lat_accel=0.3))
        t += 0.1
    return rows


def build_c1_rows():
    """C1(교착) 합성: drive_start@0.1(=구버전이 잘못 쓰던 미끼) / 진짜 트리거
       junction_deadlock_start@5.0 / brake>0.1 첫 시점 5.4(→delay 0.4, 구버전이면 5.3)
       / gap_attempt×2·cleared×1(성공률 0.5) / 속도 baseline 20, 8.0부터 복귀 유지."""
    rows = []
    rows.append(_ev(0.1, "drive_start", "roundabout", current_kmh=0))
    # pre-trigger 정상주행 0.2~4.9: speed 20, brake 0
    t = 0.2
    while t < 4.95:
        rows.append(_wm(round(t, 2), speed_kmh=20.0, yaw_rate=0.1, brake=0.0))
        t += 0.2
    rows.append(_ev(2.0, "gap_attempt", "roundabout", attempt_n=1, current_kmh=6))
    rows.append(_ev(3.0, "gap_attempt", "roundabout", attempt_n=2, current_kmh=5))
    rows.append(_ev(5.0, "junction_deadlock_start", "roundabout", lap=1, current_kmh=0))
    # 교착 후 5.0~7.9: 감속·정지, brake>0.1 첫 시점 5.4
    dec = {5.0: (10.0, 0.0), 5.2: (5.0, 0.05), 5.4: (2.0, 0.30),
           5.6: (0.0, 0.50), 6.0: (0.0, 0.50), 7.0: (8.0, 0.10), 7.6: (15.0, 0.0)}
    for tt in sorted(dec):
        sp, br = dec[tt]
        rows.append(_wm(tt, speed_kmh=sp, yaw_rate=0.1, brake=br))
    # 속도 복귀 8.0~11: 20 km/h(baseline ±10% 내) 지속 → recovery = 8.0-5.0 = 3.0s
    t = 8.0
    while t <= 11.05:
        rows.append(_wm(round(t, 2), speed_kmh=20.0, yaw_rate=0.1, brake=0.0))
        t += 0.2
    rows.append(_ev(11.2, "cleared", "roundabout", current_kmh=20))
    return rows


def approx(a, b, tol=1e-6):
    return (a is not None) and (not (isinstance(a, float) and math.isnan(a))) and abs(a - b) <= tol


def run():
    fails = []

    # ── C2 ──
    Q.WARN.clear()
    res, warn = Q.compute_metrics(build_c2_rows(), "C2", "SYN_C2")
    print("=== [SYNTHETIC] C2 ===")
    for k in ("max_yaw_rate_rad_s", "brake_response_delay_s", "overshoot_kmh", "recovery_time_s"):
        print(f"  {k} = {res[k]}")
    # 기대: yaw 게이트로 6.0 제거 → 1.5 ; brake delay 1.3-1.0=0.3 ;
    #       overshoot = max(post-trigger speed 60) - recommended 40 = 20.0 ; recovery 2.0
    if not approx(res["max_yaw_rate_rad_s"], 1.5, 1e-6):
        fails.append(f"C2 max_yaw_rate: got {res['max_yaw_rate_rad_s']} expected 1.5 (6.0 게이트 제거)")
    if not approx(res["brake_response_delay_s"], 0.3, 1e-6):
        fails.append(f"C2 brake_delay: got {res['brake_response_delay_s']} expected 0.3")
    if not approx(res["overshoot_kmh"], 20.0, 1e-6):
        fails.append(f"C2 overshoot: got {res['overshoot_kmh']} expected 20.0")
    if not approx(res["recovery_time_s"], 2.0, 1e-6):
        fails.append(f"C2 recovery: got {res['recovery_time_s']} expected 2.0")
    assert any("물리한도" in w for w in warn), "C2: yaw 게이트 경고가 있어야 함"

    # ── C1 ── 핵심: brake delay 가 deadlock(5.0) 기준 0.4 여야 함(drive_start 0.1 기준이면 5.3 = 구버전 버그)
    Q.WARN.clear()
    res, warn = Q.compute_metrics(build_c1_rows(), "C1", "SYN_C1")
    print("=== [SYNTHETIC] C1 ===")
    for k in ("brake_response_delay_s", "recovery_time_s", "c1_success_rate"):
        print(f"  {k} = {res[k]}")
    if not approx(res["brake_response_delay_s"], 0.4, 1e-6):
        fails.append(f"C1 brake_delay: got {res['brake_response_delay_s']} expected 0.4 "
                     f"(deadlock 기준; 5.3 이면 drive_start 미끼 버그 미수정)")
    if not approx(res["recovery_time_s"], 3.0, 1e-6):
        fails.append(f"C1 recovery: got {res['recovery_time_s']} expected 3.0")
    if not approx(res["c1_success_rate"], 0.5, 1e-6):
        fails.append(f"C1 success_rate: got {res['c1_success_rate']} expected 0.5")

    # ── 회귀 가드: scenario 미지정 시 brake delay 가 첫 이벤트(drive_start) 폴백 + warn ──
    Q.WARN.clear()
    res_ns, warn_ns = Q.compute_metrics(build_c1_rows(), None, "SYN_NS")
    # 미지정이면 drive_start(0.1) 기준 → 5.4-0.1=5.3 (의도된 폴백; warn 으로 경고)
    if not approx(res_ns["brake_response_delay_s"], 5.3, 1e-6):
        fails.append(f"NS fallback: got {res_ns['brake_response_delay_s']} expected 5.3 (폴백 동작 확인)")
    assert any("미지정" in w for w in warn_ns), "미지정 폴백 warn 이 있어야 함"

    print("\n" + ("FAIL:\n  " + "\n  ".join(fails) if fails else "ALL PASS (로직 검증 — 합성 입력)"))
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(run())
