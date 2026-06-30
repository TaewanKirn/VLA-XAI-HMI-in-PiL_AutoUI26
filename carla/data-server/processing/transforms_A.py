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
v14 정상주행 baseline 을 시나리오 B(C2) 와 통일 — 두 시나리오의 '평소 주행' 체감을
    같게(실험 대조 일관성), 정상 구간에선 주행에 신경 쓰지 않도록.
    SCALE_SURGE 0.18→0.3 · SCALE_SWAY 0.04→0.3 · SCALE_HEAVE 0.06→0.3  (= B 정상값)
    ROLL_LIMIT 4.0→1.5 (B와 동일 — '바이킹/비행기' 기울임 차단).
    ※ 유지(C1 고유·B보다 정확): 차체좌표 투영 · yaw-rate cue · sway 데드존 ·
       tilt 코디네이션 · SCALE_PITCH=0 / PITCH_LIMIT 0.1 (v9 — stop-go 피치 튐 방지).
v15 리그 체험 피드백(#2·#3) — 정상주행 앞뒤(surge/pitch) 과함 + 피치 방향 반대.
    (1) SCALE_SURGE 0.3→0.15 — 정지/발진·항속 앞뒤 진폭 감쇠 (좌우 sway 는 OK라 유지).
    (2) SURGE_DEADZONE 0.8 신규 — 항속 미세 가감속(노젓기) 차단, 실제 제동·발진만 통과.
    (3) 피치 틸트 부호 교정: pitch += -TILT*long_acc → +TILT*surge_input.
        표준 모션큐잉상 제동(감속)=코 다운(앞으로 쏠림)이 정답인데 이전이 반대였음.
"""

import math

# ═════════════════════════════════════════════════════════════════════════════
# 공통 상수
# ═════════════════════════════════════════════════════════════════════════════
GRAVITY     = 9.81
PITCH_LIMIT = 0.1   # deg  (v9: 0.2→0.1  변화 폭(최대-최소) ≈ 0.2 로 — 0.4 스윙이 너무 컸음)
ROLL_LIMIT  = 1.5   # deg  v14: 4.0→1.5 (B와 통일 — '바이킹/비행기' 기울임 차단)

# ═════════════════════════════════════════════════════════════════════════════
# 시나리오 A 파라미터  (답답함)
# ═════════════════════════════════════════════════════════════════════════════
# v14(정상 baseline = 시나리오 B 통일): C1·C2 평소 주행 체감을 같게 →
#   실험 대조 일관성 + 정상 구간엔 주행에 신경 쓰지 않도록. (B normal: surge/sway/heave 0.3)
#   회전교차로(C1)는 코너링이 잦아 같은 스케일에도 sway 체감이 B(고속도로)보다 큼 →
#   실차 검증 후 과하면 SCALE_SWAY 만 하향. 단, sway 데드존·차체좌표 투영은 유지.
SCALE_SURGE   = 0.12    # v23d: 0.15→0.12  정차 시 '겁나 꿀렁'(전후 lurch) 추가 감쇠(리그)
SCALE_SWAY    = 0.3     # v14: 0.04→0.3  B 정상값과 통일 (좌우는 리그 OK #1). 데드존·차체좌표 투영 유지
SCALE_HEAVE   = 0.3     # v14: 0.06→0.3  B 정상값과 통일
SCALE_ROLL    = 0.15    # v18: 0.10→0.15 커브 뱅킹 상향 (회전감 '죽은 느낌' 보완, 리그 #2)
SCALE_PITCH   = 0.0     # rot[pitch] 미러링 제거 유지 (피치는 TILT 로만)
YAW_RATE_GAIN = 2.5     # v18: 1.5→2.5 커브 회전감 상향 (리그 #2 — 회전 물리값 너무 죽음)
YAW_LIMIT     = 8.0     # v18: 5→8  yaw cue 캡 상향 (커브에서 더 살아있게)
SWAY_DEADZONE  = 0.1    # v20: 0.3→0.1  '완전 죽음'→'아주 조금' 살림 (리그 #1). lead 낮아 꿀렁 안 됨
SURGE_DEADZONE = 0.1    # v20: 0.4→0.1  등속에서도 미세하게 살아있게 (값 정말 조금만)
TILT_FACTOR   = 0.0     # v16: 0.10→0 가감속 시 불필요한 앞뒤 '기울임' 제거(리그 피드백).
                        #   전후 cue 는 surge(병진)만으로 — 피치 틸트(회전) 안 씀.

# ─────────────────────────────────────────────────────────────────────────────
# 답답함 이벤트 (frustration) — 회전교차로 WAITING(막힘) 중 '가다-서다' 반복 jerk.
#   막혀서 못 나가는 답답함을 longitudinal(전후) 반복 lurch 로 표현(특정 물리값 반복).
#   scenario main.py 가 WAITING 진입 시 trigger_event(), 벗어날 때 stop_event().
# ─────────────────────────────────────────────────────────────────────────────
# v17(리그 피드백): 정지한 차에 합성 lurch 주입 = 시각(정지)–전정(흔들림) 불일치 → 멀미·위화감.
#   → 이벤트 모션 제거(진폭 0). 답답함은 상황(대기·정체·못 나감)으로만 유발.
#   단 is_event_active()/트리거/마커·로그는 유지 — '답답함 구간' 타임라인 표시·분석용.
FRUST_SURGE_A = 0.0     # v17: 2.2→0  정지 중 플랫폼 모션 제거
FRUST_FREQ    = 0.9     # (진폭 0 이라 미사용)
FRUST_HEAVE_A = 0.0     # v17: 0.5→0  수직 충격도 제거


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


# v12: yaw 회전율 계산용 직전 헤딩
_prev_heading = None

# 답답함 이벤트 상태 (v13)
_dt          = 1.0 / 20
_event_on    = False
_event_clock = 0.0
_event_dur   = None      # None = stop_event() 호출까지 지속


def reset_state():
    """직전 헤딩 + 이벤트 상태 초기화. 실험 시작 시 호출."""
    global _prev_heading, _event_on, _event_clock, _event_dur
    _prev_heading = None
    _event_on = False
    _event_clock = 0.0
    _event_dur = None


def set_dt(dt):
    """이벤트 신호 시간축 틱 간격 설정. 시작 시 1회."""
    global _dt
    _dt = dt


def is_event_active():
    """직전 transform_motion 시점 이벤트 활성 여부 (udp_sender 필터·플래그용)."""
    return _event_on


def trigger_event(duration=None):
    """답답함 이벤트 시작 (가다-서다 반복 lurch). duration=None 이면 stop_event() 까지 지속."""
    global _event_on, _event_clock, _event_dur
    _event_on = True
    _event_clock = 0.0
    _event_dur = duration


def stop_event():
    """답답함 이벤트 종료 (WAITING 벗어날 때)."""
    global _event_on
    _event_on = False


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
    # ── 월드 → 차체 좌표 변환 (yaw 회전) ──────────────────────────
    # CARLA get_acceleration()은 월드 좌표계. 차가 회전하면 월드 X/Y가
    # 전후/좌우와 어긋나므로 yaw로 회전시켜 차체축(전방/우측)에 사영한다.
    # forward = (cos y, sin y), right = (-sin y, cos y)  (CARLA 좌수계, Z up)
    yaw_rad = math.radians(rot["yaw"])
    cos_y, sin_y = math.cos(yaw_rad), math.sin(yaw_rad)
    long_acc =  accel["x"] * cos_y + accel["y"] * sin_y   # 전방(+) 가속도
    lat_acc  = -accel["x"] * sin_y + accel["y"] * cos_y   # 우측(+) 가속도

    sway_input  = _deadzone(lat_acc,  SWAY_DEADZONE)
    surge_input = _deadzone(long_acc, SURGE_DEADZONE)   # v15: 항속 미세 가감속(노젓기) 차단

    surge = surge_input * SCALE_SURGE
    sway  = sway_input  * SCALE_SWAY
    heave = (accel["z"] - GRAVITY) * SCALE_HEAVE
    roll  = rot["roll"]  * SCALE_ROLL
    pitch = rot["pitch"] * SCALE_PITCH

    # v12: yaw = 회전율(헤딩 변화량) 기반 유한 cue (절대 헤딩 추종 폐기).
    #   ±180° wrap 처리 → 누적·튐 없음. 도는 동안만 일정 yaw, 직진 시 0.
    global _prev_heading
    heading = rot["yaw"]
    if _prev_heading is None:
        _prev_heading = heading
    dh = heading - _prev_heading
    if   dh >  180.0: dh -= 360.0
    elif dh < -180.0: dh += 360.0
    _prev_heading = heading
    yaw = _clamp(dh * YAW_RATE_GAIN, YAW_LIMIT)

    # 틸트 코디네이션: 감속(제동) → 코 다운(앞으로 쏠림). v15: 부호 교정(이전이 반대).
    #   노젓기 차단 위해 데드존 통과분(surge_input)만 사용 → 항속 중엔 0.
    pitch += TILT_FACTOR * surge_input

    pitch = _clamp(pitch, PITCH_LIMIT)
    roll  = _clamp(roll,  ROLL_LIMIT)

    # ── 답답함 이벤트 주입: 가다-서다 반복 lurch (전후 surge + 멈춤 시 'kung') ──
    global _event_on, _event_clock
    if _event_on:
        te = _event_clock
        ph = 2.0 * math.pi * FRUST_FREQ * te
        surge += FRUST_SURGE_A * math.sin(ph)               # 전후 반복 lurch
        heave += FRUST_HEAVE_A * max(0.0, -math.cos(ph))    # lurch 끝(멈춤)에서 수직 충격
        _event_clock += _dt
        if _event_dur is not None and _event_clock >= _event_dur:
            _event_on = False

    return {"surge": surge, "sway": sway, "heave": heave,
            "roll":  roll,  "pitch": pitch, "yaw":  yaw}
