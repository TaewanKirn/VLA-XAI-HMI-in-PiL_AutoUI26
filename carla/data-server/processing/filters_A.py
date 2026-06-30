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
v10 커브길 "급격한 흔들림 → 부드러운 움직임" — 축별 평활 분리(ALPHA_AXIS/LEAD_K_AXIS).
    커브에서만 움직이는 sway/roll/yaw 를 강평활(α=0.22) + lead 오버슈트 제거(K=0).
    직선 정지-출발 응답(surge/heave/pitch)은 그대로 → 시나리오 '답답함' 핵심 유지.
    직선에선 횡/회전 축 ≈0 이라 부작용 없음 (커브 감지 불필요).
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
    # v12: sway 제거 — rate clamp 가 좌우를 늦춰 딜레이 유발(200ms). 좌우 크기는
    #      SCALE_SWAY(0.07)+EMA 로 제어하고, 변화율 제한은 걸지 않아 즉답성 회복.
    "roll":  2.0,   # deg/s  (v12: 1.0→2.0  과한 제한이 roll 400ms 딜레이 유발 → 완화)
    "pitch": 0.8,   # deg/s  (v8: 3.5→0.8  좁은 ±0.1 캡을 ~0.25s 에 걸쳐 부드럽게)
    "yaw":   3.0,   # deg/s  (v12: 1.5→3.0  yaw 가 이제 유한 회전율 cue → 한계 풀어 즉답)
    "surge": 2.5,   # v23d: surge 변화율 제한 신규 — 정차/발진 시 platform 이 확 lurch 하지 않게
                    #   (TM 급제동의 surge 스파이크를 ~0.4s 에 걸쳐 램프 → '꿀렁' 완화). 단위 m/s²/s.
}

# ═════════════════════════════════════════════════════════════════════════════
# 시나리오 A 파라미터
# ═════════════════════════════════════════════════════════════════════════════
ALPHA          = 0.35     # v19: 0.45→0.35  EMA 평활 강화 (등속주행 꿀렁 억제, 리그 #1)
LEAD_K         = 0.4      # v19: 1.2→0.4  lead 오버슈트 대폭↓ — 미세 변화 증폭(꿀렁)의 핵심 제거

# v10: 커브길 "급격한 흔들림 → 부드러운 움직임" — 축별 평활 분리.
#   커브에서만 움직이는 횡/회전 축(sway/roll/yaw)을 강하게 평활하고,
#   직선 정지-출발 응답 축(surge/heave/pitch)은 그대로 유지(시나리오 '답답함' 핵심).
#   직선에선 sway/roll/yaw ≈ 0 → 부작용 없음. 커브에서만 부드러워짐(감지 불필요).
ALPHA_AXIS = {            # 축별 EMA α (미지정 축은 ALPHA 사용)
    "sway": 0.35, "roll": 0.35, "yaw": 0.35,   # v12: 0.16→0.35  과평활이 딜레이(τ0.26s) 주범
                                               #      → α↑ 로 지연 ~3배 감소(τ≈0.093s). 크기는 SCALE 로 제어.
    "surge": 0.22,                             # v23b: 정차·앞차간격 조정 시 '노젓기'(전후 꿀렁) 완화 —
                                               #   surge EMA 강화(0.35→0.22)로 stop-go 진동 부드럽게.
}
LEAD_K_AXIS = {           # 축별 lead 게인 (미지정 축은 LEAD_K). lead 오버슈트 = 급격한 흔들림 주범.
    "sway": 0.0, "roll": 0.0, "yaw": 0.0,      # 커브 축: 오버슈트 제거 → 흔들림 부드럽게
    "surge": 0.0,                              # v23b: surge lead 오버슈트 제거 → 정차 시 앞으로 튕김·노젓기 억제
}

MAX_LEAD_DELTA = {        # 1틱 허용 최대 delta (CARLA 물리 아티팩트 + 스파이크 클램프)
    # v8: 각도 축 오버슈트를 작은 캡에 비례하게 강하향 — lead 스파이크(확 꺾임) 주범 제거.
    #     (예: pitch 캡 ±0.1 인데 오버슈트 0.7 이면 캡의 7배가 더해져 튐)
    "surge": 0.5, "sway": 0.4, "heave": 0.4,   # v8: 병진 축도 절반 (확 멈춤 surge 완화)
    "roll":  0.1, "pitch": 0.03, "yaw":  0.1,   # v8: roll 0.7→0.1, pitch 0.7→0.03, yaw 0.6→0.1
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
        k = LEAD_K_AXIS.get(key, LEAD_K)          # v10: 커브 축은 lead 0 (오버슈트 제거)
        led[key] = values[key] + k * delta

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
        a = ALPHA_AXIS.get(key, ALPHA)            # v10: 커브 축(sway/roll/yaw)은 강평활
        filtered[key] = a * values[key] + (1.0 - a) * _prev_ema[key]
    _prev_ema = filtered
    return filtered


# ═════════════════════════════════════════════════════════════════════════════
# velocity limiter (각도 축 전용)
# ═════════════════════════════════════════════════════════════════════════════

def velocity_limiter(current, previous, dt):
    """
    각도 축(roll/pitch/yaw) 속도 한계 초과 방지 (논문 Table 1 기준).

    병진 축 중 surge/heave 는 패스스루(MAX_LEAD_DELTA 가 급변 보호).
    v11: sway 는 VELOCITY_LIMITS 에 추가되어 여기서 rate clamp 됨 (커브 좌우 속도 제한).
    """
    limited = dict(current)               # surge/heave 패스스루
    for key in VELOCITY_LIMITS:           # 각도 축 + sway 클램프
        delta     = current[key] - previous[key]
        max_delta = VELOCITY_LIMITS[key] * dt
        limited[key] = previous[key] + max(-max_delta, min(delta, max_delta))
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
