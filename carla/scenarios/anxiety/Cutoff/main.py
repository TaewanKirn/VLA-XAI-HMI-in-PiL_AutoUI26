import carla
import math
import time
import os
import sys

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

# 6DOF 프로파일 자동 선택: Cutoff 전용 프로파일 미정 → A(무상태·컴포트) 기본.
os.environ['SCENARIO'] = 'A'

from collector.carla_collector import run_collector, stop_collector
from perf import apply_lightweight_settings
from launch_viewer import launch_viewer_bat

# ================================================================
# 시나리오 설정
# ================================================================
TOWN              = 'Town04'
SCENARIO_DURATION = 120.0
SIM_DELTA         = 0.05

EGO_SPAWN         = (10.0, -180.0)
EGO_SPEED_KMH     = 70.0

# NPC: ego 뒤 멀리, 옆 차선에서 스폰
NPC_BEHIND_M      = 120.0   # ego 기준 뒤쪽 거리 (시야 밖)
NPC_SIDE_M        =   4.0   # 옆 차선 오프셋
NPC_SPEED_KMH     = 110.0   # ego보다 훨씬 빠르게

# 끼어들기 조건: NPC가 ego보다 이만큼 앞섰을 때 ego 차선으로 컷인
CUTIN_AHEAD_M     =  8.0    # NPC가 ego 전방 N m일 때 컷인 트리거
CUTIN_OFFSET_M    = 12.0    # 컷인 후 ego 앞 N m에 텔레포트

TTC_WARN          = 3.5
TTC_CRIT          = 1.5

FOLLOW_EGO        = False   # viewer.bat 3면 카메라가 화면 담당 → CARLA spectator 안 움직임


# ================================================================
# 단계
# ================================================================
class Phase:
    APPROACH = 'APPROACH'   # NPC 뒤에서 빠르게 접근 중
    CUTIN    = 'CUTIN'      # ego 앞 차선으로 끼어들기
    STOPPING = 'STOPPING'   # 풀 브레이크
    STOPPED  = 'STOPPED'    # 완전 정지


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
    return client, world, tm


def disable_sync(world, tm):
    s = world.get_settings()
    s.synchronous_mode = False
    s.fixed_delta_seconds = None
    world.apply_settings(s)
    tm.set_synchronous_mode(False)


def set_clear_weather(world):
    world.set_weather(carla.WeatherParameters.ClearNoon)


def update_spectator(spectator, ego):
    tf      = ego.get_transform()
    loc     = tf.location
    yaw_rad = math.radians(tf.rotation.yaw)
    spectator.set_transform(carla.Transform(
        carla.Location(
            x=loc.x - 15.0 * math.cos(yaw_rad),
            y=loc.y - 15.0 * math.sin(yaw_rad),
            z=7.0),
        carla.Rotation(pitch=-12.0, yaw=tf.rotation.yaw)))


# ================================================================
# 유틸
# ================================================================
def get_speed_kmh(actor):
    v = actor.get_velocity()
    return 3.6 * math.sqrt(v.x**2 + v.y**2 + v.z**2)


def signed_forward_dist(ego, npc):
    """
    ego 전방 방향으로 npc까지의 부호있는 거리.
    양수 = npc가 ego 앞 / 음수 = npc가 ego 뒤
    """
    ego_tf  = ego.get_transform()
    yaw_rad = math.radians(ego_tf.rotation.yaw)
    dx = npc.get_location().x - ego_tf.location.x
    dy = npc.get_location().y - ego_tf.location.y
    return dx * math.cos(yaw_rad) + dy * math.sin(yaw_rad)


def calc_ttc(ego, npc):
    dist    = ego.get_location().distance(npc.get_location())
    ego_vel = ego.get_velocity()
    npc_vel = npc.get_velocity()
    yaw_rad = math.radians(ego.get_transform().rotation.yaw)
    closing = (
        (ego_vel.x - npc_vel.x) * math.cos(yaw_rad) +
        (ego_vel.y - npc_vel.y) * math.sin(yaw_rad)
    )
    if closing <= 0.1:
        return None
    return dist / closing


# ================================================================
# 끼어들기: NPC를 ego 앞 같은 차선으로 텔레포트
# ================================================================
def do_cutin(npc, ego, world, tm, ahead_m):
    ego_tf  = ego.get_transform()
    yaw_rad = math.radians(ego_tf.rotation.yaw)
    tx = ego_tf.location.x + ahead_m * math.cos(yaw_rad)
    ty = ego_tf.location.y + ahead_m * math.sin(yaw_rad)

    wp = world.get_map().get_waypoint(
        carla.Location(x=tx, y=ty, z=0),
        project_to_road=True,
        lane_type=carla.LaneType.Driving)

    tf = wp.transform if wp else ego_tf
    tf.location.z += 0.5

    # 오토파일럿 끄고 텔레포트 → 즉시 급정지 시작
    npc.set_autopilot(False)
    npc.set_transform(tf)
    npc.apply_control(carla.VehicleControl(
        throttle=0.0, brake=1.0, hand_brake=False))

    print(f'[CutIn] NPC → ego 앞 {ahead_m}m 텔레포트 후 급정지 시작')


# ================================================================
# 메인
# ================================================================
def main():
    client, world, tm = setup_carla(TOWN, SIM_DELTA)
    set_clear_weather(world)

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

    ego.set_autopilot(True, tm.get_port())
    tm.ignore_lights_percentage(ego, 100)
    tm.ignore_signs_percentage(ego, 100)
    tm.auto_lane_change(ego, False)
    tm.distance_to_leading_vehicle(ego, 3.0)
    tm.vehicle_percentage_speed_difference(ego,
        (90.0 - EGO_SPEED_KMH) / 90.0 * 100.0)

    print(f'[Ego] 스폰 완료  {EGO_SPEED_KMH}km/h')

    # ── NPC: ego 뒤 멀리, 옆 차선 ─────────────────────────────
    npc_bp = bp_lib.find('vehicle.audi.tt')
    if npc_bp.has_attribute('color'):
        npc_bp.set_attribute('color', '220,40,40')

    yaw_rad = math.radians(ego_wp.transform.rotation.yaw)

    # 뒤쪽(-) + 옆 차선
    npc_x = ego_tf.location.x - NPC_BEHIND_M * math.cos(yaw_rad) \
                                - NPC_SIDE_M  * math.sin(yaw_rad)
    npc_y = ego_tf.location.y - NPC_BEHIND_M * math.sin(yaw_rad) \
                                + NPC_SIDE_M  * math.cos(yaw_rad)

    npc_wp = carla_map.get_waypoint(
        carla.Location(x=npc_x, y=npc_y, z=0),
        project_to_road=True,
        lane_type=carla.LaneType.Driving)

    if not npc_wp:
        print('[Main] NPC waypoint 없음'); ego.destroy(); disable_sync(world, tm); return

    npc_tf = npc_wp.transform
    npc_tf.location.z += 0.5
    npc = world.try_spawn_actor(npc_bp, npc_tf)
    if not npc:
        print('[Main] NPC 스폰 실패'); ego.destroy(); disable_sync(world, tm); return

    npc.set_autopilot(True, tm.get_port())
    tm.ignore_lights_percentage(npc, 100)
    tm.ignore_signs_percentage(npc, 100)
    tm.auto_lane_change(npc, False)   # 차선 변경은 수동으로 제어
    tm.vehicle_percentage_speed_difference(npc,
        (90.0 - NPC_SPEED_KMH) / 90.0 * 100.0)

    print(f'[NPC] 스폰 완료  ego 뒤 {NPC_BEHIND_M}m 옆 차선  {NPC_SPEED_KMH}km/h')

    # ── 루프 ──────────────────────────────────────────────────
    spectator  = world.get_spectator()
    phase      = Phase.APPROACH
    start      = time.time()
    last_log   = -999.0

    print(f'\n시나리오 시작')
    print(f'  NPC 가 ego를 추월한 뒤 앞에서 급정지')

    # 3면 viewer 자동 실행
    launch_viewer_bat()

    # 6DOF UDP 송신을 백그라운드 스레드로 시작
    run_collector(world, ego, background=True)

    try:
        while time.time() - start < SCENARIO_DURATION:
            elapsed = time.time() - start

            if not ego.is_alive or not npc.is_alive:
                print('[Loop] 차량 소멸'); break

            ego_spd = get_speed_kmh(ego)
            npc_spd = get_speed_kmh(npc)
            fwd_dist = signed_forward_dist(ego, npc)  # 양수=NPC가 앞

            # ── 단계 전환 ──────────────────────────────────────
            if phase == Phase.APPROACH:
                # NPC가 ego 전방 CUTIN_AHEAD_M 이상 앞서면 끼어들기
                if fwd_dist >= CUTIN_AHEAD_M:
                    phase = Phase.CUTIN
                    do_cutin(npc, ego, world, tm, CUTIN_OFFSET_M)
                    phase = Phase.STOPPING
                    print(f'[t={elapsed:.1f}s] Phase → STOPPING')

            elif phase == Phase.STOPPING:
                npc.apply_control(carla.VehicleControl(
                    throttle=0.0, brake=1.0, hand_brake=False))
                if npc_spd < 0.5:
                    phase = Phase.STOPPED
                    print(f'[t={elapsed:.1f}s] NPC 완전 정지')

            elif phase == Phase.STOPPED:
                npc.apply_control(carla.VehicleControl(
                    throttle=0.0, brake=1.0, hand_brake=True))

            # ── TTC ────────────────────────────────────────────
            ttc = calc_ttc(ego, npc) if phase in (Phase.STOPPING, Phase.STOPPED) else None
            if ttc is not None:
                if   ttc < TTC_CRIT: print(f'  !! CRITICAL TTC={ttc:.2f}s')
                elif ttc < TTC_WARN: print(f'  !  WARNING  TTC={ttc:.2f}s')

            # ego 브레이크 감지
            if phase in (Phase.STOPPING, Phase.STOPPED):
                ctrl = ego.get_control()
                if ctrl.brake > 0.3:
                    print(f'  >> ego 급제동 brake={ctrl.brake:.2f}  {ego_spd:.1f}km/h')

            # 5초 주기 로그
            if elapsed - last_log >= 5.0:
                last_log = elapsed
                dist = ego.get_location().distance(npc.get_location())
                print(f'[t={elapsed:.0f}s] ego={ego_spd:.1f}  npc={npc_spd:.1f}  '
                      f'fwd={fwd_dist:.1f}m  dist={dist:.1f}m  phase={phase}')

            if FOLLOW_EGO:
                update_spectator(spectator, ego)

            world.tick()
            time.sleep(SIM_DELTA)

    except KeyboardInterrupt:
        print('\n사용자 중단')

    finally:
        stop_collector()
        if ego.is_alive:
            ego.set_autopilot(False); ego.destroy()
        if npc.is_alive:
            npc.set_autopilot(False); npc.destroy()
        disable_sync(world, tm)
        print('종료')


if __name__ == '__main__':
    main()
