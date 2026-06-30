import carla
import math
import time
import os
import sys
import random

# data-server / scenarios 경로를 sys.path에 추가
_DATA_SERVER_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', '..', '..', 'data-server')
)
_SCENARIOS_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', '..')
)
for _p in (_DATA_SERVER_DIR, _SCENARIOS_ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# 6DOF 프로파일 자동 선택: 이 시나리오 = B(수막현상). 파이프라인 import '전에' 설정해야 함.
os.environ['SCENARIO'] = 'B'

# 재현성: 분석계획 §5 SEED=2026 고정. ambient 스폰·recycle·TM 거동을 결정론화(환경변수로 override).
#   ⚠️ GPU 물리·부동소수점·try_spawn 점유 충돌 등 시드로도 못 잡는 잔여는 남는다(main 하단 주석).
SEED = int(os.environ.get('SCENARIO_SEED', '2026'))

from collector.carla_collector import run_collector, stop_collector
from perf import apply_lightweight_settings
from launch_viewer import launch_viewer_bat
from launch_hmi import launch_hmi                        # HMI 오버레이(중앙상단 640x480) DiL 직접 표시
from launch_map import launch_map                       # HDMap 웹 뷰어 자동 오픈
from launch_monitor import launch_monitor               # 실험상황 모니터(ws_monitor) 자동 오픈 (#7)
from traffic import spawn_ambient_traffic, destroy_traffic, recycle_traffic_ahead  # 주변 트래픽 (#5)
from sender.websocket_sender import publish_event       # 이벤트 마커 → 모니터 타임라인/JSONL (#1)
from processing.transforms import trigger_event, set_dt as set_motion_dt  # v17/v21

# ================================================================
# 시나리오 설정 (v10: 실험 환경 — 시각 스케줄 구동)
# ================================================================
TOWN              = 'Town04'
SCENARIO_DURATION = 150.0     # v32: 240→150. 이벤트 50/80/120 으로 당김 → 120s 강한 이벤트 + 30s 여유.
# SIM_DELTA 이력: 0.025(40Hz) → 1/26(실시간) → 0.025 복원(2026-06-19 사용자: "속도는 이전이 좋다").
#   ⚠️ 0.025 는 서버 틱(~38ms)>25ms 라 실측 ~0.71× **슬로모로 재생**된다(트레이드오프).
#   복원 이유: 슬로모면 ego 가 이벤트 시각(40/65/95s)엔 아직 개활 고속구간에 있어 **이벤트가 모두
#   주행 중 발화**(realtime 1/26 에선 ego 가 t≈80s 에 트래픽 정체 도달→Event3 가 정차 중 발화하는
#   '정차 슬립' 문제 발생). + 추종거리 15m(아래)로 종료부 추돌 대신 안전정지.
#
# ┌─ C2 '정차 슬립' 검증 토글 (2026-06-19 가설) ────────────────────────────────┐
# │ 가설(기본값): SIM_DELTA=0.025 복원 + 추종거리 15m → Event3(95s) 주행중 + 무충돌. │
# │ ▶ 검증 실패(Event3 가 정차 중 발화 or 충돌 발생) 시 ↓ 두 줄만 토글:              │
# │   ① FALLBACK_REALTIME = True  → 실시간 1/26 (슬로모 제거, 개활 유지)            │
# │   ② FALLBACK_TRAFFIC  = True  → TRAFFIC_N 28→16 (정체 완화, 개활 유지)          │
# │ 둘은 독립. 슬립이 '느려서' 정차면 ①, '차 막혀서' 정차면 ② (둘 다도 가능).         │
# └──────────────────────────────────────────────────────────────────────────┘
FALLBACK_REALTIME = True      # True → SIM_DELTA 1/26 (실시간, 슬로모 탈피) · 기본=가설(0.025 슬로모)
FALLBACK_TRAFFIC  = False     # True → TRAFFIC_N 28→16 (개활 유지) · 기본=가설(28)

SIM_DELTA         = (1.0 / 26.0) if FALLBACK_REALTIME else 0.025

EGO_SPAWN         = (10.0, -180.0)

# 최대속도 주행 (수막현상 체감 ↑) — autopilot 속도 상한을 음수로 줘서 제한속도 초과.
#   값이 음수일수록 빠름.  -50 ≈ 제한속도 +50%.  더 빠르게: -80~-100.
EGO_SPEED_OVER    = -50.0

# 수막현상 이벤트 스케줄 (합성 신호, transforms.trigger_event 로 발생)
#   v17: 케이스1(1/2 잠김, 330mm) 단일 프로파일만 사용 — 6축 값이 상황에 딱 맞음.
#        완전침수(FLOAT)는 우리 상황에 안 맞아 폐기.
#   v22: 라이드 피드백 반영 — 미끄러짐(slip) 폐기(멀미만 남), 이벤트는 "정상주행 중
#        갑작스러운 수막현상(거친 노면 버즈 + 바퀴 헛돎)"만. 흔들림 길이를 늘려도
#        이 잠김 수준은 불안하지 않다 → E2 도 E1 과 동일 길이(2초)로.
#   v27: 미끄러짐(slip) 전부 제거 — 라이드 피드백 "슬립이 오히려 더 안 좋다".
#        이벤트는 빠른 좌우 "ㄷㄷㄷ" 떨림만으로 구성.
#   E1 (~60s): 떨림 2초  (갑작스러운 수막현상).
#   E2 (~120s): 떨림 2초  (E1 과 동일).
EVENT1_TIME_S      = 30.0     # 2026-06-20(사용자): 40→30 (이벤트 30/60/90 로 조정)
EVENT1_CASE        = 1        # 1/2 잠김 (330mm)
EVENT1_DUR         = 2.0      # 떨림 지속 [s]
EVENT1_SLIP        = True     # v28(#5): 슬립 부활 — 미끄러지는 느낌
EVENT1_SLIP_DIR    = 1        # +1=오른쪽 / -1=왼쪽
EVENT2_TIME_S      = 60.0     # 2026-06-20(사용자): 65→60 (이벤트 30/60/90 로 조정)
EVENT2_CASE        = 1        # 1/2 잠김 (330mm) — 동일 케이스, 동일 길이
EVENT2_DUR         = 2.0      # 떨림 지속 [s]
EVENT2_SLIP        = True     # v28(#5): 슬립 부활
EVENT2_SLIP_DIR    = -1       # 반대 방향(왼쪽) — 두 이벤트 대비

# v31(사용자 결정): 약한 이벤트 + **강한** 이벤트(E3) 추가.
#   case 3(3/4 잠김 = 강한 이벤트, 조향 둔감) + 더 긴 떨림 + 강한 슬라이드(아래 *3 상수).
# v32: E3 를 190→120s 로 당김 — 190s 엔 ego 가 정지 상태라 물리값 validation 부실(사용자 피드백).
EVENT3_TIME_S      = 90.0     # 2026-06-20(사용자): 95→90 (이벤트 30/60/90 로 조정). 강한 이벤트(마지막)
EVENT3_CASE        = 3        # 3/4 잠김 — 강한 부력·조향 둔감 (강한 이벤트)
EVENT3_DUR         = 3.0      # 떨림 더 길게(강하게) [s]
EVENT3_SLIP        = True
EVENT3_SLIP_DIR    = 1
# 지형 라벨 — HMI C2 지형별 화면 라우팅용 (flat→C2-2 · uphill→C2-6 · downhill→C2-10).
EVENT1_TERRAIN     = 'flat'
EVENT2_TERRAIN     = 'uphill'
EVENT3_TERRAIN     = 'downhill'

# v28(#5): 이벤트 시 '차를 실제로' 옆으로 미끄러뜨림 (시각적 수막 슬라이드).
#   autopilot 주행 중 측면 임펄스를 줘 차체가 드리프트했다 복귀 → 참가자가 명확히 인지.
SLIDE_ENABLE   = True
# 2026-06-19(사용자): "E1·E2 조금 미끄러지고, E3 더 많이 미끄러지는" 모습이 시각적으로 보이되 충돌은 X.
#   횡 가속(SLIDE_ACCEL)=옆으로 미끄러짐(=시각적 '미끄러짐'·등급화) 유지, yaw킥(스핀=충돌위험·'돎'으로
#   보임)은 대폭↓ → 옆으로 미끄러지는 드리프트로 보이게. (종료부 추돌은 슬라이드가 아니라 추종거리 문제 — 별도 수정.)
SLIDE_DUR      = 1.2     # 미끄러짐 지속 [s] (E1·E2)
SLIDE_ACCEL    = 10.0    # 측면 가속 피크 [m/s²] — E1·E2 '조금'
SLIDE_YAW_KICK = 500.0   # yaw 각임펄스 1600→500 (스핀↓, 옆미끄러짐 위주)
# E3(강한 이벤트) 전용 — 더 크게 미끄러짐(횡↑), 스핀은 절제.
SLIDE_DUR3      = 1.8    # 미끄러짐 더 길게 [s]
# ▶▶ E3 가 화면상 '안 보이면' 여기 SLIDE_ACCEL3 을 올린다 (예: 17→22~26). 횡 드리프트 키우는 정본 노브.
#    (yaw킥 SLIDE_YAW_KICK3 은 '돎/스핀=충돌위험'으로 보이므로 올리지 말 것 — 횡가속으로만 키운다.)
SLIDE_ACCEL3    = 17.0   # 측면 가속 피크 — E3 '더 많이'(E1·E2 대비 ~1.7×). E3 안 보이면 ↑.
SLIDE_YAW_KICK3 = 900.0  # 2400→900 (E3 도 스핀 절제, 횡 드리프트 위주). 올리지 말 것(스핀=충돌위험).

# ── 좌우 흔들림(yaw wag): 수막현상 중 차머리(heading)가 좌우로 까딱여 ego 뷰가 흔들리게 ──
#   문제: 위 SLIDE 는 차를 '옆으로 평행이동'만 시켜 ego 뷰(차체 부착 카메라)가 좌우로 안 떨림 →
#         수막현상 현실감↓. 해결: 슬라이드 구간 동안 차체 yaw 를 사인파로 좌우 왕복시키는
#         각임펄스를 매 틱 추가 → heading 이 좌우로 떨려 ego 뷰가 좌우로 흔들림.
#   ⚠️ 좌우 '대칭'(net=0)이라 한쪽으로 도는 net 회전이 없음 → 단발 yaw킥과 달리 스핀/이탈·충돌
#      위험을 늘리지 않는다(좌·우가 상쇄). frac(1→0) 으로 이벤트 끝에 자연 감쇠.
#   ▶▶ 화면에서 좌우 흔들림이 약하면 YAW_WAG_TORQUE(3) 를 올린다(스핀이 아니라 '떨림'이라 안전).
#      너무 격하면 내리거나 YAW_WAG_FREQ 를 낮춰 천천히 흔든다.
#   v2: 매 틱 미세 임펄스(고속 타이어 힘에 상쇄돼 안 보임) → '좌우 번갈아 큰 킥'으로 변경.
#       기존 단발 킥(SLIDE_YAW_KICK=500)과 같은 단위라 확실히 보임. 좌우 교대라 net 회전 상쇄(스핀 X).
YAW_WAG_ENABLE      = False   # v3: 메인 창은 free-cam 이라 차 물리 흔들림이 안 보임 → 시점(VIEW_SHAKE)으로 대체.
                              #     차를 실제로 fishtail 시키고 싶으면 True (단, 메인 창엔 거의 안 보임).
YAW_WAG_HALF_PERIOD = 0.35    # 좌→우 전환 간격 [s] (작을수록 빠른 'ㄷㄷ', 클수록 큰 좌우 스윙)
YAW_WAG_KICK        = 800.0   # E1·E2 좌우 킥 세기 (단발 킥 500 과 같은 단위 — 좌우 번갈아). 약하면 ↑
YAW_WAG_KICK3       = 1500.0  # E3 강한 좌우 킥. 약하면 ↑ (좌우 교대라 올려도 스핀 위험 낮음)

FOLLOW_EGO        = True      # v3: 메인 창(spectator)을 ego 뒤에서 따라가게(참가자가 이 창을 봄).
                              #     이벤트 중엔 아래 VIEW_SHAKE 로 시점을 좌우로 흔든다.

# ── 시점 좌우 흔들림(수막현상): 메인 창(spectator)은 free-cam 이라 '차 물리'로는 안 흔들림.
#    → 카메라 시점(yaw)을 직접 좌우로 왕복시켜 '휘청' 연출. 차에 안 닿으니 충돌/스핀 위험 0.
#    ▶▶ 약하면 VIEW_SHAKE_AMP(3) ↑ (진폭, 도). 더 빠른 떨림은 VIEW_SHAKE_FREQ ↑.
VIEW_SHAKE_ENABLE = True
VIEW_SHAKE_FREQ   = 1.5       # 좌우 왕복 주파수 [Hz]
VIEW_SHAKE_AMP    = 20.0      # E1·E2 시점 좌우 진폭 [deg] — v4: 8→20 (확실히 보이게 강제)
VIEW_SHAKE_AMP3   = 30.0      # E3 강한 시점 흔들림 [deg] — v4: 15→30
VIEW_SHAKE_DUR    = 3.0       # E1·E2 흔들림 지속 [s] — v4: 1.5→3.0
VIEW_SHAKE_DUR3   = 4.0       # E3 흔들림 지속 [s] — v4: 2.5→4.0

# ── (v6) 부착 RGB 카메라(3면 viewer) **강제** 흔들림 ─────────────────────────
#   문제: VIEW_SHAKE 는 메인 'spectator 창'의 yaw 만 흔든다. 하지만 참가자가 실제로 보는 건
#         ego 에 **부착된 RGB 카메라(3면 viewer)** → spectator 를 흔들어도 그 화면엔 안 보인다.
#         그리고 Rigid 부착 카메라는 **차체(ego)가 움직여야만** 같이 흔들린다.
#   해결: 이벤트 동안 ego transform 의 roll/pitch/yaw 를 매 틱 사인파로 직접 흔든다(set_transform).
#         · roll·pitch 는 autopilot 주행(=yaw·위치)을 **바꾸지 않으므로** 차선이탈/충돌 없이
#           '카메라만' 강하게 흔들린다 → 부착 카메라·spectator·3면 viewer **전부** 화면이 움직인다.
#         · 매 틱 '현재 실측 자세' 위에 사인 오프셋을 덧씌우므로(net≈0) 누적 드리프트 없음.
#   ▶▶ 약하면 ROLL/PITCH 진폭을 올린다(경로 영향 0, 마음껏 키워도 안전).
#      YAW 는 차가 실제로 weave 하므로(경로 영향 O) 작게 유지(차선이탈 방지).
FORCE_EGO_VIEW_SHAKE = True   # ⚑ 부착 카메라 화면을 강제로 흔드는 정본 토글
EGO_SHAKE_ROLL   = 2.5    # E1·E2 좌우 기울임[deg] — 부착 카메라에 가장 강하게 보임(경로 영향 X)
EGO_SHAKE_PITCH  = 1.5    # E1·E2 앞뒤 끄덕임[deg] (경로 영향 X)
EGO_SHAKE_YAW    = 0.75   # E1·E2 차머리 weave[deg] — 작게(경로 영향 O)
EGO_SHAKE_ROLL3  = 4.0    # E3 강한 이벤트 — 더 크게
EGO_SHAKE_PITCH3 = 2.5
EGO_SHAKE_YAW3   = 1.25
TRAFFIC_N         = 16 if FALLBACK_TRAFFIC else 28   # 기본=가설(28). FALLBACK_TRAFFIC=True 면 16(개활 유지).
#   v32: 40→28 (충돌·GPU 부하↓, 사용자 '사고 많이 남'). 군집+recycle 로 가시성 유지.


# ================================================================
# CARLA 연결
# ================================================================
def setup_carla(town, delta):
    client = carla.Client('localhost', 2000)
    client.set_timeout(60.0)
    world = client.get_world()
    if world.get_map().name.split('/')[-1] != town:
        world = client.load_world(town)

    settings = world.get_settings()
    settings.synchronous_mode = False
    settings.fixed_delta_seconds = None
    world.apply_settings(settings)
    for a in world.get_actors().filter('vehicle.*'): a.destroy()
    for a in world.get_actors().filter('sensor.*'):  a.destroy()

    settings.synchronous_mode = True
    settings.fixed_delta_seconds = delta
    world.apply_settings(settings)

    apply_lightweight_settings(world)

    tm = client.get_trafficmanager(8000)
    tm.set_synchronous_mode(True)
    tm.set_random_device_seed(SEED)   # 재현성: TM 내부 난수(차선변경/갭) 고정(분석계획 §5)
    # v32: 차간 거리 확보 — 고속 빗길에서 NPC 추돌(사고) 감소(사용자 '사고 많이 남').
    try:
        tm.set_global_distance_to_leading_vehicle(4.0)
    except Exception:
        pass
    return client, world, tm


def disable_sync(world, tm):
    s = world.get_settings()
    s.synchronous_mode = False
    s.fixed_delta_seconds = None
    world.apply_settings(s)
    tm.set_synchronous_mode(False)


def set_rainy_weather(world):
    """폭우 + 노면 만수 (수막현상 환경). 강수량은 맵 weather 로 설정."""
    world.set_weather(carla.WeatherParameters(
        cloudiness=100.0,
        precipitation=100.0,          # v10: 폭우 (강수량 최대)
        precipitation_deposits=100.0, # 노면 물 고임 최대
        wind_intensity=40.0,
        sun_azimuth_angle=0.0,
        sun_altitude_angle=-15.0,
        fog_density=7.0,
        fog_distance=40.0,
        fog_falloff=1.0,
        wetness=100.0,                # v10: 노면 젖음 최대
    ))


def update_spectator(spectator, ego, yaw_shake=0.0):
    tf      = ego.get_transform()
    loc     = tf.location
    yaw_rad = math.radians(tf.rotation.yaw)
    spectator.set_transform(carla.Transform(
        carla.Location(
            x=loc.x - 15.0 * math.cos(yaw_rad),
            y=loc.y - 15.0 * math.sin(yaw_rad),
            z=7.0),
        carla.Rotation(pitch=-12.0, yaw=tf.rotation.yaw + yaw_shake)))  # yaw_shake=이벤트 중 좌우 흔들림[deg]


def get_speed_kmh(actor):
    v = actor.get_velocity()
    return 3.6 * math.sqrt(v.x**2 + v.y**2 + v.z**2)
# v30: 마찰↓ 방식 폐기 — 주행 중 apply_physics_control 이 차량 물리를 리셋해
#      "이벤트에서 차가 갑자기 멈춤"을 유발했음. 슬라이드는 임펄스+yaw킥으로 대체.


# ================================================================
# 메인
# ================================================================
def main():
    random.seed(SEED)   # 재현성: 전역 random 고정(분석계획 §5). 모든 스폰보다 먼저.
    print(f'[Main] 재현성 시드 고정: SEED={SEED} (random + TrafficManager)')
    client, world, tm = setup_carla(TOWN, SIM_DELTA)
    set_rainy_weather(world)

    # v21: 합성 신호 시간축을 실제 송신 주기(SIM_DELTA)에 맞춤.
    #   udp_sender 가 import 시 1/25(0.04)로 set_dt 하지만 실제 tick 은 SIM_DELTA(0.05).
    #   불일치 시 버즈가 코드값보다 ~20% 느리게 재생됨 → 여기서 실제 주기로 교정.
    set_motion_dt(SIM_DELTA)

    bp_lib    = world.get_blueprint_library()
    carla_map = world.get_map()

    # ── ego ───────────────────────────────────────────────────
    ego_bp = bp_lib.find('vehicle.tesla.model3')
    ego_bp.set_attribute('role_name', 'hero')
    if ego_bp.has_attribute('color'):
        ego_bp.set_attribute('color', '255,255,255')

    sx, sy = EGO_SPAWN
    ego_wp = carla_map.get_waypoint(
        carla.Location(x=sx, y=sy, z=0),
        project_to_road=True,
        lane_type=carla.LaneType.Driving)

    if not ego_wp:
        print('[Main] ego waypoint 없음'); disable_sync(world, tm); return

    ego_tf = ego_wp.transform
    ego_tf.location.z += 0.5
    ego = world.try_spawn_actor(ego_bp, ego_tf)
    if not ego:
        print('[Main] ego 스폰 실패'); disable_sync(world, tm); return

    # autopilot 으로 그냥 도로 따라 달리기
    ego.set_autopilot(True, tm.get_port())
    tm.ignore_lights_percentage(ego, 100)
    tm.ignore_signs_percentage(ego, 100)
    tm.auto_lane_change(ego, False)
    # 최대속도 주행 — 제한속도 대비 EGO_SPEED_OVER% (음수 = 초과)
    tm.vehicle_percentage_speed_difference(ego, EGO_SPEED_OVER)
    # 2026-06-19: 종료부 추돌(고속·빗길 앞차 추돌, brake=1·v=0·차선중앙) 방지 — ego 추종거리 확보.
    #   전역 4m 는 +50% 고속에서 정지거리 부족 → ego 만 넉넉히(일찍 감속, 추돌 대신 안전 정지).
    try:
        tm.distance_to_leading_vehicle(ego, 15.0)
    except Exception:
        pass

    # spawn된 액터 안정화 1tick
    world.tick()

    # 시각적 슬라이드용 차량 질량 (측면 임펄스 계산)
    try:
        ego_mass = ego.get_physics_control().mass
    except Exception:
        ego_mass = 1850.0

    # 평소 주변 트래픽 (정상주행 현실성, #5)
    # v31: Town04 전역 랜덤 스폰이면 고속 ego 주변에 차가 거의 안 보임(carlaplay 재생 시 '트래픽 없음').
    #   ego 근처(near_radius)에 우선 군집 스폰 + 루프에서 뒤로 멀어진 차를 앞으로 재배치(recycle)해
    #   정상주행 내내 주변 트래픽이 보이도록 함.
    npcs = spawn_ambient_traffic(world, tm, n=TRAFFIC_N, ego=ego,
                                 seed=SEED,                              # 재현성: 스폰포인트/blueprint 결정론화
                                 near_ego_first=True, near_radius=350.0)  # v32: 250→350 (덜 조밀=충돌↓)

    print(f'[Ego] 스폰 완료  최대속도 주행(제한 {EGO_SPEED_OVER:+.0f}%), 폭우 주행 시작')

    # 3면 viewer 자동 실행
    launch_viewer_bat()

    # HMI 오버레이 자동 실행 — viewer 중앙 상단 640x480 (DiL 직접 표시, SKIP_HMI=1 로 끔)
    launch_hmi()

    # 6DOF 송신 백그라운드 시작 (+ HDMap 웹 뷰어용 ws 서버도 함께 시작)
    run_collector(world, ego, background=True)

    # HDMap 웹 뷰어 자동 오픈 — Town 맵 위에 차량 위치 표시 (자동 연결)
    launch_map(town=TOWN)

    # 실험상황 모니터(ws_monitor) 자동 오픈 — 연구자 화면 (위치+6DOF+이벤트, #7)
    launch_monitor()

    # ── 라이브 맵 게이팅: 시나리오 시작 신호 (scenario_runtime/started) ──
    #   HCI 인터페이스(App.jsx)가 이 신호의 map 으로 map_live iframe 을 Town04 로 전환한다.
    publish_event('scenario_runtime', {
        'scenario': 'anxiety', 'scenario_id': 'puddle',
        'map': 'Town04', 'status': 'started',
    })
    print('[Main] scenario_runtime started 발행 (anxiety/puddle/Town04)')

    # ── 메인 루프 ─────────────────────────────────────────────
    spectator      = world.get_spectator()
    print(f'[VIEW] ===== v6 활성 — spectator 추적(±{VIEW_SHAKE_AMP:.0f}°/±{VIEW_SHAKE_AMP3:.0f}°) '
          f'+ 부착카메라 강제흔들림 FORCE_EGO_VIEW_SHAKE={FORCE_EGO_VIEW_SHAKE} '
          f'(E1·E2 roll±{EGO_SHAKE_ROLL:.0f}°/pitch±{EGO_SHAKE_PITCH:.0f}°, '
          f'E3 roll±{EGO_SHAKE_ROLL3:.0f}°/pitch±{EGO_SHAKE_PITCH3:.0f}°) =====')
    if not FOLLOW_EGO:
        print('[VIEW] ⚠️ FOLLOW_EGO=False — 메인 창이 ego 를 안 따라가 흔들림이 안 보입니다! True 로 바꾸세요.')
    start          = time.time()
    # ── 실시간 페이싱 (sim 배속/슬로모 방지) — C1(frustration)에서 이식(2026-06-18) ──
    #   동기 모드라 world.tick() 은 서버 계산이 끝나는 즉시 반환한다. 기존 `time.sleep(SIM_DELTA)`
    #   는 틱 계산시간을 고려하지 않아 (틱<delta 면 배속, 틱>delta 면 누적 슬로모) sim 이 실시간과
    #   어긋났다. 매 루프를 SIM_DELTA wall-clock 으로 맞춰 1.0× 실시간으로 돌린다(모션 스텝 균일).
    #   2026-06-19: SIM_DELTA=1/26(실시간) 적용 — 0.025(40Hz)는 틱(~38ms)이 못 따라가 0.71× 슬로모였음.
    _pace_next     = time.perf_counter()
    last_log       = -999.0
    e1_fired       = False     # 이벤트1 (갑작스러운 수막현상 — 흔들림 2초)
    e2_fired       = False     # 이벤트2 (갑작스러운 수막현상 — 흔들림 2초)
    e3_fired       = False     # v31: 이벤트3 (정상주행 ~190s 후 강한 수막현상)
    slide_until    = -1.0      # 시각적 슬라이드 종료 시각 (#5)
    slide_dir      = 1
    slide_dur_cur  = SLIDE_DUR    # v31: 이벤트별 슬라이드 강도(E3 = 강화)
    slide_accel_cur= SLIDE_ACCEL
    slide_yaw_wag_cur = YAW_WAG_KICK     # 이벤트별 좌우 킥 세기(E3 = 강화)
    wag_next_t     = -1.0                # 다음 좌우 킥 시각
    wag_sign       = 1                   # 좌우 번갈아: +1 / −1
    shake_until    = -1.0                # 시점 좌우 흔들림 종료 시각
    shake_dur_cur  = VIEW_SHAKE_DUR      # 이벤트별 흔들림 길이
    view_shake_amp_cur = VIEW_SHAKE_AMP  # 이벤트별 흔들림 진폭(E3 = 강화)
    # (v6) 부착 카메라 강제 흔들림 — 이벤트별 진폭(E3 = 강화)
    ego_shake_roll_cur  = EGO_SHAKE_ROLL
    ego_shake_pitch_cur = EGO_SHAKE_PITCH
    ego_shake_yaw_cur   = EGO_SHAKE_YAW
    last_recycle   = -999.0    # v31: 트래픽 전방 재배치 타이머

    # ── 충돌 센서 (관측성, 2026-06-19) ── Puddle 엔 없었음 → 충돌을 못 보고 'clean' 오판한 적 있음.
    #   충돌 시각·상대·속도를 콘솔/이벤트로 남긴다(검증용).
    _collisions = []
    col_sensor = None
    try:
        _col_bp = bp_lib.find('sensor.other.collision')
        col_sensor = world.spawn_actor(_col_bp, carla.Transform(), attach_to=ego)
        def _on_collision(ev):
            other = getattr(getattr(ev, 'other_actor', None), 'type_id', '?')
            spd = get_speed_kmh(ego); tnow = time.time() - start
            _collisions.append((round(tnow, 1), other, round(spd, 1)))
            print(f'[COLLISION] t={tnow:.0f}s  vs {other}  ego={spd:.0f}km/h')
            try:
                publish_event('scenario_event', {'scenario': 'aquaplaning', 'event': 'collision',
                              't_sim': round(tnow, 2),
                              'payload': {'other': other, 'current_kmh': round(spd, 1)}})
            except Exception:
                pass
        col_sensor.listen(_on_collision)
    except Exception as e:
        print(f'[Main] 충돌 센서 부착 실패(무시): {e}')

    print(f'[Main] 이벤트 스케줄: '
          f'{EVENT1_TIME_S:.0f}s Case{EVENT1_CASE}(떨림{EVENT1_DUR:.0f}s) / '
          f'{EVENT2_TIME_S:.0f}s Case{EVENT2_CASE}(떨림{EVENT2_DUR:.0f}s'
          f'{"+단발슬립" if EVENT2_SLIP else ""}) / '
          f'{EVENT3_TIME_S:.0f}s Case{EVENT3_CASE} 강한이벤트(떨림{EVENT3_DUR:.0f}s+강한슬라이드)')

    try:
        while time.time() - start < SCENARIO_DURATION:
            elapsed = time.time() - start

            if not ego.is_alive:
                print('[Loop] ego 소멸'); break

            # 이벤트1: 갑작스러운 수막현상 (떨림 + 슬립 + 시각 슬라이드)
            if not e1_fired and elapsed >= EVENT1_TIME_S:
                trigger_event(case=EVENT1_CASE, duration=EVENT1_DUR,
                              slip=EVENT1_SLIP, slip_dir=EVENT1_SLIP_DIR)
                if SLIDE_ENABLE:
                    slide_until = elapsed + SLIDE_DUR; slide_dir = EVENT1_SLIP_DIR
                    slide_dur_cur = SLIDE_DUR; slide_accel_cur = SLIDE_ACCEL
                    slide_yaw_wag_cur = YAW_WAG_KICK     # 좌우 킥 세기(E1)
                    wag_next_t = elapsed; wag_sign = EVENT1_SLIP_DIR   # 즉시 좌우 흔들림 시작
                    ego.add_angular_impulse(carla.Vector3D(0, 0, SLIDE_YAW_KICK * slide_dir))  # 피시테일 킥
                if VIEW_SHAKE_ENABLE:
                    shake_until = elapsed + VIEW_SHAKE_DUR
                    shake_dur_cur = VIEW_SHAKE_DUR; view_shake_amp_cur = VIEW_SHAKE_AMP   # 시점 좌우 흔들림(E1)
                    ego_shake_roll_cur = EGO_SHAKE_ROLL; ego_shake_pitch_cur = EGO_SHAKE_PITCH; ego_shake_yaw_cur = EGO_SHAKE_YAW   # (v6) 부착카메라 강제흔들림(E1)
                    print(f'[VIEW] t={elapsed:.0f}s  E1 좌우 흔들림 시작 (±{VIEW_SHAKE_AMP:.0f}°, {VIEW_SHAKE_DUR:.0f}s)')
                publish_event('scenario_event', {
                    'scenario': 'aquaplaning', 'event': 'puddle_enter', 'terrain': EVENT1_TERRAIN,
                    'n': 1, 't_sim': round(elapsed, 2), 'case': EVENT1_CASE,
                    'payload': {'recommended_kmh': 40, 'current_kmh': round(get_speed_kmh(ego), 1),
                                'terrain': EVENT1_TERRAIN,
                                'Nsec_to_recover': round(EVENT1_DUR)}})
                print(f'[Event1] t={elapsed:.0f}s  Case{EVENT1_CASE} 떨림{EVENT1_DUR:.0f}s'
                      f'{" +슬라이드" if SLIDE_ENABLE else ""}')
                e1_fired = True

            # 이벤트2: 떨림 + 슬립 + 시각 슬라이드 (반대 방향)
            if not e2_fired and elapsed >= EVENT2_TIME_S:
                trigger_event(case=EVENT2_CASE, duration=EVENT2_DUR,
                              slip=EVENT2_SLIP, slip_dir=EVENT2_SLIP_DIR)
                if SLIDE_ENABLE:
                    slide_until = elapsed + SLIDE_DUR; slide_dir = EVENT2_SLIP_DIR
                    slide_dur_cur = SLIDE_DUR; slide_accel_cur = SLIDE_ACCEL
                    slide_yaw_wag_cur = YAW_WAG_KICK     # 좌우 킥 세기(E2)
                    wag_next_t = elapsed; wag_sign = EVENT2_SLIP_DIR   # 즉시 좌우 흔들림 시작
                    ego.add_angular_impulse(carla.Vector3D(0, 0, SLIDE_YAW_KICK * slide_dir))  # 피시테일 킥
                if VIEW_SHAKE_ENABLE:
                    shake_until = elapsed + VIEW_SHAKE_DUR
                    shake_dur_cur = VIEW_SHAKE_DUR; view_shake_amp_cur = VIEW_SHAKE_AMP   # 시점 좌우 흔들림(E2)
                    ego_shake_roll_cur = EGO_SHAKE_ROLL; ego_shake_pitch_cur = EGO_SHAKE_PITCH; ego_shake_yaw_cur = EGO_SHAKE_YAW   # (v6) 부착카메라 강제흔들림(E2)
                    print(f'[VIEW] t={elapsed:.0f}s  E2 좌우 흔들림 시작 (±{VIEW_SHAKE_AMP:.0f}°, {VIEW_SHAKE_DUR:.0f}s)')
                publish_event('scenario_event', {
                    'scenario': 'aquaplaning', 'event': 'puddle_enter', 'terrain': EVENT2_TERRAIN,
                    'n': 2, 't_sim': round(elapsed, 2), 'case': EVENT2_CASE,
                    'payload': {'recommended_kmh': 40, 'current_kmh': round(get_speed_kmh(ego), 1),
                                'terrain': EVENT2_TERRAIN,
                                'Nsec_to_recover': round(EVENT2_DUR)}})
                print(f'[Event2] t={elapsed:.0f}s  Case{EVENT2_CASE} 떨림{EVENT2_DUR:.0f}s'
                      f'{" +슬라이드" if SLIDE_ENABLE else ""}')
                e2_fired = True

            # 이벤트3 (v31): 정상주행 ~190s 후 **강한** 수막현상 — 긴 떨림(case 3) + 강한 슬라이드
            if not e3_fired and elapsed >= EVENT3_TIME_S:
                trigger_event(case=EVENT3_CASE, duration=EVENT3_DUR,
                              slip=EVENT3_SLIP, slip_dir=EVENT3_SLIP_DIR)
                if SLIDE_ENABLE:
                    slide_until = elapsed + SLIDE_DUR3; slide_dir = EVENT3_SLIP_DIR
                    slide_dur_cur = SLIDE_DUR3; slide_accel_cur = SLIDE_ACCEL3
                    slide_yaw_wag_cur = YAW_WAG_KICK3    # 좌우 킥 세기(E3 강화)
                    wag_next_t = elapsed; wag_sign = EVENT3_SLIP_DIR   # 즉시 강한 좌우 흔들림 시작
                    ego.add_angular_impulse(carla.Vector3D(0, 0, SLIDE_YAW_KICK3 * slide_dir))  # 강한 피시테일
                if VIEW_SHAKE_ENABLE:
                    shake_until = elapsed + VIEW_SHAKE_DUR3
                    shake_dur_cur = VIEW_SHAKE_DUR3; view_shake_amp_cur = VIEW_SHAKE_AMP3   # 강한 시점 흔들림(E3)
                    ego_shake_roll_cur = EGO_SHAKE_ROLL3; ego_shake_pitch_cur = EGO_SHAKE_PITCH3; ego_shake_yaw_cur = EGO_SHAKE_YAW3   # (v6) 부착카메라 강제흔들림(E3 강화)
                    print(f'[VIEW] t={elapsed:.0f}s  E3 강한 좌우 흔들림 시작 (±{VIEW_SHAKE_AMP3:.0f}°, {VIEW_SHAKE_DUR3:.0f}s)')
                publish_event('scenario_event', {
                    'scenario': 'aquaplaning', 'event': 'puddle_enter', 'strong': True,
                    'terrain': EVENT3_TERRAIN,
                    'n': 3, 't_sim': round(elapsed, 2), 'case': EVENT3_CASE,
                    'payload': {'recommended_kmh': 40, 'current_kmh': round(get_speed_kmh(ego), 1),
                                'terrain': EVENT3_TERRAIN,
                                'Nsec_to_recover': round(EVENT3_DUR)}})
                print(f'[Event3] t={elapsed:.0f}s  강한 이벤트 Case{EVENT3_CASE} '
                      f'떨림{EVENT3_DUR:.0f}s + 강한 슬라이드')
                e3_fired = True

            # 5초마다 상태 로그
            if elapsed - last_log >= 5.0:
                last_log = elapsed
                spd = get_speed_kmh(ego)
                print(f'[t={elapsed:.0f}s] ego={spd:.1f} km/h')

            # 시각적 수막 슬라이드: 측면 임펄스(감쇠) → 차가 옆으로 미끄러짐 (멈춤 없음, v30)
            #   v31: 이벤트별 강도(slide_dur_cur/slide_accel_cur) — E3 는 더 길고 강하게.
            if SLIDE_ENABLE and elapsed < slide_until and ego.is_alive:
                frac = max(0.0, (slide_until - elapsed) / slide_dur_cur)   # 1→0 감쇠
                rv = ego.get_transform().get_right_vector()
                j  = ego_mass * slide_accel_cur * frac * SIM_DELTA * slide_dir
                ego.add_impulse(carla.Vector3D(rv.x * j, rv.y * j, rv.z * j))
                # 좌우 흔들림: 차머리(yaw)를 좌→우 번갈아 '킥' → ego 뷰가 좌우로 흔들림(수막현상).
                #   기존 단발 킥(500)과 같은 단위(SIM_DELTA·frequency 로 안 깎음)라 고속에서도 확실히 보임.
                #   좌우 교대(wag_sign 반전)라 net 회전이 상쇄돼 스핀/이탈 위험은 낮음. frac 으로 끝에 감쇠.
                if YAW_WAG_ENABLE and elapsed >= wag_next_t:
                    ego.add_angular_impulse(
                        carla.Vector3D(0, 0, slide_yaw_wag_cur * frac * wag_sign))
                    wag_sign   = -wag_sign                       # 다음엔 반대 방향
                    wag_next_t = elapsed + YAW_WAG_HALF_PERIOD

            # v31/32: 고속 직선주행에서 주변 트래픽 유지 — 뒤로 멀어진(시야 밖) 차를 ego 앞으로 재배치.
            #   v32: 충돌 방지를 위해 빈도↓(6s) + 안전 재배치(목표 주변 차 있으면 skip, 교통속도로 합류).
            if elapsed - last_recycle >= 6.0:
                last_recycle = elapsed
                # 재현성: 호출마다 시드를 시드된 전역 random 에서 뽑는다 → 런 간 결정론(같은 시퀀스)이되
                #   호출마다 값은 달라져(within-run 변동) 기존 거동 보존. 상수 시드 직접 전달은 매 호출
                #   동일 재배치가 되어 거동이 바뀌므로 피한다.
                recycle_traffic_ahead(world, tm, npcs, ego,
                                      seed=random.randint(0, 2**31 - 1))

            if FOLLOW_EGO:
                # 이벤트 중엔 시점 yaw 를 사인파로 좌우 왕복 → 메인 창이 좌우로 흔들림(수막현상 휘청).
                view_shake = 0.0
                if VIEW_SHAKE_ENABLE and elapsed < shake_until:
                    f    = max(0.0, (shake_until - elapsed) / shake_dur_cur)   # 1→0 감쇠
                    t_in = shake_dur_cur - (shake_until - elapsed)             # 시작부터 경과 [s]
                    view_shake = view_shake_amp_cur * f * math.sin(2.0 * math.pi * VIEW_SHAKE_FREQ * t_in)
                update_spectator(spectator, ego, view_shake)

            # ── (v6) 부착 RGB 카메라(3면 viewer) 강제 흔들림 ──────────────────────
            #   이벤트 동안 ego transform 의 roll/pitch/yaw 를 매 틱 사인 오프셋으로 흔든다.
            #   '현재 실측 자세' 위에 덧씌우고 world.tick() '직전'에 set_transform → 부착 카메라가
            #   이번 틱에 흔들린 자세로 캡처된다(spectator·3면 viewer 모두 화면이 움직임).
            #   roll·pitch 는 경로(autopilot=yaw·위치)를 안 바꿔 충돌/차선이탈 없이 '카메라만' 흔들림.
            if (FORCE_EGO_VIEW_SHAKE and VIEW_SHAKE_ENABLE
                    and elapsed < shake_until and ego.is_alive):
                fz    = max(0.0, (shake_until - elapsed) / shake_dur_cur)   # 1→0 감쇠
                ti    = shake_dur_cur - (shake_until - elapsed)            # 시작부터 경과 [s]
                w     = 2.0 * math.pi * VIEW_SHAKE_FREQ
                roll_off  = ego_shake_roll_cur  * fz * math.sin(w * ti)
                pitch_off = ego_shake_pitch_cur * fz * math.sin(w * ti * 1.7 + 1.1)
                yaw_off   = ego_shake_yaw_cur   * fz * math.sin(w * ti * 0.9 + 0.5)
                stf = ego.get_transform()
                stf.rotation.roll  += roll_off
                stf.rotation.pitch += pitch_off
                stf.rotation.yaw   += yaw_off
                ego.set_transform(stf)        # ← 매 틱 강제로 차체(=부착 카메라) 자세를 흔든다

            world.tick()

            # ── 실시간 페이싱: 이번 틱이 SIM_DELTA wall-clock 을 채우도록 대기 ──
            #   서버가 빨라 일찍 끝나면 남는 시간만큼 sleep → sim 1.0× 실시간.
            #   틱이 SIM_DELTA 를 넘기면 sleep 없이 기준시계만 리셋(지연 누적 방지).
            _pace_next += SIM_DELTA
            _pace_sleep = _pace_next - time.perf_counter()
            if _pace_sleep > 0:
                time.sleep(_pace_sleep)
            else:
                _pace_next = time.perf_counter()

    except KeyboardInterrupt:
        print('\n사용자 중단')

    finally:
        # ── 라이브 맵 게이팅: 시나리오 종료 신호 (scenario_runtime/stopped) ──
        #   WS 서버(collector)를 내리기 '전에' 먼저 발행해야 인터페이스가 신호를 받는다.
        try:
            publish_event('scenario_runtime', {
                'scenario': 'anxiety', 'scenario_id': 'puddle',
                'map': 'Town04', 'status': 'stopped',
            })
            print('[Main] scenario_runtime stopped 발행')
        except Exception:
            pass

        # 충돌 결과 리포트(관측성) + 센서 정리
        try:
            if _collisions:
                print(f'[Result] ⚠️ 충돌 {len(_collisions)}회 — {_collisions}')
            else:
                print('[Result] 충돌 0회 ✓')
            if col_sensor is not None and col_sensor.is_alive:
                col_sensor.stop(); col_sensor.destroy()
        except Exception:
            pass
        stop_collector()
        destroy_traffic(npcs)
        if ego.is_alive:
            ego.set_autopilot(False); ego.destroy()
        disable_sync(world, tm)
        print('종료')


if __name__ == '__main__':
    main()
