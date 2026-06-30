# ⛔ DEPRECATED (2026-06-18) — 사용 안 함(import 안 됨·깨짐). 수정해도 반영 안 됨.
#   정본 = data-server/processing/filters_B.py (SCENARIO env 디스패처가 processing/ 정본만 로드).
#   이 파일은 디스패처 도입 전 옛 per-시나리오 사본 — 같은 폴더에 filters_B 가 없어 import 시 깨진다.
#   튜닝은 정본에서 할 것. 아래는 이력 참고용으로만 보존.
"""
시나리오 B 전용 필터 모듈 — ema(α=0.15 정상 / 0.05 이벤트).

키 2 → B 파이프라인

기본 사용:
    import filters_B as filters
    import transforms_B as transforms

    filters.reset_filter()
    prev_limited = {k: 0.0 for k in ("surge","sway","heave","roll","pitch","yaw")}

    smoothed = filters.apply(raw, is_event=transforms.is_event_active())
    safe     = filters.velocity_limiter(smoothed, prev_limited, dt)
    prev_limited = safe

참조 : HIL_simulator_specification.pdf  /  신효진 (2021) 홍익대 석사논문 Table 1

──────────────────────────────────────────────────────────────────────────────
파라미터:
ALPHA_NORMAL=0.15 (낙차 극대화), ALPHA_EVENT=0.05 (먹통·무중력 질감)
"""

# ═════════════════════════════════════════════════════════════════════════════
# 공통
# ═════════════════════════════════════════════════════════════════════════════
_KEYS = ("surge", "sway", "heave", "roll", "pitch", "yaw")

# 각도 축 전용 속도 한계 (deg/s) — velocity_limiter 적용 대상
# ─ 단위 일치: transforms 출력 [deg]  vs  deg/s × dt [deg/tick]  ✓
# ─ 병진 축(surge/sway/heave) 제외: m/s²×scale 단위로 mm/s 기준과 불일치
VELOCITY_LIMITS = {
    "roll":  7.0,   # deg/s
    "pitch": 0.35,  # deg/s  v22: 0.6→0.35  내리막 피치가 아직도 급격하다는 피드백 →
                    #        0.3deg 범위를 ~0.85s 에 걸쳐 이동 → 더 천천히·완만하게
                    #        (v18: 1.5→0.6, 0.3deg 범위를 ~0.5s 에 걸쳐 이동)
    "yaw":  13.4,   # deg/s
}

# ═════════════════════════════════════════════════════════════════════════════
# 시나리오 B 파라미터
# ═════════════════════════════════════════════════════════════════════════════
ALPHA_NORMAL = 0.15       # 정상 구간 (기본 반응)
ALPHA_EVENT  = 0.85       # v25: 0.6→0.85  40Hz 틱에서 11~14Hz "덜덜덜" 떨림을 통과시킴.
                          #       40Hz(dt=0.025)에선 EMA 시정수가 짧아져 α 0.6 이면 고주파를
                          #       크게 깎음 → α↑ 로 빠른 좌우 떨림이 살아남게. (감쇠↓)
                          #       병진(heave/sway) 진동만 영향 — 회전축은 별도 클램프로 컴포트 유지.

# ═════════════════════════════════════════════════════════════════════════════
# 필터 상태
# ═════════════════════════════════════════════════════════════════════════════
_prev_ema = {k: 0.0 for k in _KEYS}
_ema_init = False   # 첫 프레임 패스스루 제어 (α=0.05 시 1.5초간 0 출력 방지)


# ═════════════════════════════════════════════════════════════════════════════
# 리셋
# ═════════════════════════════════════════════════════════════════════════════

def reset_filter():
    """필터 상태 초기화. 실험 시작 시 호출."""
    global _prev_ema, _ema_init
    _prev_ema = {k: 0.0 for k in _KEYS}
    _ema_init = False


def reset_all():
    """
    transforms_B + filters_B 통합 초기화.
    실험 재시작 시 이것 하나만 호출하면 됨.
    """
    import transforms_B as _tr
    _tr.reset_state()
    reset_filter()


# ═════════════════════════════════════════════════════════════════════════════
# 메인 파이프라인 (EMA only — 이벤트별 α)
# ═════════════════════════════════════════════════════════════════════════════

def apply(raw, is_event=False):
    """
    B 필터 파이프라인.

    Parameters
    ----------
    raw      : dict  transform_motion() 출력값
    is_event : bool  transforms_B.is_event_active() 값을 그대로 전달 권장.
                     True 시 α=0.05 (먹통 질감), False 시 α=0.15 (정상)

    Returns
    -------
    dict  필터링된 6DOF 값 (velocity_limiter 입력)
    """
    global _prev_ema, _ema_init

    # 첫 프레임 패스스루 — α=0.05 (이벤트) 에서 _prev_ema=0 으로 시작 시
    # 초기 1~2초간 출력이 거의 0 으로 보이는 문제 방지.
    if not _ema_init:
        _prev_ema = dict(raw)
        _ema_init = True
        return dict(raw)

    alpha    = ALPHA_EVENT if is_event else ALPHA_NORMAL
    filtered = {}
    for key in raw:
        filtered[key] = alpha * raw[key] + (1.0 - alpha) * _prev_ema[key]
    _prev_ema = filtered
    return filtered


# ═════════════════════════════════════════════════════════════════════════════
# velocity limiter (각도 축 전용)
# ═════════════════════════════════════════════════════════════════════════════

def velocity_limiter(current, previous, dt):
    """
    각도 축(roll/pitch/yaw) 속도 한계 초과 방지 (논문 Table 1 기준).

    병진 축(surge/sway/heave): transforms 출력 단위(m/s²×scale)가 mm/s 기준과
    불일치하여 패스스루. B 의 병진 급변 보호는 SWAY_SIGNAL_CAP·HEAVE_SIGNAL_CAP
    (transforms_B 내부) 가 담당.
    """
    limited = dict(current)               # 병진 축 패스스루
    for key in VELOCITY_LIMITS:           # 각도 축만 클램프
        delta     = current[key] - previous[key]
        max_delta = VELOCITY_LIMITS[key] * dt
        limited[key] = previous[key] + max(-max_delta, min(delta, max_delta))
    return limited


# ═════════════════════════════════════════════════════════════════════════════
# 권장 메인 파이프라인 (제어 루프에 복사해서 사용)
# ═════════════════════════════════════════════════════════════════════════════
#
#   import transforms_B as transforms
#   import filters_B    as filters
#
#   dt = 1 / 25
#   transforms.set_dt(dt)
#   filters.reset_all()
#   prev_limited = {k: 0.0 for k in ("surge","sway","heave","roll","pitch","yaw")}
#
#   while True:
#       accel, rot = receive_from_carla()
#       speed      = get_carla_speed()
#
#       raw      = transforms.transform_motion(accel, rot, speed)
#       smoothed = filters.apply(raw, is_event=transforms.is_event_active())
#       safe     = filters.velocity_limiter(smoothed, prev_limited, dt)
#       send_to_platform(safe)
#       prev_limited = safe
