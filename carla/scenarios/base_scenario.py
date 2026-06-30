# base_scenario.py

import carla
import csv
import math
import os
import random
import time
from datetime import datetime

HOST    = 'localhost'
PORT    = 2000
TIMEOUT = 60.0
LOG_DIR = r'E:\CARLA_PROJECT\data\logs'


# ══════════════════════════════════════════════════════════
#  월드 초기화
# ══════════════════════════════════════════════════════════

def init_world(town, host=HOST, port=PORT,
               timeout=TIMEOUT, delta=0.05):
    client = carla.Client(host, port)
    client.set_timeout(timeout)
    print(f'[Init] {town} 로딩 중...')
    world = client.load_world(town)
    settings = world.get_settings()
    settings.synchronous_mode    = True
    settings.fixed_delta_seconds = delta
    world.apply_settings(settings)
    world.tick()
    print(f'[Init] Synchronous mode ON  |  delta={delta}s')
    return client, world


def disable_sync(world):
    settings = world.get_settings()
    settings.synchronous_mode    = False
    settings.fixed_delta_seconds = None
    world.apply_settings(settings)


def get_tm(client, port=8000):
    tm = client.get_trafficmanager(port)
    tm.set_synchronous_mode(True)
    return tm

# ══════════════════════════════════════════════════════════
#  스폰
# ══════════════════════════════════════════════════════════

def spawn_ego(world, world_map, spawn_tf=None, color='255,255,255'):
    bp = world.get_blueprint_library().find('vehicle.tesla.model3')
    bp.set_attribute('role_name', 'ego')
    bp.set_attribute('color', color)

    if spawn_tf is None:
        spawn_tf = _find_non_junction_spawn(world_map)

    actor = world.try_spawn_actor(bp, spawn_tf)
    if actor is None:
        actor = world.try_spawn_actor(bp, world_map.get_spawn_points()[0])
    if actor is None:
        raise RuntimeError('[Base] Ego 스폰 실패')

    print(f'[Init] Ego 스폰: {_fmt_loc(actor.get_location())}')
    return actor


def spawn_npc(world, world_map, location, z_offset=0.3):
    bp = _random_car_bp(world)
    wp = world_map.get_waypoint(location, project_to_road=True)
    if wp is None:
        return None
    tf = wp.transform
    tf.location.z += z_offset
    return world.try_spawn_actor(bp, tf)


def spawn_npcs_ahead(world, world_map, ego_location,
                     count, gap_m=12.0, start_m=12.0):
    ego_wp   = world_map.get_waypoint(ego_location)
    npc_list = []
    for i in range(count):
        bp   = _random_car_bp(world)
        dist = start_m + i * gap_m
        wp   = _advance_waypoint(ego_wp, dist)
        if wp is None:
            continue
        tf = wp.transform
        tf.location.z += 0.3
        npc = world.try_spawn_actor(bp, tf)
        if npc:
            npc_list.append(npc)
            print(f'  [NPC {i+1}] 전방 {dist:.0f}m 스폰')
    print(f'[Init] NPC {len(npc_list)}대 스폰 완료')
    return npc_list


# ══════════════════════════════════════════════════════════
#  차량 물리
# ══════════════════════════════════════════════════════════

def set_tire_friction(vehicle, friction):
    wheel   = carla.WheelPhysicsControl(tire_friction=friction)
    physics = vehicle.get_physics_control()
    physics.wheels = [wheel] * 4
    vehicle.apply_physics_control(physics)


def restore_tire_friction(vehicle):
    set_tire_friction(vehicle, 1.0)


# ══════════════════════════════════════════════════════════
#  측정 유틸
# ══════════════════════════════════════════════════════════

def get_speed_kmh(actor):
    v = actor.get_velocity()
    return 3.6 * math.sqrt(v.x**2 + v.y**2 + v.z**2)


def get_speed_mps(actor):
    v = actor.get_velocity()
    return math.sqrt(v.x**2 + v.y**2 + v.z**2)


def distance_2d(a, b):
    return math.sqrt((a.x - b.x)**2 + (a.y - b.y)**2)


def nearest_npc_distance(ego, npc_list):
    dists = [distance_2d(ego.get_location(), n.get_location())
             for n in npc_list if n.is_alive]
    return min(dists) if dists else 999.0


# ══════════════════════════════════════════════════════════
#  로깅
# ══════════════════════════════════════════════════════════

def init_logger(scenario_name, columns, log_dir=LOG_DIR):
    os.makedirs(log_dir, exist_ok=True)
    ts   = datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(log_dir, f'{scenario_name}_{ts}.csv')
    f    = open(path, 'w', newline='', encoding='utf-8')
    w    = csv.writer(f)
    w.writerow(columns)
    print(f'[Log] {path}')
    return f, w


def log_row(writer, *values):
    row = [f'{v:.2f}' if isinstance(v, float) else v for v in values]
    writer.writerow(row)


# ══════════════════════════════════════════════════════════
#  정리
# ══════════════════════════════════════════════════════════

def cleanup(world, ego=None, npc_list=None):
    print('[Cleanup] 정리 중...')
    disable_sync(world)
    if ego and ego.is_alive:
        ego.destroy()
    if npc_list:
        for npc in npc_list:
            if npc and npc.is_alive:
                npc.destroy()
    print('[Cleanup] 완료')


# ══════════════════════════════════════════════════════════
#  내부 헬퍼
# ══════════════════════════════════════════════════════════

def _random_car_bp(world):
    bps = [bp for bp in world.get_blueprint_library().filter('vehicle.*')
           if int(bp.get_attribute('number_of_wheels')) == 4]
    return random.choice(bps)


def _find_non_junction_spawn(world_map):
    for sp in world_map.get_spawn_points():
        wp = world_map.get_waypoint(sp.location)
        if wp and not wp.is_junction:
            return sp
    return world_map.get_spawn_points()[0]


def _advance_waypoint(wp, distance_m, step=2.0):
    current  = wp
    traveled = 0.0
    while traveled < distance_m:
        nexts = current.next(step)
        if not nexts:
            return None
        current   = nexts[0]
        traveled += step
    return current


def _fmt_loc(loc):
    return f'({loc.x:.1f}, {loc.y:.1f}, {loc.z:.1f})'