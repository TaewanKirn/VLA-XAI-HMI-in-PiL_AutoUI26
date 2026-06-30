# ⛔ DEPRECATED (2026-06-18) — 사용 안 함(import 안 됨·깨짐). 수정해도 반영 안 됨.
#   정본 = data-server/processing/filters_A.py (SCENARIO env 디스패처가 processing/ 정본만 로드).
#   이 파일은 디스패처 도입 전 옛 per-시나리오 사본 — 같은 폴더에 filters_A 가 없어 import 시 깨진다.
#   튜닝은 정본에서 할 것. 아래는 이력 참고용으로만 보존.
"""
시나리오 A 전용 필터 모듈 — lead → ema(α=0.60).

키 1 → A 파이프라인

기본 사용:
    import filters_A as filters

    filters.reset_filter()
    prev_limited = {k: 0.0 for k in ("surge","sway","heave","roll","pitch","yaw")}

    smoothed = filters.apply(raw)
    safe     = filters.velocity_limiter(smoothed, prev_limited, dt)
    prev_limited = safe

참조 : HIL_simulator_specification.pdf  /  신효진 (2021) 홍익대 석사논문 Table 1

──────────────────────────────────────────────────────────────────────────────
튜닝 이력:
v1  ALPHA=0.20
v2  ALPHA=0.35 (정지-출발 체감 강화)
v3  lead_filter 신규 LEAD_K=2.0, ALPHA=0.60 (0.2초 지연 보정)
v4  MAX_LEAD_DELTA + _lead_initialized (스파이크·시작 쏠림 방지)
v5  velocity_limiter 각도 축 전용 분리 (병진 축 단위 불일치 해소)
    _ema_init 신규: EMA 첫 프레임 패스스루 (비정지 시작 40% 감쇠 방지)
v6  멀미 저감 튜닝:
    LEAD_K 2.0→1.2 (lead 오버슈트 완화 — 회전·간격유지 시 튀는 값 주범)
    MAX_LEAD_DELTA 전 축 하향 (1틱 스파이크 강하게 클램프)
    VELOCITY_LIMITS 하향 (각도 급변 → 완만한 기울임으로, '갑자기 기울어짐' 방지)
v7  멀미 저감 2차: 기울기 변화 속도 추가 하향 + 각도 축 스파이크 클램프 강화
    VELOCITY_LIMITS roll 4→3, pitch 5→3.5, yaw 8→6
    MAX_LEAD_DELTA roll/pitch 1.0→0.7, yaw 0.8→0.6, surge 1.2→1.0
v8  부드러움(smoothness) 패스 — "확확 꺾임" 제거. 작아진 캡(pitch ±0.1)에 비해
    변화 속도·lead 오버슈트가 과도해 스파이크 발생하던 것을 캡에 비례하게 하향:
    VELOCITY_LIMITS roll 3→1.5, pitch 3.5→0.8, yaw 6→2.5 (각도 변화 속도 완만)
    MAX_LEAD_DELTA  roll 0.7→0.1, pitch 0.7→0.03, yaw 0.6→0.1, 병진 축 절반
    ALPHA 0.60→0.45 (EMA 평활 강화)
v9  회전교차로 surge 절제: MAX_LEAD_DELTA surge 0.5→0.3 (틱당 surge lead 오버슈트
    범위 축소 — 종방향 튐 완화). transforms v10 SCALE_SURGE 0.35→0.25 와 한 쌍.
v10 복잡 트래픽(차량↑·동선↑) → 신호 jerky/stop-go 증가. 그 잡음을 lead 필터가
    증폭해 "덜덜덜" 진동 + 정거시 피치 스파이크 유발. 동시에 각도축 rate한계가
    빡빡해 회전 큐가 굼떠 "지연" 체감. 두 문제를 함께 해소:
    (1) ⭐ LEAD_K 1.2→0.4  — 위상선행이 매 틱 delta(=고주파 잡음)를 증폭하던 것을
        강하향. 광대역 진동·정지 스파이크의 主 원인 제거. (지연 약간↑은 아래로 보상.)
    (2) VELOCITY_LIMITS roll 1.5→3.5, yaw 2.5→4.0  — 회전 큐(roll lean·yaw-rate)는
        저주파라 rate를 풀어도 잡음 안 늘고 응답만 빨라짐 → 회전 "지연" 해소.
        pitch 0.8 유지(정거시 급변 방지 — 피치만 느리게).
    (3) ALPHA 0.45→0.50  — LEAD_K 하향으로 늘어난 지연을 소폭 보상(평활은 데드존+
        LEAD_K 가 이미 담당하므로 EMA를 살짝 가볍게). transforms v11 과 한 쌍.
v11 앞차 추종 잔진동·잔움직임 제거 — transforms v16 과 한 쌍:
    LEAD_K 0.4→0.15  — delta×gain 이 고주파 잡음을 플랫폼에 그대로 전달하던 것을 추가 억제.
    ALPHA 0.50→0.40  — EMA 평활 강화 (고주파 잔진동 추가 필터링; 지연 증가 감수).
    MAX_LEAD_DELTA surge 0.3→0.15, pitch 0.03→0.015  — 틱당 스파이크 추가 클램프.
    VELOCITY_LIMITS pitch 0.8→0.4  — 피치 변화 속도 절반 (복귀 진동 완화).
v12 잔진동 완전 제거 — "아직도 어지러움":
    LEAD_K 0.15→0.0  — lead 필터 비활성화 (잡음 증폭 원인 완전 제거; 위상선행 포기).
    ALPHA 0.40→0.25  — EMA 최대 평활 (고주파 잔진동 완전 억제).
v13 "360도 회전감·급격함" 해소 — transforms v18 과 한 쌍:
    VELOCITY_LIMITS roll 3.5→0.5, yaw 4.0→0.5  — 변화 속도를 크게 낮춰 급격한 기울어짐 제거.
    ALPHA 0.25→0.20  — EMA 추가 평활.
v14 정차/출발 surge 잔움직임 추가 억제 — transforms v19 과 한 쌍:
    VELOCITY_LIMITS "surge" 신규(0.3): surge 변화 속도 제한 — 즉각 반응 대신 천천히 변화.
v15 전 축 절대값 하드캡 — 실측 피크의 1/3 (멀미 우선):
    실측 피크: Surge 0.19, Sway 0.27, Roll 0.42, Pitch 0.04, Yaw 0.56
    OUTPUT_LIMITS = 각 1/3: Surge 0.06, Sway 0.09, Roll 0.14, Pitch 0.01, Yaw 0.19
    velocity_limiter 마지막에 적용 — 호출부 수정 불필요.
v16 정거·로터리 재가속 피치 감각 — transforms v20 과 한 쌍:
    VELOCITY_LIMITS pitch 0.4→0.017 deg/s  "3초 브레이크 쏠림" 핵심:
      최대 피치 0.05° ÷ 0.017 deg/s = 2.94초 — 제동 시 천천히 앞으로 쏠림.
      로터리 재가속 시 pitch 반전 → 복귀 → 재상승 자연스럽게 발생.
    OUTPUT_LIMITS pitch 0.01→0.05  (PITCH_LIMIT 0.05 와 일치; 실제 감각 허용).
"""

# ═════════════════════════════════════════════════════════════════════════════
# 공통
# ═════════════════════════════════════════════════════════════════════════════
_KEYS = ("surge", "sway", "heave", "roll", "pitch", "yaw")

# 각도 축 전용 속도 한계 (deg/s) — velocity_limiter 적용 대상
# ─ 단위 일치: transforms 출력 [deg]  vs  deg/s × dt [deg/tick]  ✓
# ─ 병진 축(surge/sway/heave) 제외 이유:
#     transforms 출력이 m/s² × scale 계열이고 mm/s 기반 한계와 차원 불일치
#     → 실질 트리거 거의 없어 의미 없음. 병진 급변 보호는 MAX_LEAD_DELTA 담당.
VELOCITY_LIMITS = {
    "surge": 0.3,   # unit/s  v14 신규: 정차/출발 surge 즉각 반응 차단 (천천히 변하게)
    "roll":  0.5,   # deg/s  (v13: 3.5→0.5  느리고 부드러운 기울어짐 — 급격한 lean 제거)
    "pitch": 0.017, # deg/s  (v16: 0.4→0.017  3초 브레이크 쏠림: 0.05°÷0.017=2.94초)
    "yaw":   0.5,   # deg/s  (v13: 4.0→0.5  느리고 부드러운 yaw — 360도 회전감 제거)
}

# ── 최종 절대값 하드캡 (v15) ─────────────────────────────────────────
# 실측 피크의 1/3 — velocity_limiter 마지막에 적용, 파이프라인 최후 방어선.
# 이 값을 초과하는 값은 어떤 경로로도 플랫폼에 전달되지 않음.
OUTPUT_LIMITS = {
    "surge": 0.06,
    "sway":  0.09,
    "heave": 0.01,
    "roll":  0.14,
    "pitch": 0.05,  # v16: 0.01→0.05  3초 브레이크 쏠림 감각 허용 (PITCH_LIMIT 0.05 와 일치)
    "yaw":   0.19,
}

# ═════════════════════════════════════════════════════════════════════════════
# 시나리오 A 파라미터
# ═════════════════════════════════════════════════════════════════════════════
ALPHA          = 0.20     # v13: 0.25→0.20  EMA 추가 평활
LEAD_K         = 0.0      # v12: 0.15→0.0  lead 필터 비활성화 — 잡음 증폭 완전 제거
MAX_LEAD_DELTA = {        # 1틱 허용 최대 delta (CARLA 물리 아티팩트 + 스파이크 클램프)
    # v8: 각도 축 오버슈트를 작은 캡에 비례하게 강하향 — lead 스파이크(확 꺾임) 주범 제거.
    #     (예: pitch 캡 ±0.1 인데 오버슈트 0.7 이면 캡의 7배가 더해져 튐)
    "surge": 0.15, "sway": 0.4, "heave": 0.4,   # v11: surge 0.3→0.15 (찔끔 제동 종방향 스파이크 추가 클램프)
    "roll":  0.1, "pitch": 0.015, "yaw":  0.1,  # v11: pitch 0.03→0.015 (피치 틱당 스파이크 추가 클램프)
}

# ═════════════════════════════════════════════════════════════════════════════
# 필터 상태
# ═════════════════════════════════════════════════════════════════════════════
_prev_raw  = {k: 0.0 for k in _KEYS}
_prev_ema  = {k: 0.0 for k in _KEYS}
_lead_init = False
_ema_init  = False   # v5: EMA 첫 프레임 패스스루 제어용


# ═════════════════════════════════════════════════════════════════════════════
# 리셋
# ═════════════════════════════════════════════════════════════════════════════

def reset_filter():
    """필터 상태 초기화. 실험 시작 시 호출."""
    global _prev_raw, _prev_ema, _lead_init, _ema_init
    _prev_raw  = {k: 0.0 for k in _KEYS}
    _prev_ema  = {k: 0.0 for k in _KEYS}
    _lead_init = False
    _ema_init  = False


def reset_all():
    """
    transforms_A + filters_A 통합 초기화.
    실험 재시작 시 이것 하나만 호출하면 됨.
    """
    import transforms_A as _tr
    _tr.reset_state()
    reset_filter()


# ═════════════════════════════════════════════════════════════════════════════
# 메인 파이프라인 (lead → ema)
# ═════════════════════════════════════════════════════════════════════════════

def apply(raw):
    """
    A 필터 파이프라인.

    Parameters
    ----------
    raw : dict  transform_motion() 출력값

    Returns
    -------
    dict  필터링된 6DOF 값 (velocity_limiter 입력)
    """
    led = _lead_filter(raw)
    return _ema_filter(led)


# ─────────────────────────────────────────────────────────────────────────────
# Lead + EMA
# ─────────────────────────────────────────────────────────────────────────────

def _lead_filter(values):
    """위상 선행 + 스파이크 방지."""
    global _prev_raw, _lead_init

    # 첫 프레임: 실값으로 prev 초기화 후 패스스루
    if not _lead_init:
        _prev_raw  = dict(values)
        _lead_init = True
        return dict(values)

    led = {}
    for key in values:
        delta = values[key] - _prev_raw[key]
        limit = MAX_LEAD_DELTA[key]
        delta = max(-limit, min(delta, limit))    # 물리 아티팩트 클램프
        led[key] = values[key] + LEAD_K * delta

    _prev_raw = dict(values)
    return led


def _ema_filter(values):
    """EMA (고정 α=0.60).

    v5: 첫 프레임 패스스루 추가.
    비정지 상태에서 시작해도 0.6×raw 감쇠 없이 실값 그대로 출력.
    """
    global _prev_ema, _ema_init
    if not _ema_init:
        _prev_ema = dict(values)
        _ema_init = True
        return dict(values)   # 패스스루

    filtered = {}
    for key in values:
        filtered[key] = ALPHA * values[key] + (1.0 - ALPHA) * _prev_ema[key]
    _prev_ema = filtered
    return filtered


# ═════════════════════════════════════════════════════════════════════════════
# velocity limiter (각도 축 전용)
# ═════════════════════════════════════════════════════════════════════════════

def velocity_limiter(current, previous, dt):
    """
    각도 축(roll/pitch/yaw) 속도 한계 초과 방지 (논문 Table 1 기준).

    병진 축(surge/sway/heave): transforms 출력 단위(m/s²×scale)가 mm/s 기준과
    불일치하여 패스스루. 병진 급변 보호는 MAX_LEAD_DELTA 가 담당.
    """
    limited = dict(current)
    for key in VELOCITY_LIMITS:
        delta     = current[key] - previous[key]
        max_delta = VELOCITY_LIMITS[key] * dt
        limited[key] = previous[key] + max(-max_delta, min(delta, max_delta))
    # v15: 전 축 절대값 하드캡 — 파이프라인 최후 방어선
    for key, cap in OUTPUT_LIMITS.items():
        limited[key] = max(-cap, min(limited[key], cap))
    return limited


# ═════════════════════════════════════════════════════════════════════════════
# 권장 메인 파이프라인 (제어 루프에 복사해서 사용)
# ═════════════════════════════════════════════════════════════════════════════
#
#   import transforms_A as transforms
#   import filters_A    as filters
#
#   dt = 1 / 25
#   transforms.set_dt(dt) if hasattr(transforms, "set_dt") else None  # A는 무상태
#   filters.reset_all()
#   prev_limited = {k: 0.0 for k in ("surge","sway","heave","roll","pitch","yaw")}
#
#   while True:
#       accel, rot = receive_from_carla()
#
#       raw      = transforms.transform_motion(accel, rot)
#       smoothed = filters.apply(raw)
#       safe     = filters.velocity_limiter(smoothed, prev_limited, dt)
#       send_to_platform(safe)
#       prev_limited = safe
