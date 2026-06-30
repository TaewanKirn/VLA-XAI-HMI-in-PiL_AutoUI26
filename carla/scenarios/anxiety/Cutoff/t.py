import carla
import math
import time

# =================================================================
# 시나리오 설정
# =================================================================
TOWN              = 'Town04'
SCENARIO_DURATION = 120.0
SIM_DELTA         = 0.05
EGO_SPAWN         = (10.0, -180.0)
EGO_SPEED_KMH     = 60.0
NPC_SPAWN_OFFSET_X = -30.0   # ego 기준 뒤쪽 (m)
NPC_SPAWN_OFFSET_Y =  4.0    # 옆 차선 (m)
NPC_SPEED_KMH      = 80.0    # NPC는 ego보다 빠르게 접근
CUTOFF_TIME        = 20.0    # 시작 후 N초 뒤 끼어들기 발생
CUTOFF_FRONT_DIST  = 5.0     # ego 앞 N미터에 NPC 이동 후 정지 (가까울수록 급정거 강도 ↑)
FOLLOW_EGO         = True

# =================================================================
# CARLA 연결
# =================================================================
def setup_carla(town, delta):
    client = carla.Client('localhost', 2000)
    client.set_timeout(60.0)
    world = client.get_world()
    if world.get_map().name.split('/')[-1] != town:
        print(f'[Setup] {town} 로드 중...')
        world = client.load_world(town)
    else:
        print(f'[Setup] {town} 이미 로드됨')

    settings = world.get_settings()
    settings.synchronous_mode = False
    settings.fixed_delta_seconds = None
    world.apply_settings(settings)
    
    for actor in world.get_actors().filter('vehicle.*'):
        actor.destroy()
    for actor in world.get_actors().filter('sensor.*'):
        actor.destroy()

    settings.synchronous_mode = True
    settings.fixed_delta_seconds = delta
    world.apply_settings(settings)

    tm = client.get_trafficmanager(8000)
    tm.set_synchronous_mode(True)
    return client, world, tm

def disable_sync(world, tm):
    settings = world.get_settings()
    settings.synchronous_mode = False
    settings.fixed_delta_seconds = None
    world.apply_settings(settings)
    tm.set_synchronous_mode(False)

# =================================================================
# 날씨
# =================================================================
def set_clear_weather(world):
    world.set_weather(carla.WeatherParameters.ClearNoon)
    print('[Weather] 맑은 날씨 적용')

# =================================================================
# 카메라
# =================================================================
def update_spectator(spectator, ego):
    tf      = ego.get_transform()
    loc     = tf.location
    yaw_rad = math.radians(tf.rotation.yaw)
    cam_x   = loc.x - 12.0 * math.cos(yaw_rad)
    cam_y   = loc.y - 12.0 * math.sin(yaw_rad)
    spectator.set_transform(carla.Transform(
        carla.Location(x=cam_x, y=cam_y, z=6.0),
        carla.Rotation(pitch=-10.0, yaw=tf.rotation.yaw)))

# =================================================================
# 끼어들기 & 급정거
# =================================================================
def do_cutoff(npc, ego, world, tm, front_dist):
    ego_tf  = ego.get_transform()
    ego_loc = ego_tf.location
    yaw_rad = math.radians(ego_tf.rotation.yaw)
    
    # 목표 위치: ego 정면 앞쪽
    target_x = ego_loc.x + front_dist * math.cos(yaw_rad)
    target_y = ego_loc.y + front_dist * math.sin(yaw_rad)

    wp = world.get_map().get_waypoint(
        carla.Location(x=target_x, y=target_y, z=0),
        project_to_road=True,
        lane_type=carla.LaneType.Driving)

    if wp:
        new_tf = wp.transform
        new_tf.location.z += 0.5
        npc.set_transform(new_tf)
    else:
        npc.set_transform(carla.Transform(
            carla.Location(x=target_x, y=target_y, z=ego_loc.z + 0.5),
            ego_tf.rotation))
            
    # TM 제어 해제 후 즉시 100% 브레이크 적용 → 정지 상태 유지
    npc.set_autopilot(False, tm.get_port())
    npc.apply_control(carla.VehicleControl(throttle=0.0, brake=1.0, steer=0.0))
    
    print(f'[Cutoff] NPC 이동 후 급정거 → ego 앞 {front_dist}m '
          f'({npc.get_location().x:.1f}, {npc.get_location().y:.1f})')

# =================================================================
# 메인
# =================================================================
def main():
    client, world, tm = setup_carla(TOWN, SIM_DELTA)
    set_clear_weather(world)
    bp_lib    = world.get_blueprint_library()
    carla_map = world.get_map()

    # ego 스폰
    ego_bp = bp_lib.find('vehicle.tesla.model3')
    ego_bp.set_attribute('role_name', 'hero')
    if ego_bp.has_attribute('color'):
        ego_bp.set_attribute('color', '255,255,255')

    sx, sy = EGO_SPAWN
    ego_wp = carla_map.get_waypoint(
        carla.Location(x=sx, y=sy, z=0),
        project_to_road=True,
        lane_type=carla.LaneType.Driving)

    if ego_wp is None:
        print('[Main] ego 스폰 waypoint 없음')
        disable_sync(world, tm)
        return

    ego_tf = ego_wp.transform
    ego_tf.location.z += 0.5
    ego = world.try_spawn_actor(ego_bp, ego_tf)
    if ego is None:
        print('[Main] ego 스폰 실패')
        disable_sync(world, tm)
        return

    print(f'[Main] ego 스폰: ({ego_tf.location.x:.1f}, {ego_tf.location.y:.1f})')

    ego.set_autopilot(True, tm.get_port())
    tm.ignore_lights_percentage(ego, 100)
    tm.ignore_signs_percentage(ego, 100)
    tm.auto_lane_change(ego, False)
    tm.distance_to_leading_vehicle(ego, 3.0)
    ego_speed_diff = (90.0 - EGO_SPEED_KMH) / 90.0 * 100.0
    tm.vehicle_percentage_speed_difference(ego, ego_speed_diff)

    # NPC 스폰 (ego 뒤쪽 옆 차선)
    npc_bp = bp_lib.find('vehicle.audi.a2')
    if npc_bp.has_attribute('color'):
        npc_bp.set_attribute('color', '255,0,0')

    yaw_rad = math.radians(ego_wp.transform.rotation.yaw) 
    npc_x   = ego_tf.location.x + NPC_SPAWN_OFFSET_X * math.cos(yaw_rad) - NPC_SPAWN_OFFSET_Y * math.sin(yaw_rad)
    npc_y   = ego_tf.location.y + NPC_SPAWN_OFFSET_X * math.sin(yaw_rad) + NPC_SPAWN_OFFSET_Y * math.cos(yaw_rad)

    npc_wp = carla_map.get_waypoint(
        carla.Location(x=npc_x, y=npc_y, z=0),
        project_to_road=True,
        lane_type=carla.LaneType.Driving)

    npc_spawn_tf = npc_wp.transform if npc_wp else ego_wp.transform
    npc_spawn_tf.location.z += 0.5
    npc = world.try_spawn_actor(npc_bp, npc_spawn_tf)

    if npc is None:
        print('[Main] NPC 스폰 실패 — 재시도')
        npc_spawn_tf.location.x += 5.0
        npc = world.try_spawn_actor(npc_bp, npc_spawn_tf)

    if npc is None:
        print('[Main] NPC 스폰 완전 실패')
        ego.destroy()
        disable_sync(world, tm)
        return

    print(f'[Main] NPC 스폰: ({npc_spawn_tf.location.x:.1f}, {npc_spawn_tf.location.y:.1f})')

    # NPC는 처음엔 TM으로 주행하다 컷오프 시점에서 정지
    npc.set_autopilot(True, tm.get_port())
    tm.ignore_lights_percentage(npc, 100)
    tm.ignore_signs_percentage(npc, 100)
    tm.auto_lane_change(npc, False)
    npc_speed_diff = (90.0 - NPC_SPEED_KMH) / 90.0 * 100.0
    tm.vehicle_percentage_speed_difference(npc, npc_speed_diff)

    spectator   = world.get_spectator()
    cutoff_done = False
    start       = time.time()

    print(f'[Main] 시나리오 시작 ({SCENARIO_DURATION}s)')
    print(f'  ego {EGO_SPEED_KMH}km/h  /  NPC {NPC_SPEED_KMH}km/h')
    print(f'  {CUTOFF_TIME}초 후 NPC 급정거 발생')

    try:
        while time.time() - start < SCENARIO_DURATION:
            elapsed = time.time() - start

            if ego.is_alive and npc.is_alive:
                if not cutoff_done and elapsed >= CUTOFF_TIME:
                    do_cutoff(npc, ego, world, tm, CUTOFF_FRONT_DIST)
                    cutoff_done = True
                    print(f'[Main] t={elapsed:.1f}s 끼어들기/급정거 완료')

                if FOLLOW_EGO:
                    update_spectator(spectator, ego)

            world.tick()
            time.sleep(SIM_DELTA)

            if int(elapsed) % 5 == 0 and elapsed - int(elapsed) < SIM_DELTA:
                if ego.is_alive:
                    ego_vel = ego.get_velocity()
                    ego_spd = 3.6 * math.sqrt(ego_vel.x**2 + ego_vel.y**2 + ego_vel.z**2)
                    ego_loc = ego.get_location()
                    npc_loc = npc.get_location() if npc.is_alive else ego_loc
                    dist    = ego_loc.distance(npc_loc)
                    npc_vel = npc.get_velocity() if npc.is_alive else None
                    npc_spd = 3.6 * math.sqrt(npc_vel.x**2 + npc_vel.y**2 + npc_vel.z**2) if npc_vel else 0.0
                    print(f'[t={elapsed:.0f}s] ego={ego_spd:.1f}km/h  npc={npc_spd:.1f}km/h  거리={dist:.1f}m  cutoff={cutoff_done}')

    except KeyboardInterrupt:
        print('\n[Main] 사용자 중단')

    finally:
        if ego.is_alive:
            ego.set_autopilot(False)
            ego.destroy()
        if npc.is_alive:
            npc.set_autopilot(False)
            npc.destroy()
        disable_sync(world, tm)
        print('[Main] 종료')

if __name__ == '__main__':
    main()