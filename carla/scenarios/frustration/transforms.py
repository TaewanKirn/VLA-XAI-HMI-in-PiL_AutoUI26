# ⛔ DEPRECATED (2026-06-18) — 사용 안 함(import 안 됨·깨짐). 수정해도 반영 안 됨.
#   정본 = data-server/processing/transforms_A.py (SCENARIO env 디스패처가 processing/ 정본만 로드).
#   이 파일은 디스패처 도입 전 옛 per-시나리오 사본 — 같은 폴더에 transforms_A 가 없어 import 시 깨진다.
#   튜닝은 정본에서 할 것. 아래는 이력 참고용으로만 보존.
"""
시나리오 A 전용 변환 모듈 — CARLA 원본 데이터 → 6DOF 모션 명령값.

키 1 → 시나리오 A (답답함 / Frustration)

기본 사용:
    import transforms_A as transforms

    transforms.reset_state()                       # 실험 시작 시 (현재 A는 무상태)
    raw = transforms.transform_motion(accel, rot)  # speed 불필요

참조 : HIL_simulator_specification.pdf  /  신효진 (2021) 홍익대 석사논문 Table 1

──────────────────────────────────────────────────────────────────────────────
튜닝 이력:
v1  SCALE_SURGE=0.3  SCALE_SWAY=0.8  SCALE_HEAVE=0.5
v2  SCALE_SURGE 0.55  SCALE_SWAY 0.20  SCALE_HEAVE 0.35  SWAY_DEADZONE 신규
v3  SCALE_PITCH 1.0→0.0  (CARLA rot[pitch] 미러링 제거 → 반복 앞뒤 기울어짐 제거)
    SCALE_SURGE 0.55→0.75  (정지-출발 체감 +36%, d_surge 최대 180mm)
v4  월드→차체 좌표 변환 신규 (좌/우회전 시 surge↔sway 뒤섞임 해소)
    CARLA get_acceleration()은 월드 좌표 → yaw로 회전시켜 전방/우측 축에 사영
v5  멀미 저감 튜닝: 전 축 진폭 하향 (회전·앞차 간격유지 시 과한 움직임 완화)
    SCALE_SURGE 0.75→0.45  SCALE_SWAY 0.20→0.15  SCALE_HEAVE 0.35→0.18
    SCALE_ROLL 1.0→0.45 (도로 뱅킹 1:1 미러링 → 경사 진입 시 급격한 기울어짐 완화)
    SCALE_YAW 0.3→0.22  TILT_FACTOR 1.0→0.6
v6  멀미 저감 2차: 기울기 각도 추가 하향 + 하드 캡 강화
    SCALE_SURGE 0.45→0.35  SCALE_SWAY 0.15→0.12  SCALE_HEAVE 0.18→0.12
    SCALE_ROLL 0.45→0.30  SCALE_YAW 0.22→0.18  TILT_FACTOR 0.6→0.4
    PITCH_LIMIT / ROLL_LIMIT 5.6→4.0 (최대 기울기 각도 하드 캡)
v7  앞뒤 기울기(피치) 확 축소: 회전교차로 정지-출발 반복이 급정거/급가속처럼 느껴짐.
    피치는 전적으로 틸트 코디네이션(long_acc 기반)에서 나오므로:
    TILT_FACTOR 0.4→0.18  PITCH_LIMIT 4.0→2.0 (피치 응답·캡 동시 강하향)
v8  피치 ±0.2° 하드 캡: 평소 0.07°에서 0.7°로 급튀어 각도 급변 체감.
    PITCH_LIMIT 2.0→0.2 (튐 진폭 자체를 차단)
v9  피치 변화 폭 ±0.1 (스윙 ≈ 0.2): ±0.2 캡이면 최대-최소 0.4 라 움직임이 너무 큼.
    PITCH_LIMIT 0.2→0.1.  부드러움(변화 속도)은 filters.py v8 에서 함께 처리.
v10 회전교차로 surge 절제: 종방향(앞뒤) 진폭이 과해 "덜컹/놀이기구" 느낌 →
    SCALE_SURGE 0.35→0.25 (범위 ~29% 축소). filters MAX_LEAD_DELTA surge 도 함께 하향.
v11 복잡 트래픽(차량↑·동선↑) 후 회전교차로 진동 제거 — "회전=기울기" 자연화:
    (1) ⭐ yaw 절대-헤딩 추종 폐기 → yaw-RATE 큐(B/processing v12 방식).
        기존 yaw=rot["yaw"]*SCALE_YAW 는 로터리에서 헤딩이 계속 회전+±180° wrap →
        플랫폼 yaw가 rate한계(2.5°/s)에 막혀 톱니처럼 갈림(="덜덜덜/롤러코스터").
        → 헤딩 변화율(deg/s)에 비례한 유한 큐로 교체(YAW_RATE_GAIN/LIMIT, wrap 처리).
    (2) 회전 lean 추가: 횡가속→roll(ROLL_COORD_GAIN). "도는데 기울기가 안 변함" 해소.
    (3) heave 롤러코스터 수직 진동 차단: SCALE_HEAVE 0.12→0.06 + HEAVE_DEADZONE 신규.
    (4) 우회전 좌우 진동: SWAY_DEADZONE 0.5→0.9 (jerky 조향 잡음 게이트).
    (5) 정거시 앞뒤 기울기 급변 완화: TILT_FACTOR 0.18→0.12 + LONG_TILT_DEADZONE 신규
        (미세 감속/크립 잡음엔 피치 0). 스파이크 자체는 filters v11 LEAD_K 하향이 담당.
    상태화: set_dt/reset_state 가 yaw-rate 용 _dt/_prev_yaw 관리(무상태→경상태).
v12 라이드(놀이기구)·지연 저감 — 진동은 줄었으나 "움직임 범위가 너무 넓다" 피드백.
    실차 로그 분석:
    · surge 가 항속 중 ±0.5~1.3 계속 출렁 + 정거시 −2~−4 스파이크 → 종방향 과대(주범).
    · heave 가 항상 ≈−0.56 상수: (accel_z−GRAVITY) 가 CARLA 운동가속도(정지 시 z≈0,
      중력 미포함)와 안 맞아 −9.8 이 상시 빠짐. + turn_scale(정지1.0↔회전0.45)이 곱해져
      회전 진입 시 −0.56→−0.25 로 떠오름 = "회전 시 롤러코스터 상승" 가짜 수직.
    조치 (회전 큐 roll/yaw 는 유지 — surge 가 줄어 상대적으로 또렷해짐):
    (1) SCALE_SURGE 0.25→0.12 + SURGE_DEADZONE(항속 미세 가감속 차단, 실제 제동/발진만)
        + SURGE_CAP(정거 급제동 스파이크를 ±0.7 로 하드클램프). 종방향 진폭·범위 대폭↓
        → 라이드감·이동거리(=지연) 동시 완화.
    (2) heave: GRAVITY 빼기 폐기 → 평탄로 heave≈0 (상수 바이어스·turn_scale 흔들림 제거).
v13 전 축 피크 1/3 축소 — "회전 움직임은 OK인데 축 값이 휙휙 너무 크다"(멀미·지연).
    실차 로그 피크 분석: Yaw ±1.5(raw 3.0 캡)·Roll ±1.0·Sway ±0.6·Surge ±0.57.
    급선회 진입 때 yaw-rate + roll-lean 이 동시에 튀는 게 "휙휙"의 정체.
    각 축 진폭·하드캡을 ~1/3 로 낮춰 피크를 목표(Yaw 0.5·Roll 0.33·Sway 0.2·Surge 0.19)로:
      YAW_RATE_GAIN 0.06→0.02, YAW_RATE_LIMIT 3.0→1.0
      SCALE_ROLL 0.30→0.10, ROLL_COORD_GAIN 0.40→0.13, ROLL_LIMIT 4.0→0.8
      SCALE_SWAY 0.12→0.04 / SCALE_SURGE 0.12→0.04, SURGE_CAP 0.7→0.23
      TILT_FACTOR 0.12→0.04, PITCH_LIMIT 0.1→0.04
    velocity_limiter(rate)는 유지 — 진폭↓로 이동거리 짧아져 지연도 함께↓. udp_sender turn_scale(×0.45)은 그대로 위에 곱해짐.
v14 좌회전·우회전 피크 ~1/2 축소 — 실측 피크 Roll ±0.54·Yaw ±0.62·Sway ±0.19 체감 과도.
    (raw 기준: Roll 0.76 ≈ ROLL_LIMIT, Yaw 0.95 ≈ YAW_RATE_LIMIT 거의 풀히트)
    → 목표 Roll ±0.27·Yaw ±0.31·Sway ±0.10 (각 ~1/2):
      YAW_RATE_GAIN 0.02→0.01, YAW_RATE_LIMIT 1.0→0.5
      SCALE_ROLL 0.10→0.05, ROLL_COORD_GAIN 0.13→0.06, ROLL_LIMIT 0.8→0.4
      SCALE_SWAY 0.04→0.02. filters v11 과 한 쌍. ← 미적용(코드 v13 그대로); v15 로 대체.
v15 선회 축 ~1/3 감소 ("왼쪽 꺾임 조금 큼") — v13 기준 ×2/3 (좌/우 대칭 하향):
      YAW_RATE_GAIN 0.02→0.013, YAW_RATE_LIMIT 1.0→0.67
      SCALE_ROLL 0.10→0.067, ROLL_COORD_GAIN 0.13→0.087, ROLL_LIMIT 0.8→0.53
      SCALE_SWAY 0.04→0.027.
v16 앞차 추종(찔끔 제동) 피치 쏠림 차단 — "앞으로 쏵 쏠렸다 돌아오는" 멀미 원인 제거:
    LONG_TILT_DEADZONE 0.6→1.5  (찔끔 제동 0.6~1.5 m/s² 피치 완전 차단; 실제 강제동만 통과)
    TILT_FACTOR 0.04→0.02, PITCH_LIMIT 0.04→0.02  (피치 진폭 절반 — 어차피 찔끔엔 0)
    잔진동은 filters v11 에서 함께 처리.
v17 피치 틸트 완전 제거 + surge 피크 추가 클램프 — "아직도 어지러움":
    TILT_FACTOR 0.02→0.0  (피치 쏠림 완전 차단 — 제동 피치 감각 포기, 멀미 우선)
    SURGE_CAP 0.23→0.08   (급제동 surge 피크 절반 이하 클램프)
v20 정거·로터리 재가속 피치 감각 복원 — "3초 브레이크 쏠림 + 뗐다 밟는 느낌":
    TILT_FACTOR 0.0→0.015  (피치 틸트 재활성화 — 작은 값으로 멀미 없이)
    LONG_TILT_DEADZONE 1.5→0.8  (일반 제동(≥0.8 m/s²) 통과; 찔끔 조향은 차단)
    PITCH_LIMIT 0.02→0.05  (틸트 목표값 상한 — velocity 제한으로 3초 걸려 도달)
    filters VELOCITY_LIMITS["pitch"] 0.4→0.017 과 한 쌍: 느린 틸트가 3초 브레이크 감각.
    로터리 재가속: 가속 시 tilt_input>0 → pitch 음수(뒤로 눕는 느낌) → 재제동 시 양수 복귀.
v19 정차/출발 surge 잔움직임 완전 제거:
    SURGE_DEADZONE 1.5→2.5  (일반 도심 정차 완전 무반응; 급제동만 통과)
    SURGE_CAP 0.08→0.04     (피크 추가 감소)
v18 "360도 왔다갔다" 회전감·우회전 찔끔찔끔 완전 해소 — 전 축 미세동작 억제:
    ⭐ YAW_RATE_DEADZONE 신규(5.0 deg/s): 소폭 헤딩 변화엔 yaw=0, 큰 회전만 반응
    YAW_RATE_GAIN 0.013→0.003, YAW_RATE_LIMIT 0.67→0.1  (yaw 큐 극소화)
    ROLL_COORD_GAIN 0.087→0.02, ROLL_LIMIT 0.53→0.15, SCALE_ROLL 0.067→0.02  (roll 극소화)
    SWAY_DEADZONE 0.9→2.0  (우회전 찔끔찔끔 게이트 대폭 강화)
    SCALE_SWAY 0.027→0.01, SCALE_HEAVE 0.06→0.02  (전 축 진폭 최소화)
    filters v13 과 한 쌍.
"""

import math

# ═════════════════════════════════════════════════════════════════════════════
# 공통 상수
# ═════════════════════════════════════════════════════════════════════════════
GRAVITY     = 9.81
PITCH_LIMIT = 0.05  # deg  (v20: 0.02→0.05  3초 브레이크 쏠림 감각 허용 상한)
ROLL_LIMIT  = 0.15  # deg  (v18: 0.53→0.15  roll 하드캡 극소화)

# ═════════════════════════════════════════════════════════════════════════════
# 시나리오 A 파라미터  (답답함)
# ═════════════════════════════════════════════════════════════════════════════
SCALE_SURGE   = 0.04    # v13: 0.12→0.04  피크 ±0.57→±0.19 (1/3)
SCALE_SWAY    = 0.01    # v18: 0.027→0.01  우회전 진폭 극소화
SCALE_HEAVE   = 0.02    # v18: 0.06→0.02  수직 잔진동 극소화
SCALE_ROLL    = 0.02    # v18: 0.067→0.02  roll 극소화
SCALE_PITCH   = 0.0     # v3: 1.0→0.0  rot[pitch] 미러링 제거 (반복 앞뒤 기울어짐 원인)
                        #   제동·가속 pitch 감각은 틸트 코디네이션(long_acc 기반) 단독 담당
SWAY_DEADZONE = 2.0     # m/s²  v18: 0.9→2.0  우회전 찔끔찔끔 완전 차단 (강한 횡가속만 통과)
SURGE_DEADZONE = 2.5    # m/s²  v19: 1.5→2.5  정차/출발 잔움직임 완전 차단 (급제동만 통과)
SURGE_CAP     = 0.04    # deg(=출력단위)  v19: 0.08→0.04  피크 추가 감소
HEAVE_DEADZONE = 0.3    # m/s²  v12: 0.4→0.3  (GRAVITY 제거 후 평탄로 z≈0 잡음만 게이트, 실제 요철 통과)
TILT_FACTOR   = 0.015   # v20: 0.0→0.015  피치 틸트 재활성화 (3초 브레이크 쏠림; filters velocity 0.017 이 속도 제어)
LONG_TILT_DEADZONE = 0.8  # m/s²  v20: 1.5→0.8  일반 제동(≥0.8) 통과; 찔끔 조향 잡음 차단

# ── 회전(yaw) = 헤딩 변화율 큐 (v11) ─────────────────────────────────
# 절대 헤딩 추종(rot["yaw"]*SCALE_YAW) 폐기: 로터리에서 헤딩이 계속 돌고 ±180° wrap →
# 플랫폼 yaw가 rate한계에 막혀 톱니/덜덜덜. 대신 "얼마나 빨리 도는지"(deg/s)에 비례한
# 유한·부드러운 큐만 준다. wrap 처리 포함, 정상 직진(헤딩 거의 불변)에선 yaw≈0.
YAW_RATE_GAIN  = 0.003   # v18: 0.013→0.003  yaw 극소화 (360도 회전감 제거)
YAW_RATE_LIMIT = 0.1     # deg  v18: 0.67→0.1  yaw 하드캡 극소화
YAW_RATE_DEADZONE = 5.0  # deg/s  v18 신규: 소폭 헤딩 변화(직진 잡음·찔끔 조향) 완전 차단

# ── 회전 lean: 횡가속 → roll 코디네이션 (v11) ────────────────────────
ROLL_COORD_GAIN = 0.02   # v18: 0.087→0.02  roll lean 극소화


# ═════════════════════════════════════════════════════════════════════════════
# 내부 상태 (v11: yaw-rate 큐용 — set_dt/reset_state 로 관리)
# ═════════════════════════════════════════════════════════════════════════════
_dt        = 1.0 / 25    # 틱 간격 [s] (udp_sender 가 set_dt 로 설정; 미호출 시 25Hz 가정)
_prev_yaw  = 0.0         # 직전 틱 헤딩 [deg]
_yaw_init  = False       # 첫 틱 패스스루 (헤딩 변화율 0 으로 시작 — 시작 스파이크 방지)


# ═════════════════════════════════════════════════════════════════════════════
# 공용 유틸
# ═════════════════════════════════════════════════════════════════════════════

def _clamp(value, limit):
    return max(-limit, min(value, limit))


def _deadzone(value, threshold):
    """소프트 데드존: |v|≤th → 0, 초과분은 연속성 유지."""
    if abs(value) <= threshold:
        return 0.0
    return value - math.copysign(threshold, value)


def _wrap180(angle):
    """각도 차이를 -180..180 으로 정규화 (헤딩 ±180° wrap 처리)."""
    return (angle + 180.0) % 360.0 - 180.0


def set_dt(dt):
    """틱 간격 설정 (yaw-rate 계산용). udp_sender 가 시작 시 1회 호출."""
    global _dt
    if dt and dt > 0:
        _dt = dt


def reset_state():
    """yaw-rate 상태 초기화. 실험 재시작 시 호출 (udp_sender 모듈 로드 시 자동)."""
    global _prev_yaw, _yaw_init
    _prev_yaw = 0.0
    _yaw_init = False


# ═════════════════════════════════════════════════════════════════════════════
# 시나리오 A : 스케일링 + Sway 데드존 + Pitch 틸트
# ═════════════════════════════════════════════════════════════════════════════

def transform_motion(accel, rot):
    """
    Parameters
    ----------
    accel : dict  {"x","y","z"}  [m/s²]  — CARLA 월드 좌표 가속도
    rot   : dict  {"roll","pitch","yaw"}  [deg]

    Returns
    -------
    dict  {"surge","sway","heave","roll","pitch","yaw"}
    """
    global _prev_yaw, _yaw_init

    # ── 월드 → 차체 좌표 변환 (yaw 회전) ──────────────────────────
    # CARLA get_acceleration()은 월드 좌표계. 차가 회전하면 월드 X/Y가
    # 전후/좌우와 어긋나므로 yaw로 회전시켜 차체축(전방/우측)에 사영한다.
    # forward = (cos y, sin y), right = (-sin y, cos y)  (CARLA 좌수계, Z up)
    yaw_rad = math.radians(rot["yaw"])
    cos_y, sin_y = math.cos(yaw_rad), math.sin(yaw_rad)
    long_acc =  accel["x"] * cos_y + accel["y"] * sin_y   # 전방(+) 가속도
    lat_acc  = -accel["x"] * sin_y + accel["y"] * cos_y   # 우측(+) 가속도

    sway_input  = _deadzone(lat_acc, SWAY_DEADZONE)            # 좌우 진동 잡음 게이트
    surge_input = _deadzone(long_acc, SURGE_DEADZONE)          # 항속 미세 가감속 차단(실제 제동/발진만)
    heave_input = _deadzone(accel["z"], HEAVE_DEADZONE)        # v12: GRAVITY 제거 — 평탄로 z≈0 → heave≈0
    tilt_input  = _deadzone(long_acc, LONG_TILT_DEADZONE)      # 미세 감속엔 피치 0

    surge = _clamp(surge_input * SCALE_SURGE, SURGE_CAP)       # 정거 급제동 스파이크 하드클램프
    sway  = sway_input  * SCALE_SWAY
    heave = heave_input * SCALE_HEAVE

    # ── yaw = 헤딩 변화율(rate) 큐 (v11) ─────────────────────────
    # 절대 헤딩 추종을 폐기. 로터리 연속회전·±180° wrap 에서 톱니 진동나던 원인 제거.
    # "얼마나 빨리 도는지"에 비례한 유한 큐만 출력 → 정상 직진에선 yaw≈0.
    if not _yaw_init:
        _prev_yaw = rot["yaw"]
        _yaw_init = True
        yaw_rate = 0.0
    else:
        yaw_rate  = _wrap180(rot["yaw"] - _prev_yaw) / _dt    # deg/s
        _prev_yaw = rot["yaw"]
    yaw_rate_dz = _deadzone(yaw_rate, YAW_RATE_DEADZONE)   # v18: 소폭 헤딩 잡음 차단
    yaw = _clamp(yaw_rate_dz * YAW_RATE_GAIN, YAW_RATE_LIMIT)

    # ── roll = 도로 뱅킹 + 회전 lean(횡가속 코디네이션) (v11) ─────
    # 도는데 기울기가 안 변하던 문제 → 코너 횡가속에 비례한 부드러운 banking 추가.
    roll  = rot["roll"] * SCALE_ROLL
    roll += ROLL_COORD_GAIN * sway_input                      # 회전 lean (부호 반대면 GAIN 반전)

    # ── pitch = 틸트 코디네이션 (감속 시 제동 관성 체감) ─────────
    pitch = rot["pitch"] * SCALE_PITCH
    pitch += -TILT_FACTOR * tilt_input                        # 데드존 통과한 실제 제동만

    pitch = _clamp(pitch, PITCH_LIMIT)
    roll  = _clamp(roll,  ROLL_LIMIT)

    return {"surge": surge, "sway": sway, "heave": heave,
            "roll":  roll,  "pitch": pitch, "yaw":  yaw}
