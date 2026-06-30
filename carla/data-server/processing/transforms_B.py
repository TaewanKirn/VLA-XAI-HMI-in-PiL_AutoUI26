"""
시나리오 B 전용 변환 모듈 — CARLA 원본 데이터 → 6DOF 모션 명령값.

키 2 → 시나리오 B (불안함·수막현상 / Aquaplaning)

기본 사용:
    import transforms_B as transforms

    transforms.set_dt(1/25)                            # 1회 설정 (t_local 계산용)
    transforms.reset_state()                           # 실험 시작 시
    raw = transforms.transform_motion(accel, rot, speed)

참조 : HIL_simulator_specification.pdf  /  신효진 (2021) 홍익대 석사논문 Table 1

──────────────────────────────────────────────────────────────────────────────
튜닝 이력:
v1  정상/이벤트 분기, surge/sway 0.1 event, yaw 1.2, Heave_float sin 합성
v2  좌우 진동(SWAY/ROLL 감쇠 사인파) 합성 + 안전 클램핑 추가
v3  B_SWAY_SIGNAL_CAP 신규: 이벤트 sway(CARLA+진동 합산) 안전 상한 클램프
v4  케이스 셀렉터 신규 (CASE 1~4) — 물웅덩이 깊이별 부력/진동 강도 자동 전환
    기준: 현대 쏘나타 DN8(타이어 225/45R18, D=660mm), 강수량 50mm/h
    Case 1 기본값 — 1/2 잠김(330mm): Heave=1.0 / Sway=1.75 / Roll=2.0
v5  LAT_GAIN 신규 — 이벤트 EMA(α=0.05)가 1.43Hz 진동을 27%만 통과시키는 문제
    보정용 사전 증폭 게인. 기본 1.5 (체감 ~40%). 흔들림 더 원하면 2.0~3.0.
v6  WHEEL_SPIN 신규 — 바퀴 헛도는 채터링 감각 추가
    수막 → 종방향 접지 상실 → 가속 입력과 차체 응답 분리 + 미세 떨림
    Surge: 3.3Hz 종방향 진동 / Yaw: 90도 위상차 좌우 슬립 비동기 / Pitch: 4.3Hz
    이벤트 활성 내내 지속 (감쇠 없음 — 슬립이 끝날 때까지 채터링).
v7  DRIVETRAIN 셀렉터 신규 (FWD/RWD/AWD) — CASE와 직교 (구동 방식별 슬립 거동)
    FWD: 앞바퀴 헛돔 → Surge 떨림↑, Yaw 작음, 앞코 살짝 들림 (Pitch+)
    RWD: 뒷바퀴 헛돔 → Yaw 큰 진동 (fishtail), 뒤 들림 (Pitch-), Surge 약함
    AWD: 4륜 균등 슬립 → 모든 축 균형 (대조군)
    기준차 쏘나타 DN8 = FWD (기본값).
v8  앞뒤 흔들림 과도 → SPIN_FA_GAIN 신규 (fore-aft 만 분리 감쇠, lateral 보존)
    SPIN_SURGE/PITCH = base × SPIN_GAIN × SPIN_FA_GAIN (기본 0.5)
    PITCH_BIAS 절반 감소 (FWD +0.6→+0.3, RWD -0.4→-0.2). yaw fishtail 은 그대로.
v9  "도는 느낌" 부족 + 지형 spike 과도 → 3가지 변경
    (1) DRIFT 신규 — 저주파(0.4Hz) sway+yaw+roll 동위상 → 미끄러지면서 도는 느낌
    (2) LAT_GAIN 1.5→0.4 — 빠른 shake 최소화 (DRIFT가 메인)
    (3) SCALE_PITCH/ROLL 대폭 감소 — 지형(언덕/코너) 직통 차단
        NORMAL  pitch 1.0→0.3 / roll 1.0→0.5
        EVENT   pitch 1.0→0.3 / roll 1.0→0.5
    ※ udp_sender.py 도 packet[2] = safe["yaw"] 로 수정 필수 (yaw 송신 활성화)
v10 실험 환경 재설계 — 물리 자동트리거 폐기, 시나리오 시각 스케줄 구동.
    (1) trigger_event(case, slide, duration) 신규 — 시나리오 main.py 가 이벤트를
        직접 발생시킴 (속도/횡가속 자동감지 제거). is_event = 활성 이벤트 유무.
    (2) 케이스 표(_CASE_TABLE) 값을 이벤트마다 동적 로드 — Case1=약함 / Case3=강함.
    (3) 멀미·매끄러움 우선: PITCH_LIMIT 0.3 하드클램프, 고주파 WHEEL_SPIN 제거
        (SPIN_GAIN=0), PITCH_BIAS 제거, 모든 진폭 축소. EMA α=0.15 와 함께 저지연.
    (4) 강한 이벤트(slide=True)만 저주파 DRIFT(미끄러짐) 합성. 약한 이벤트는
        부력 heave + 약한 좌우흔들림만.
"""

import math

# ═════════════════════════════════════════════════════════════════════════════
# 공통 상수
# ═════════════════════════════════════════════════════════════════════════════
GRAVITY     = 9.81
PITCH_LIMIT = 0.2   # deg  v28(#4): 0.3→0.2 오르막/내리막 틸트 더 억제 (기울기 과함 피드백)
ROLL_LIMIT  = 1.5   # deg  v13: 4.0→1.5  "바이킹/비행기" 기울어짐 제거 (진동≠기울임)

# ═════════════════════════════════════════════════════════════════════════════
# 시나리오 B 파라미터  (수막현상)
# ═════════════════════════════════════════════════════════════════════════════
# 정상 구간 스케일 (대조 낙차 극대화 위해 기본 반응 유지)
# v9: 지형 직통 차단 — pitch 1.0→0.3 (언덕 spike 차단) / roll 1.0→0.5 (코너 body roll 절반)
# v29(#4 대조): 정상주행을 "거의 변화 없는" 차분한 주행으로 → 이벤트 대비 극대화.
SCALE_SURGE_NORMAL = 0.3    # v29: 0.5→0.3 (노젓기/정상 차분)
SCALE_SWAY_NORMAL  = 0.3    # v29: 1.0→0.3 평소 코너 좌우흔들림 대폭↓
SCALE_HEAVE_NORMAL = 0.3    # v29: 0.5→0.3 평소 상하 요철↓
SCALE_ROLL_NORMAL  = 0.10   # v29: 0.12→0.10
SCALE_PITCH_NORMAL = 0.02   # v28(#4): 0.04→0.02 오르막/내리막 틸트 추가 억제
SCALE_YAW_NORMAL   = 0.15   # v29: 0.3→0.15 평소 yaw 대폭↓ (회전 시 차분)

# 이벤트 구간 스케일 (접지력 상실)
# v10: 매끄러움 우선 — pitch/yaw 축소, 합성 신호가 메인
SCALE_SURGE_EVENT = 0.1    # 완전 0 회피 (기계 이상 오인 방지)
SCALE_SWAY_EVENT  = 0.1
SCALE_HEAVE_EVENT = 0.5    # Heave 본체는 별도 부력 신호 합성
SCALE_ROLL_EVENT  = 0.12   # v13: 0.4→0.12  이벤트 중 지형 roll 기울어짐 억제
SCALE_PITCH_EVENT = 0.02   # v28(#4): 0.04→0.02 지형 pitch 추가 억제
SCALE_YAW_EVENT   = 0.6    # v10: 1.2→0.6  급격한 yaw 억제 (매끄럽게)

# ─────────────────────────────────────────────────────────────────────────────
# 케이스 셀렉터 (물웅덩이 깊이별 부력/진동 강도)
# ─────────────────────────────────────────────────────────────────────────────
# 기준: 현대 쏘나타 DN8 (전장 4900mm, 공차중량 1500kg, 타이어 225/45R18 D=660mm)
#       강수량 50mm/h, 물웅덩이 길이 4900mm (= 차 전장), 통과 시간 3.0s,
#       역산 통과 속도 1.63 m/s (5.9 km/h)
# v10: CASE 는 더 이상 자동 트리거에 쓰지 않음. 이벤트마다 trigger_event(case=...)
#      로 표의 해당 행을 동적 로드. 아래 DEFAULT_CASE 는 단독 테스트용 폴백값.
DEFAULT_CASE = 1

_CASE_TABLE = {
    # case: (Heave_A,  Sway_A,  Roll_A,  water_depth_mm,  buoyancy_N)  비고
    1: (1.0, 1.75, 2.0, 330, 1510),   # 1/2 잠김 — 가벼운 부력 + 횡진동 시작 (= 약한 이벤트)
    2: (1.4, 2.33, 2.7, 440, 2139),   # 2/3 잠김 — 뚜렷한 부력 + 중간 강도 횡요동
    3: (1.6, 2.62, 3.0, 495, 2430),   # 3/4 잠김 — 강한 부력·조향 둔감 (= 강한 이벤트)
    4: (2.0, 3.50, 4.0, 660, 3021),   # 4/4 완전 침수 — 도로 극단(안전 한계), 최대 강도
}
(_H_A, _S_A, _R_A, WATER_DEPTH_MM, BUOYANCY_N) = _CASE_TABLE[DEFAULT_CASE]

# ─────────────────────────────────────────────────────────────────────────────
# 좌우 흔들림 강도 게인 (EMA 감쇠 보정용)
# ─────────────────────────────────────────────────────────────────────────────
# 이벤트 EMA α=0.05 가 1.43Hz 진동을 ~27% 만 통과시킴 → 케이스 표 값의 1/4 체감.
# LAT_GAIN 으로 사전 증폭해 체감 진폭을 표 값에 가깝게 맞춤.
#   1.0 = 표 그대로 (체감 ~27%)
#   1.5 = 약한 보정 (체감 ~40%)
#   2.0 = 중간 보정 (체감 ~54%)
#   3.5 = 완전 보정 (체감 ~95%, 거의 표 값)
# 좌우흔들림 게인 (v11: sway 를 "확 크게" — sway 는 velocity_limiter 제한 대상 아님).
#   SWAY_SHAKE_GAIN: 좌우 병진 진폭 배율. 크게 줄수록 좌우좌우 흔들림이 세짐.
#   ROLL_SHAKE_GAIN: 좌우 기울임 배율. roll 은 각속도 한계(7°/s)로 rate-clamp 되니 과하게
#                    주면 뭉개짐 → 보조 수준으로만 유지.
SWAY_SHAKE_GAIN  = 11.0    # ★ 좌우흔들림 세기 (v30: 6.5→11 이벤트 대폭 강화 — 무리해도 강하게)
ROLL_SHAKE_GAIN  = 0.25    # v13: 0.5→0.25  진동 중 roll 기울임 최소화

# 합산 안전 상한 — heave/sway 신호가 폭주하지 않도록 클램프.
HEAVE_SIGNAL_CAP = 8.0     # v30: 5→8 수직 진동 상한↑ (이벤트 강하게)
SWAY_SIGNAL_CAP  = 16.0    # v30: 9→16 큰 좌우흔들림 허용 (이벤트 강하게, 클램프 풀기)

# ─────────────────────────────────────────────────────────────────────────────
# v13: 거친 노면 고속주행 질감 (rough-road buzz) — MODE_AQUA 진동 텍스처
# ─────────────────────────────────────────────────────────────────────────────
# 기존 단일 2.2Hz 사인 = "둔탁하고 느린" 출렁임. 울퉁불퉁한 노면을 빠르게 달릴 때의
# 질감으로 교체: 다주파(비정수배 → 비주기·거친) 빠른 요철 진동.
#   - 수직(heave) 主 + 횡(sway) 副 — 둘 다 velocity_limiter 대상 아님 → 빠른 진동 통과
#   - roll 은 아주 약하게만 (기울어짐 방지)
ROAD_BUZZ_F1         = 11.0   # Hz  v25: 6.5→11  좌우 "ㄷㄷㄷ" 빠른 떨림 (40Hz Nyquist 20Hz 내)
ROAD_BUZZ_F2         = 14.0   # Hz  보조. v26: W2↓ 로 사실상 비활성 (맥놀이=휙휙덜덜 제거용)
ROAD_BUZZ_W2         = 0.12   # v26: 0.5→0.12  11/14Hz 맥놀이(~3Hz)가 "휙휙덜덜" 만듦 →
                              #       거의 끄고 단일 11Hz 에 가깝게 → 고른 "ㄷㄷㄷ" 떨림.
ROAD_BUZZ_HEAVE_GAIN = 2.8    # v30: 1.3→2.8 수직 진폭↑ (이벤트 강하게)
ROAD_BUZZ_SWAY_SCALE = 0.9    # v30: 0.45→0.9 좌우 버즈 진폭 대폭↑ (이벤트 강하게)
                              #       (떨림은 진폭보다 진동수). 더 세게 원하면 0.6~0.8.
ROAD_BUZZ_ROLL_SCALE = 0.3    # 롤 요철 (아주 작게 — 기울임 아님)
ROAD_BUZZ_RISE       = 0.12   # v22: 0.25→0.12  갑작스러운 수막현상 onset (확 시작)
ROAD_BUZZ_FALL       = 0.5    # 페이드아웃은 완만하게 (그립 회복)

# ═════════════════════════════════════════════════════════════════════════════
# v17: 이벤트 = 2단 구조  "흔들림(shake) → 미끄러짐(slip)".
#   케이스1(1/2 잠김) 단일 프로파일만 사용 (FLOAT/완전침수 폐기 — 상황에 안 맞음).
#   Phase 1 (shake, _event_shake_dur): 거친 노면 버즈 — 빠른 다주파 요철 진동
#           (수직 heave 主 + 횡 sway 副). "울퉁불퉁한 길을 고속주행" 질감.
#   Phase 2 (slip, _event_slip_dur): shake 끝난 직후 ~3초간 한쪽으로 미끄러짐.
#           sway+yaw 동위상 슬라이드 + 느린 wobble (미끄러지며 도는 느낌).
#   총 이벤트 지속 = shake_dur + slip_dur.
# ═════════════════════════════════════════════════════════════════════════════
# (v22) 미끄러짐(slip) 페이즈 폐기 — 사용자 라이드 피드백: "수막현상 느끼기 전
#       미끄러짐은 도움이 안 되고 멀미만 난다." → 방향성 슬라이드 제거.
# (v26) 단발 미끄러짐(slip) 부활 — "아차" startle 용. 좌우 떨림(흔들림) 직후 딱 한 번,
#       한쪽으로 부드럽게 슬라이드했다 복귀. 핵심: 좌우 진동/wobble 없음(이전 "좌우 꺾임"
#       원인) → 반파 사인 1개(0→피크→0) 단방향. 이벤트별 trigger_event(slip=True) 로만 켬.
SLIP_DUR    = 0.7    # 슬립 펄스 길이 [s] (흔들림 종료 직후 1회)
SLIP_SWAY_A = 13.0   # v30: 7→13 슬립 횡가속 피크↑↑↑ — 강한 직진 미끄러짐 shove
SLIP_YAW_A  = 2.5    # v30: 0.6→2.5 슬립 중 차체 회전↑ — 미끄러지며 확 돎

# ─────────────────────────────────────────────────────────────────────────────
# v22: 내리막 가속감 — 경사(grade)에 비례한 종방향 surge cue (정상주행 구간)
# ─────────────────────────────────────────────────────────────────────────────
# 오토파일럿이 속도를 유지해 내리막에서도 accel.x≈0 → "속도가 자연스럽게 높아지는"
# 체감이 없음. 도로 경사(rot.pitch)로부터 내리막일 때 전방 surge 를 합성해 가속감 부여.
#   CARLA 관례: 오르막 pitch>0 / 내리막 pitch<0 (차 앞코가 아래로).
#   내리막(pitch<0)에서만 전방(+) surge. (부호 반대로 느껴지면 GAIN 부호 반전.)
GRADE_SURGE_GAIN = 0.0     # v28(노젓기): 0.08→0 지형따라 surge 합성 끔 (항속 fore-aft 노젓기 제거)
GRADE_SURGE_CAP  = 2.0     # 가속감 상한 [m/s²] (급경사에서 과하지 않게)

# ─────────────────────────────────────────────────────────────────────────────
# v15: 바퀴 헛도는 느낌 (wheel-spin) — 접지 상실 시 종방향 고주파 떨림
# ─────────────────────────────────────────────────────────────────────────────
# 수막/침수 → 가속해도 차체가 비례해 안 나감 + 시트로 '부르르' 떨림 전달.
#   surge(종방향)는 velocity_limiter 대상이 아니라 고주파가 안 깎임 → 헛돎의 主 축.
#   pitch/yaw 채터링은 PITCH_LIMIT(0.3)·velocity_limiter 에 막혀 비효율 → 최소만.
#   F1·F2 비정수배 → 비주기적("거칠게 헛도는") 떨림.
SPIN_ON          = True
SPIN_F1          = 3.3     # Hz  주 떨림 (≈엔진 헛돎 부르르)
SPIN_F2          = 5.0     # Hz  보조 (F1 비정수배 → 거친 질감, 20Hz 샘플 Nyquist 내)
SPIN_W2          = 0.5     # 보조 주파수 가중
SPIN_SURGE_A     = 1.5     # v20: 2.2→1.5  헛돎 떨림 진폭 축소 (덜 급격·부드럽게)
SPIN_YAW_A       = 0.4     # v20: 0.6→0.4  좌우 휠 비대칭 슬립 더 작게
SPIN_SURGE_CAP   = 4.5     # surge 합산 안전 상한 (drag + 떨림 커버)
SPIN_RISE        = 0.3     # v20: 0.15→0.3  페이드인 완만하게
SPIN_FALL        = 0.6     # v20: 0.4→0.6   페이드아웃 완만하게

# ─────────────────────────────────────────────────────────────────────────────
# 구동 방식 셀렉터 (CASE와 직교 — 구동별 슬립 거동 차이)
# ─────────────────────────────────────────────────────────────────────────────
# FWD: 앞바퀴 헛돔  — Surge 떨림↑ / Yaw 작음 / 앞코 살짝 들림 (Pitch+)
# RWD: 뒷바퀴 헛돔  — Surge 약함 / 꼬리치는 큰 Yaw (fishtail) / 뒤 들림 (Pitch-)
# AWD: 4륜 동시 슬립 — 모든 축 균형 (대조군)
# 기준차 쏘나타 DN8 = FWD.
DRIVETRAIN = "FWD"   # "FWD" / "RWD" / "AWD"

_DRIVETRAIN_TABLE = {
    # drivetrain: (surge_mult, yaw_mult, pitch_mult, pitch_bias_deg)
    # v8: pitch_bias 절반 감소 (앞뒤 lean 완화) — 기존 +0.6/-0.4 → +0.3/-0.2
    "FWD": (1.4, 0.5, 0.8, +0.3),   # 앞이 헛돔 (앞코 살짝 들림)
    "RWD": (0.7, 1.8, 1.0, -0.2),   # 뒤가 헛돔 (fishtail)
    "AWD": (1.0, 1.0, 1.0,  0.0),   # 4륜 균등 (대조군)
}
(_SP_SURGE_M, _SP_YAW_M, _SP_PITCH_M, PITCH_BIAS_DEG) = _DRIVETRAIN_TABLE[DRIVETRAIN]
PITCH_BIAS_RAMP_T = 0.5   # 정적 pitch 편차 ramp-up 시간 [s] (이벤트 진입 시 급튐 방지)

# 이벤트 트리거 조건
TRIGGER_V_MIN  = 10.0      # m/s   (저속 수막 X)
TRIGGER_AY_MAX =  0.3      # m/s²  (코너링 횡가속도 소실)


# ═════════════════════════════════════════════════════════════════════════════
# 내부 상태 (트리거/t_local 자동 관리)
# ═════════════════════════════════════════════════════════════════════════════
_dt              = 1.0 / 25
_t_local         = 0.0
_is_event_prev   = False

# v10: 시나리오 시각 스케줄 구동 이벤트 상태 (trigger_event 로 설정)
_active_case      = None    # None = 평탄주행(정상) / 1~4 = 진행 중인 케이스
_event_clock      = 0.0     # 이벤트 시작 후 경과 [s] (합성 신호 위상용)
_event_duration   = 0.0     # v22: 흔들림(버즈) 지속 [s] (이후 slip 여부에 따라 종료)
_event_slip       = False   # v26: 흔들림 직후 단발 슬립 켜기 (이벤트별)
_event_slip_dir   = 1        # v26: 슬립 방향 (+1=오른쪽 / -1=왼쪽)
_ACT_HEAVE_A      = 0.0     # 진행 중 케이스 부력 진폭 [m/s²]
_ACT_SWAY_A       = 0.0     # 진행 중 케이스 좌우진동 진폭 [m/s²]
_ACT_ROLL_A       = 0.0     # 진행 중 케이스 좌우진동 진폭 [deg]


# ═════════════════════════════════════════════════════════════════════════════
# 공용 유틸
# ═════════════════════════════════════════════════════════════════════════════

def _clamp(value, limit):
    return max(-limit, min(value, limit))


def _trapezoid(te, total, rise, fall):
    """사다리꼴 엔벨로프: 0→1 (rise초) 유지 1→0 (마지막 fall초). 0~1 클램프."""
    up   = te / rise if rise > 0 else 1.0
    down = (total - te) / fall if fall > 0 else 1.0
    return max(0.0, min(1.0, up, down))


def set_dt(dt):
    """틱 간격 설정 (기본 1/25). 시작 시 1회 호출."""
    global _dt
    _dt = dt


def reset_state():
    """이벤트/t_local 상태 초기화. 실험 재시작 시 호출."""
    global _t_local, _is_event_prev
    global _active_case, _event_clock, _event_duration, _event_slip, _event_slip_dir
    global _ACT_HEAVE_A, _ACT_SWAY_A, _ACT_ROLL_A
    _t_local         = 0.0
    _is_event_prev   = False
    _active_case     = None
    _event_clock     = 0.0
    _event_duration  = 0.0
    _event_slip      = False
    _event_slip_dir  = 1
    _ACT_HEAVE_A     = 0.0
    _ACT_SWAY_A      = 0.0
    _ACT_ROLL_A      = 0.0


def trigger_event(case, duration=2.0, slip=False, slip_dir=1):
    """
    시나리오 main.py 가 호출 — 수막현상 이벤트를 지정 시각에 발생시킴.

    v26: 이벤트 = "갑작스러운 좌우 떨림(ㄷㄷㄷ)" + (선택) 흔들림 직후 단발 슬립.
         slip=True 면 흔들림이 끝난 뒤 한쪽으로 부드럽게 1회 미끄러졌다 복귀("아차").

    Parameters
    ----------
    case     : int   _CASE_TABLE 케이스 (1~4). 진폭(Heave/Sway/Roll) 로드.
    duration : float 흔들림(떨림) 지속 [s]. 경과 후 slip 여부에 따라 종료.
    slip     : bool  True 면 흔들림 직후 단발 슬립(SLIP_DUR) 추가. 기본 False.
    slip_dir : int   슬립 방향 (+1=오른쪽 / -1=왼쪽).

    같은 프로세스(collector 백그라운드 스레드)에서 transform_motion 이 읽는
    모듈 상태를 설정한다.
    """
    global _active_case, _event_clock, _event_duration, _event_slip, _event_slip_dir
    global _ACT_HEAVE_A, _ACT_SWAY_A, _ACT_ROLL_A
    h, s, r, _depth, _buoy = _CASE_TABLE[case]
    _active_case     = case
    _event_clock     = 0.0
    _event_duration  = duration
    _event_slip      = slip
    _event_slip_dir  = 1 if slip_dir >= 0 else -1
    _ACT_HEAVE_A     = h
    _ACT_SWAY_A      = s * SWAY_SHAKE_GAIN              # 좌우흔들림 "확 크게"
    _ACT_ROLL_A      = min(r * ROLL_SHAKE_GAIN, ROLL_LIMIT - 0.5)


def is_event_active():
    """직전 transform_motion() 시점의 이벤트 활성 여부 (filters 디스패치용)."""
    return _is_event_prev


# ═════════════════════════════════════════════════════════════════════════════
# 시나리오 B : 정상/이벤트 분기 + 인공 좌우 진동 + 인공 부력
# ═════════════════════════════════════════════════════════════════════════════

def transform_motion(accel, rot, speed=0.0):
    """
    Parameters
    ----------
    accel : dict  {"x","y","z"}  [m/s²]
    rot   : dict  {"roll","pitch","yaw"}  [deg]
    speed : float CARLA velocity magnitude [m/s]  (호환용 — v10 에선 미사용)

    Returns
    -------
    dict  {"surge","sway","heave","roll","pitch","yaw"}
    """
    global _is_event_prev, _active_case, _event_clock

    # ── 이벤트 상태: trigger_event() 로 설정, 여기서 clock 진행 + 자동 종료 ────
    is_event = _active_case is not None
    _is_event_prev = is_event

    if not is_event:
        # ── 평탄주행(정상) 구간 ────────────────────────────────────────────
        surge = accel["x"] * SCALE_SURGE_NORMAL
        sway  = accel["y"] * SCALE_SWAY_NORMAL
        heave = (accel["z"] - GRAVITY) * SCALE_HEAVE_NORMAL
        roll  = rot["roll"]  * SCALE_ROLL_NORMAL
        pitch = rot["pitch"] * SCALE_PITCH_NORMAL
        yaw   = rot["yaw"]   * SCALE_YAW_NORMAL

        # v22: 내리막 가속감 — 도로 경사(pitch<0=내리막)에서 전방 surge 합성.
        #   오토파일럿이 속도를 유지해도 "내리막에서 속도가 붙는" 체감을 부여.
        downhill_deg = max(0.0, -rot["pitch"])         # 내리막 기울기 [deg] (오르막=0)
        surge += _clamp(GRADE_SURGE_GAIN * downhill_deg, GRADE_SURGE_CAP)
    else:
        # ── 수막현상 이벤트 구간 (합성 신호 — 프로파일별 메커니즘) ───────────
        te = _event_clock      # 이벤트 시작 후 경과 [s]

        surge = accel["x"] * SCALE_SURGE_EVENT
        sway  = accel["y"] * SCALE_SWAY_EVENT
        roll  = rot["roll"]  * SCALE_ROLL_EVENT
        pitch = rot["pitch"] * SCALE_PITCH_EVENT
        yaw   = rot["yaw"]   * SCALE_YAW_EVENT
        heave_carla = (accel["z"] - GRAVITY) * SCALE_HEAVE_EVENT

        # ═══ v22: 갑작스러운 수막현상 — 거친 노면 버즈 (단일 페이즈) ═══════════
        #   정상주행 중 확 시작되는 자갈길/오프로드 빠른 잔진동 (수직 heave 主 + 횡 sway 副).
        #   F1·F2 비정수배 → 비주기적("울퉁불퉁") / heave·sway 는 rate-limit 없음.
        #   onset 을 짧게(RISE 0.12) → "갑작스러움", 끝은 완만(FALL 0.5)하게 그립 회복.
        buzz_env = _trapezoid(te, _event_duration, ROAD_BUZZ_RISE, ROAD_BUZZ_FALL)
        heave_buzz = 0.0
        if buzz_env > 0.0:
            w1 = 2.0 * math.pi * ROAD_BUZZ_F1
            w2 = 2.0 * math.pi * ROAD_BUZZ_F2
            buzz_v = math.sin(w1 * te)        + ROAD_BUZZ_W2 * math.sin(w2 * te)
            buzz_l = math.sin(w1 * te + 0.7)  + ROAD_BUZZ_W2 * math.sin(w2 * te + 1.3)
            heave_buzz = _ACT_HEAVE_A * ROAD_BUZZ_HEAVE_GAIN * buzz_v * buzz_env
            sway += _ACT_SWAY_A * ROAD_BUZZ_SWAY_SCALE * buzz_l        * buzz_env
            roll += _ACT_ROLL_A * ROAD_BUZZ_ROLL_SCALE * math.sin(w1 * te) * buzz_env

        # ═══ v26: 단발 미끄러짐(slip) — 흔들림 종료 직후 "아차" 1회 ═══════════════
        #   반파 사인 1개(0→피크→0) 단방향 → 좌우 진동/꺾임 없이 한쪽으로 스윽 밀렸다
        #   복귀. te 가 _event_duration 을 지난 SLIP_DUR 동안만. buzz_env/spin_env 는
        #   이 구간에서 0(아래 _trapezoid(te,_event_duration,..) 가 0) → 떨림과 안 겹침.
        if _event_slip and te >= _event_duration:
            ts = te - _event_duration
            if ts < SLIP_DUR:
                bump  = math.sin(math.pi * ts / SLIP_DUR)   # 0→1→0 한쪽 방향
                sway += _event_slip_dir * SLIP_SWAY_A * bump
                yaw  += _event_slip_dir * SLIP_YAW_A  * bump

        # 노면 요철 수직 진동 + CARLA heave 합산
        heave = _clamp(heave_carla + heave_buzz, HEAVE_SIGNAL_CAP)
        sway  = _clamp(sway, SWAY_SIGNAL_CAP)

        # ── 바퀴 헛도는 느낌 (wheel-spin) — 접지 상실 종방향 떨림 (surge 主) ──
        #    이벤트 내내: 접지를 잃으면 바퀴가 헛돌며 '부르르'. surge 는 rate-limit
        #    대상이 아니라 고주파가 안 깎임.
        if SPIN_ON:
            spin_env = _trapezoid(te, _event_duration, SPIN_RISE, SPIN_FALL)
            ws1 = 2.0 * math.pi * SPIN_F1
            ws2 = 2.0 * math.pi * SPIN_F2
            spin_osc = math.sin(ws1 * te) + SPIN_W2 * math.sin(ws2 * te)
            surge += SPIN_SURGE_A * spin_osc * spin_env
            yaw   += SPIN_YAW_A   * math.sin(ws1 * te + math.pi / 2.0) * spin_env
            surge  = _clamp(surge, SPIN_SURGE_CAP)

        # clock 진행 + (흔들림 + 단발슬립) 총 지속시간 경과 시 자동 복귀
        _event_clock += _dt
        _total_dur = _event_duration + (SLIP_DUR if _event_slip else 0.0)
        if _event_clock >= _total_dur:
            _active_case = None

    # ── 공통 각도 안전 클램핑 ────────────────────────────────────────────────
    roll  = _clamp(roll,  ROLL_LIMIT)
    pitch = _clamp(pitch, PITCH_LIMIT)

    return {"surge": surge, "sway": sway, "heave": heave,
            "roll":  roll,  "pitch": pitch, "yaw":  yaw}
