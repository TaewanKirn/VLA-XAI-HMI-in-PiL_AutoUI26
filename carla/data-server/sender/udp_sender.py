"""
역할 : 가공된 데이터를 6DOF로 UDP 전송.

A/B 양쪽 transforms/filters 모듈과 호환되도록 defensive 하게 작성:
  - 시나리오 A (답답함) : transform_motion(accel, rot)            , filters.apply(raw)
  - 시나리오 B (수막)    : transform_motion(accel, rot, speed)     , filters.apply(raw, is_event)
                          + set_dt / is_event_active

processing/ 폴더의 transforms.py 와 filters.py 를 A↔B 로 갈아끼우면
udp_sender 는 그대로 두고 자동으로 그쪽 파이프라인을 따라감.
"""
import socket
import struct
import inspect
import time
import threading

from processing.transforms import transform_motion, reset_state
from processing.filters import (
    apply as apply_filter,
    velocity_limiter,
    reset_filter,
)

# ── B 전용 API 옵셔널 import ──────────────────────────────────────
try:
    from processing.transforms import set_dt as _set_dt
except ImportError:
    def _set_dt(_dt):       # A 는 stateless
        pass

try:
    from processing.transforms import is_event_active as _is_event_active
except ImportError:
    def _is_event_active():  # A 는 이벤트 분기 없음
        return False

# ── transform_motion / apply_filter 시그니처 자동 감지 ─────────────
_TM_PARAMS = len(inspect.signature(transform_motion).parameters)
_AF_PARAMS = len(inspect.signature(apply_filter).parameters)


def _call_transform(accel, rot, speed_ms):
    if _TM_PARAMS >= 3:
        return transform_motion(accel, rot, speed_ms)
    return transform_motion(accel, rot)


def _call_apply(motion, is_event):
    if _AF_PARAMS >= 2:
        return apply_filter(motion, is_event=is_event)
    return apply_filter(motion)


# ── 송신 설정 ────────────────────────────────────────────────────
UDP_IP   = "127.0.0.1"
UDP_PORT = 10000
DT       = 1.0 / 25       # 기본값. collector 가 실제 sim delta 로 set_dt() 호출해 덮어씀.


def set_dt(dt):
    """실제 sim fixed_delta_seconds 로 송신측 DT 동기.
    가속 EMA(_condition_accel)·velocity_limiter 가 이 DT 로 시정수/변화율을 계산하므로
    sim Hz 를 바꾸면(예: 20→30Hz) 반드시 같이 맞춰야 평활/제한이 의도대로 동작한다."""
    global DT
    if dt and dt > 0:
        DT = float(dt)

# ── 회전 상황 멀미 저감 ───────────────────────────────────────────
# 회전교차로/급커브(높은 yaw rate)에서 6DOF 진폭을 크게 줄여 멀미 완화.
# yaw rate 는 collector 가 보내는 angular_velocity.z (CARLA: deg/s) 사용.
TURN_YAW_RATE_THRESH = 5.0    # deg/s, 이 이상이면 '회전 중'으로 판정
TURN_COMFORT_SCALE   = 0.75   # v18: 0.45→0.75 회전 중 감쇠 완화 (리그 #2 — 커브 회전감 살림)
_TURN_RAMP           = 0.12   # 스케일 전환 보간율 (프레임당 — 급변 방지)
_turn_scale          = 1.0    # 현재 적용 중인 진폭 배율 (램프 상태)

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

# ── 가속도 입력 컨디셔닝 (계단식 surge/sway 완화) ─────────────────
# CARLA vehicle.get_acceleration() 은 물리 서브스텝 간 속도차분이라 프레임마다
# 부호가 뒤집히는 글리치성 노이즈(±30~50 m/s² 스파이크)가 심하다. 이게 surge(전후)
# cue 로 그대로 들어가 "가스/브레이크를 눌렀다 뗐다" 하는 계단식 울컥거림을 만든다.
#   → transform 직전에 종·횡(x,y) 가속도를 ① 현실 범위로 클립 ② 저역통과(EMA)로 평활.
#   heave(z)는 중력 기준이라 건드리지 않는다. B 의 합성 이벤트(떨림·슬립)는 가속도를
#   읽은 뒤에 더해지므로 영향 없음(질감 보존).
ACC_CLIP_XY = 8.0    # m/s²  현실적 종/횡 가속 상한 (글리치 스파이크 제거; 실차 제동 ~ -8)
# 저역통과 시정수 — 종/횡 분리(2026-06-18).
#   종방향(x=전후/제동)은 강평활: TM 추종 제동의 '완만→막판 급제동' 2단(=나눠 멈춤)을 한 번에 뭉갬.
#   횡방향(y=좌우)은 약평활 유지: 커브 응답(회전감)을 죽이지 않도록.
ACC_TAU_X   = 0.30   # s  종(제동) — 클수록 매끄럽지만 cue 지연↑ (0.18~0.40)
ACC_TAU_Y   = 0.18   # s  횡(좌우) — 기존값 유지(커브 즉답)
_acc_ema = None      # {"x","y"} EMA 상태 (첫 호출 시 초기화)


def _condition_accel(accel):
    """종·횡 가속도 글리치 제거 → 선형적 surge/sway. heave(z)는 원본 유지.
    종은 ACC_TAU_X(강), 횡은 ACC_TAU_Y(약)로 분리 평활."""
    global _acc_ema
    ax = max(-ACC_CLIP_XY, min(ACC_CLIP_XY, accel.get("x", 0.0)))
    ay = max(-ACC_CLIP_XY, min(ACC_CLIP_XY, accel.get("y", 0.0)))
    if _acc_ema is None:
        _acc_ema = {"x": ax, "y": ay}
    else:
        ax_k = DT / (ACC_TAU_X + DT)       # 종방향 EMA 계수 (시정수 ACC_TAU_X)
        ay_k = DT / (ACC_TAU_Y + DT)       # 횡방향 EMA 계수 (시정수 ACC_TAU_Y)
        _acc_ema["x"] += ax_k * (ax - _acc_ema["x"])
        _acc_ema["y"] += ay_k * (ay - _acc_ema["y"])
    return {"x": _acc_ema["x"], "y": _acc_ema["y"], "z": accel.get("z", 0.0)}


# ── 모듈 로드 시 1회 초기화 ──────────────────────────────────────
_set_dt(DT)
reset_state()
reset_filter()

_KEYS = ("surge", "sway", "heave", "roll", "pitch", "yaw")
_prev_limited = {k: 0.0 for k in _KEYS}


# ══════════════════════════════════════════════════════════════════
# 출력 보간(업샘플)  #2 (2026-06-18)
#   sim 틱(~26Hz, 38ms)으로 들어오는 6축 setpoint 를 OUTPUT_HZ(기본 50Hz)로
#   선형보간해 송신 → 플랫폼이 받는 38ms 계단(미세 꿀렁)을 매끈하게 깐다.
#   - 타깃 도착 후 '직전 sim 간격'에 걸쳐 prev→cur 따라감 = 지연 ~1프레임(38ms).
#   - ⚠️ macro(0.8s 떨어진 2단 감속=나눠멈춤)은 못 합침 — 그건 감속 소스 문제.
#   OUTPUT_INTERP=False 로 두면 기존처럼 sim 틱마다 1회 인라인 송신(폴백).
# ══════════════════════════════════════════════════════════════════
OUTPUT_HZ     = 100.0     # sim ~26Hz(38ms) → 100Hz 출력 = 약 4× 업샘플(스텝 ~10ms 로 잘게).
                          #   플랫폼이 더 높으면 올려도 됨(120/200). 너무 높으면 CPU만 소모.
OUTPUT_INTERP = True
_OUT_KEYS = ("roll", "pitch", "yaw", "sway", "surge", "heave")

_out_lock   = threading.Lock()
_out_prev   = None        # {6축} 이전 타깃
_out_cur    = None        # {6축} 현재 타깃
_out_prev_t = 0.0
_out_cur_t  = 0.0
_out_thread = None
_out_stop   = threading.Event()


def _pack6(d):
    """6축 dict → 6DOF UDP 패킷(기존 포맷과 동일)."""
    return struct.pack(
        '<B 8f i 8f', 1,
        d["roll"], d["pitch"], d["yaw"], d["sway"], d["surge"], d["heave"],
        0.0, 0.0, 1,
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    )


def _set_output_target(safe):
    """sim 틱마다 호출 — 보간 타깃 갱신(prev←cur, cur←safe). 보간 스레드 lazy-start."""
    global _out_prev, _out_cur, _out_prev_t, _out_cur_t, _out_thread
    now = time.perf_counter()
    six = {k: safe[k] for k in _OUT_KEYS}
    with _out_lock:
        if _out_cur is None:
            _out_prev = _out_cur = six
            _out_prev_t = _out_cur_t = now
        else:
            _out_prev, _out_prev_t = _out_cur, _out_cur_t
            _out_cur,  _out_cur_t  = six, now
    if _out_thread is None:
        _out_stop.clear()
        _out_thread = threading.Thread(target=_output_loop, daemon=True)
        _out_thread.start()


def _output_loop():
    """OUTPUT_HZ 로 prev→cur 선형보간 송신(타깃 도착 후 한 sim 간격에 걸쳐 따라감)."""
    period = 1.0 / OUTPUT_HZ
    _fail = 0          # 누적 송신 실패 건수
    _last_warn = 0.0   # 마지막 경고 시각(스팸 방지)
    while not _out_stop.is_set():
        t0 = time.perf_counter()
        with _out_lock:
            if _out_cur is None:
                out = None
            else:
                span = max(1e-3, _out_cur_t - _out_prev_t)   # 직전 sim 간격
                f = (t0 - _out_cur_t) / span                 # 0=cur도착 → 1=한 간격 후
                f = 0.0 if f < 0.0 else (1.0 if f > 1.0 else f)
                out = {k: _out_prev[k] + f * (_out_cur[k] - _out_prev[k])
                       for k in _OUT_KEYS}
        if out is not None:
            try:
                sock.sendto(_pack6(out), (UDP_IP, UDP_PORT))
            except Exception as e:
                # 무음 except 폐기 — 100Hz 송신 실패를 관측가능하게(2s 간 1회 경고+누적 카운트).
                #   수신기 미기동/포트 점유 등 "콘솔만 흐르고 플랫폼 안 움직임"의 단서.
                _fail += 1
                if t0 - _last_warn >= 2.0:
                    print(f"[udp_sender] ⚠️ 100Hz 출력 송신 실패 누적 {_fail}건 "
                          f"(최근: {type(e).__name__}: {e}) — 수신기/포트 {UDP_PORT} 확인")
                    _last_warn = t0
        rest = period - (time.perf_counter() - t0)
        if rest > 0:
            time.sleep(rest)


def stop_output_thread():
    global _out_thread
    _out_stop.set()
    if _out_thread is not None:
        _out_thread.join(timeout=1.0)
        _out_thread = None


def process_and_send_6dof(data):
    global _prev_limited, _turn_scale

    accel    = _condition_accel(data["acceleration"])   # 종·횡 글리치 제거(계단식 surge 완화)
    rot      = data["rotation"]
    speed_ms = data.get("speed_kmh", 0.0) / 3.6   # B 이벤트 트리거에 사용 (A 는 무시)

    # 1. transform
    motion = _call_transform(accel, rot, speed_ms)

    # 1-b. 회전 상황 감지 → 진폭 축소 (yaw rate 기반, 램프로 부드럽게 전환)
    #      회전교차로/급커브에서 6DOF 값이 과도해지는 것을 멀미 한계 내로 억제.
    yaw_rate = abs(data.get("angular_velocity", {}).get("z", 0.0))   # deg/s
    target_scale = TURN_COMFORT_SCALE if yaw_rate > TURN_YAW_RATE_THRESH else 1.0
    _turn_scale += (target_scale - _turn_scale) * _TURN_RAMP
    motion = {k: v * _turn_scale for k, v in motion.items()}

    # 2. EMA 필터 (B 에선 이벤트 분기 자동, A 는 그냥 EMA)
    smoothed = _call_apply(motion, is_event=_is_event_active())

    # 3. 각도 축 속도 한계 안전 클램프 (병진 축 패스스루)
    safe = velocity_limiter(smoothed, _prev_limited, DT)
    _prev_limited = safe

    surge = safe["surge"]
    sway  = safe["sway"]
    heave = safe["heave"]
    yaw   = safe["yaw"]

    # 4-5. UDP 전송 — 보간 ON 이면 타깃만 갱신(보간 스레드가 OUTPUT_HZ 로 송신),
    #      OFF 면 기존처럼 sim 틱마다 1회 인라인 송신.
    if OUTPUT_INTERP:
        _set_output_target(safe)
    else:
        sock.sendto(_pack6(safe), (UDP_IP, UDP_PORT))

    event = int(_is_event_active())
    print(
        f"6DOF 전송 | event={event} turn×{_turn_scale:.2f} "
        f"speed={speed_ms*3.6:5.1f}km/h | "
        f"Surge:{surge:+6.2f} Sway:{sway:+6.2f} Heave:{heave:+6.2f} | "
        f"Roll:{safe['roll']:+5.2f} Pitch:{safe['pitch']:+5.2f} Yaw:{yaw:+6.2f}"
    )

    # 6축 값 반환 → collector 가 WS 프레임에 합쳐 모니터(ws_monitor)로도 보냄 (#6)
    return {"roll": round(safe["roll"], 3), "pitch": round(safe["pitch"], 3),
            "yaw": round(yaw, 3), "sway": round(sway, 3), "surge": round(surge, 3),
            "heave": round(heave, 3), "event": event}
