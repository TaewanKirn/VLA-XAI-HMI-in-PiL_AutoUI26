import carla
import time
import os
import sys
import math
import threading
"""
역할 : CARLA에 데이터 요청, 6dof & DB & Websocket 으로 분배.
"""

# data-server 디렉터리를 sys.path에 올려서 시나리오 프로세스에서 import 해도
# `from sender.udp_sender ...`가 동작하도록 보정
_DATA_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _DATA_SERVER_DIR not in sys.path:
    sys.path.insert(0, _DATA_SERVER_DIR)

from sender.udp_sender import process_and_send_6dof
from sender.udp_sender import sock
from sender.udp_sender import set_dt as _set_send_dt
from sender.udp_sender import stop_output_thread as _stop_output
from sender.websocket_sender import start_ws_server, publish_frame, stop_ws_server


# ──────────────────────────────────────────────────────────────
# 선행차(앞차) 탐색 튜닝 상수 (min-TTC 로깅용; 매직넘버 인라인 금지)
# ──────────────────────────────────────────────────────────────
LEAD_MAX_DIST_M   = 60.0   # 이 거리 밖의 앞차는 무시(레이 길이)
LEAD_LANE_HALF_M  = 1.75   # 같은 차로 판정: ego 전방축 기준 횡오프셋 허용 ±[m]
LEAD_MIN_FWD_M    = 0.5    # 전방 최소 거리(자기 자신/뒤차 제외)
LEAD_CACHE_FRAMES = 5      # N프레임마다 lead 후보 재계산(전체 actor 순회 비용 절감)

# lead 캐시 상태 (collector 단일 루프 가정 → 모듈 전역으로 충분)
_lead_cache = {"frame": -10 ** 9, "id": None, "dist": None, "speed_kmh": None}


def _find_lead_vehicle(vehicle, frame):
    """ego 전방 같은 차로의 가장 가까운 차량 → (lead_distance_m, lead_speed_kmh).

    없으면 (None, None). 매 프레임 전체 actor 순회는 무거우므로 LEAD_CACHE_FRAMES
    마다만 후보를 갱신하고, 그 사이엔 마지막 후보의 거리/속도만 매 프레임 재측정한다.
    같은 차로 판정 = ego 전방벡터 기준 종거리(+전방)·횡오프셋(|·|<LANE_HALF)으로 근사."""
    try:
        ego_tf = vehicle.get_transform()
    except Exception:
        return None, None
    ego_loc = ego_tf.location
    fwd = ego_tf.get_forward_vector()
    rgt = ego_tf.get_right_vector()

    def _measure(other):
        try:
            oloc = other.get_location()
        except Exception:
            return None
        dx = oloc.x - ego_loc.x
        dy = oloc.y - ego_loc.y
        long_d = dx * fwd.x + dy * fwd.y          # +전방
        lat_d  = dx * rgt.x + dy * rgt.y          # +우측
        if long_d < LEAD_MIN_FWD_M or long_d > LEAD_MAX_DIST_M:
            return None
        if abs(lat_d) > LEAD_LANE_HALF_M:
            return None
        return long_d

    # 캐시된 lead 가 여전히 유효하면 거리/속도만 재측정(순회 회피)
    if (frame - _lead_cache["frame"]) < LEAD_CACHE_FRAMES and _lead_cache["id"] is not None:
        try:
            world = vehicle.get_world()
            other = world.get_actor(_lead_cache["id"])
        except Exception:
            other = None
        if other is not None and other.is_alive:
            d = _measure(other)
            if d is not None:
                v = other.get_velocity()
                spd = ((v.x ** 2 + v.y ** 2 + v.z ** 2) ** 0.5) * 3.6
                _lead_cache.update(dist=d, speed_kmh=spd)
                return round(d, 3), round(spd, 2)
        # 캐시 후보가 더는 lead 가 아님 → 즉시 재계산하도록 폴스루

    # 전체 vehicle actor 순회로 가장 가까운 전방 동일차로 차량 탐색
    best_d = None
    best_actor = None
    try:
        actors = vehicle.get_world().get_actors().filter("vehicle.*")
    except Exception:
        actors = []
    for other in actors:
        if other.id == vehicle.id:
            continue
        d = _measure(other)
        if d is None:
            continue
        if best_d is None or d < best_d:
            best_d = d
            best_actor = other

    if best_actor is None:
        _lead_cache.update(frame=frame, id=None, dist=None, speed_kmh=None)
        return None, None

    v = best_actor.get_velocity()
    spd = ((v.x ** 2 + v.y ** 2 + v.z ** 2) ** 0.5) * 3.6
    _lead_cache.update(frame=frame, id=best_actor.id, dist=best_d, speed_kmh=spd)
    return round(best_d, 3), round(spd, 2)


def _viewer_frame(data, map_short, actor_id):
    """collector data → HDMap 웹 뷰어(index.html)가 받는 프레임 형식.

    2026-06-18(후속): world_metric 스키마 확장 — HMI/scenarioQA 가 쓰는 물리필드
    (long_accel/lat_accel/yaw_rate/brake/lane_offset_m 등)를 평탄 top-level 키로 추가.
    기존 HDMap 뷰어는 추가 키를 무시하므로 하위호환. scenarioQA._get 이 이 키들을 직접 읽어
    NaN(미로깅) 6지표를 산출할 수 있게 된다."""
    p = data["position"]
    r = data["rotation"]
    a = data["acceleration"]
    lo = data.get("lane_offset_m")
    ld = data.get("lead_distance_m")
    ls = data.get("lead_speed_kmh")
    return {
        "type": "world_metric",   # 스펙 §2.2 — 위치 + DV 물리필드를 함께 싣는 연속 스트림
        "t_sim": round(data.get("sim_time", 0.0), 3),
        "map": map_short,
        "id": actor_id,
        "frame": data["frame"],
        "x": round(p["x"], 3),
        "y": round(p["y"], 3),
        "z": round(p["z"], 3),
        "yaw": round(r["yaw"], 2),
        "speed": round(data["speed_kmh"], 2),
        "speed_kmh": round(data["speed_kmh"], 2),
        "t": round(data["real_time"], 3),
        # ── world_metric 확장 필드 (scenarioQA/HMI) ──
        "long_accel": round(data["long_accel"], 4),   # 종가속 m/s² (전후, +전진)
        "lat_accel":  round(data["lat_accel"], 4),    # 횡가속 m/s² (+우측)
        "yaw_rate":   round(data["yaw_rate"], 5),     # rad/s (scenarioQA 규격)
        "brake":      round(data["brake"], 3),        # 0~1
        "throttle":   round(data["throttle"], 3),     # 0~1
        "steer":      round(data["steer"], 3),        # -1~1
        "lane_offset_m": (round(lo, 3) if lo is not None else None),  # 차선중심 횡이탈 m (+우측)
        # ── 선행차(앞차) — scenarioQA min-TTC 직접 산출용 ──
        "lead_distance_m": (round(ld, 3) if ld is not None else None),  # 같은차로 전방 최근접차 거리 m
        "lead_speed_kmh":  (round(ls, 2) if ls is not None else None),  # 그 차 속도 km/h
        # ── 월드축 가속/회전 중첩키 — replay_trace.py surge/sway 재도출용(평탄키와 병존) ──
        "acceleration": {                              # CARLA get_acceleration 원본(world frame)
            "x": round(a["x"], 4),
            "y": round(a["y"], 4),
            "z": round(a["z"], 4),
        },
        "rotation": {                                  # 차체 자세(deg)
            "roll":  round(r["roll"], 3),
            "pitch": round(r["pitch"], 3),
            "yaw":   round(r["yaw"], 3),
        },
    }


def _motion_frame(motion, frame_id, t_cap, t_sent):
    """6DOF 모션 큐를 CARLA 프레임과 분리된 WS 메시지(source=6dof)로 만든다.

    ws_monitor 는 이 메시지를 6DOF 스트림으로 따로 집계·표시하고, 같은 tick 의 CARLA
    프레임과 `ref_frame` 으로 짝지어 CARLA↔6DOF 를 연동한다.
    `latency_ms` = CARLA 데이터 준비(snapshot 직후) → 6DOF UDP 송신 직후까지의 처리지연.
    같은 프로세스의 단조시계(perf_counter)로 재므로 시계차 없이 정확하다.
    """
    return {
        "source": "6dof",
        "type": "motion",
        "ref_frame": frame_id,                 # 같은 tick 의 CARLA 프레임 매칭용
        "motion": motion,                      # roll,pitch,yaw,sway,surge,heave,event
        "latency_ms": round((t_sent - t_cap) * 1000.0, 3),
    }


# ── ego 주변 차량 + 신호등 (HDMap 배경 drive_bg.html 렌더용) ──
_ACTORS_RADIUS_M = 90.0    # ego 이 반경(m) 내 actor 만 — 과밀·대역 절감
_ACTORS_MAX = 24           # 차량 렌더 상한
_ACTORS_EVERY = 6          # 이 frame 간격마다 1회 발행(50tick/s → ~8Hz, JSONL 비대 방지)


def _actors_frame(world, ego, map_short):
    """ego 주변 차량 포즈 + 신호등 상태를 한 메시지(type=world_actors)로 묶는다.

    world_metric(DV 연속 스트림)와 분리된 **보조 렌더 스트림**이라 scenarioQA 는 무시한다.
    좌표는 viewer 컨벤션과 동일한 CARLA world 원본(x, y, yaw) — 화면 변환(z=-y 등)은 렌더러가 한다.
    하위호환: top-level x 가 없어 기존 HDMap 뷰어 프레임 필터에 안 걸린다."""
    try:
        el = ego.get_location()
    except Exception:
        return None
    ex, ey = el.x, el.y
    r2 = _ACTORS_RADIUS_M * _ACTORS_RADIUS_M
    vehicles = []
    for v in world.get_actors().filter('vehicle.*'):
        if v.id == ego.id or not v.is_alive:
            continue
        loc = v.get_location()
        dx, dy = loc.x - ex, loc.y - ey
        if dx * dx + dy * dy > r2:
            continue
        vehicles.append({
            "id": v.id,
            "x": round(loc.x, 2),
            "y": round(loc.y, 2),
            "yaw": round(v.get_transform().rotation.yaw, 1),
        })
        if len(vehicles) >= _ACTORS_MAX:
            break
    lights = []
    for tl in world.get_actors().filter('traffic.traffic_light*'):
        loc = tl.get_location()
        dx, dy = loc.x - ex, loc.y - ey
        if dx * dx + dy * dy > r2:
            continue
        # str(state) 는 'Red' 또는 'TrafficLightState.Red' 형태 → 짧은 소문자로 정규화
        st = str(tl.get_state()).split(".")[-1].lower()
        lights.append({
            "x": round(loc.x, 2),
            "y": round(loc.y, 2),
            "state": st,            # 'red'|'yellow'|'green'|'off'
        })
    return {
        "type": "world_actors",
        "map": map_short,
        "ego_id": ego.id,
        "vehicles": vehicles,
        "lights": lights,
    }


def _build_data(snapshot, vehicle, cmap=None):
    transform = vehicle.get_transform()
    velocity = vehicle.get_velocity()
    accel = vehicle.get_acceleration()
    angular_vel = vehicle.get_angular_velocity()

    speed = (
        (velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2) ** 0.5
    ) * 3.6

    # ── world_metric 파생 물리량 (scenarioQA/HMI) ──
    #   world 좌표 가속도를 차체 종/횡으로 투영(2D), yaw rate 는 rad/s 로 변환,
    #   제동/스로틀/조향은 VehicleControl, 차선 횡이탈은 노면 waypoint 기준.
    fwd = transform.get_forward_vector()
    rgt = transform.get_right_vector()
    long_accel = accel.x * fwd.x + accel.y * fwd.y      # +전진
    lat_accel  = accel.x * rgt.x + accel.y * rgt.y      # +우측
    yaw_rate   = math.radians(angular_vel.z)            # deg/s(CARLA) → rad/s(QA 규격)
    try:
        ctrl = vehicle.get_control()
        brake, throttle, steer = ctrl.brake, ctrl.throttle, ctrl.steer
    except Exception:
        brake = throttle = steer = 0.0
    lane_offset = None
    if cmap is not None:
        try:
            wp = cmap.get_waypoint(transform.location, project_to_road=True,
                                   lane_type=carla.LaneType.Driving)
            if wp is not None:
                dx = transform.location.x - wp.transform.location.x
                dy = transform.location.y - wp.transform.location.y
                wrv = wp.transform.get_right_vector()
                lane_offset = dx * wrv.x + dy * wrv.y   # 차선중심 대비 +우측 이탈[m]
        except Exception:
            lane_offset = None

    # 선행차(앞차) 거리/속도 — scenarioQA min-TTC 직접 산출용 (LEAD_CACHE_FRAMES 캐시)
    lead_distance_m, lead_speed_kmh = _find_lead_vehicle(vehicle, snapshot.frame)

    return {
        "long_accel": long_accel,
        "lat_accel": lat_accel,
        "yaw_rate": yaw_rate,
        "brake": brake,
        "throttle": throttle,
        "steer": steer,
        "lane_offset_m": lane_offset,
        "lead_distance_m": lead_distance_m,
        "lead_speed_kmh": lead_speed_kmh,
        "frame": snapshot.frame,
        "sim_time": snapshot.timestamp.elapsed_seconds,
        "real_time": time.time(),
        "speed_kmh": speed,
        "position": {
            "x": transform.location.x,
            "y": transform.location.y,
            "z": transform.location.z,
        },
        "rotation": {
            "roll": transform.rotation.roll,
            "pitch": transform.rotation.pitch,
            "yaw": transform.rotation.yaw,
        },
        "velocity": {
            "x": velocity.x,
            "y": velocity.y,
            "z": velocity.z,
        },
        "acceleration": {
            "x": accel.x,
            "y": accel.y,
            "z": accel.z,
        },
        "angular_velocity": {
            "x": angular_vel.x,
            "y": angular_vel.y,
            "z": angular_vel.z,
        },
    }


# ──────────────────────────────────────────────────────────────
# 백그라운드 모드용 상태
# ──────────────────────────────────────────────────────────────
_stop_event = threading.Event()
_thread = None


def _collector_loop(world, vehicle):
    print("[Collector] 6DOF 송신 루프 시작 (background)")
    cmap = world.get_map()                         # lane_offset 계산용(1회 캐시)
    map_short = cmap.name.split("/")[-1]
    actor_id = vehicle.id
    while not _stop_event.is_set():
        try:
            # 시나리오 메인 루프가 world.tick()을 호출 → 그 tick을 기다림
            snapshot = world.wait_for_tick(seconds=2.0)
        except RuntimeError:
            continue

        if not vehicle.is_alive:
            print("[Collector] ego 차량이 사라짐 → 루프 종료")
            break

        t_cap = time.perf_counter()
        data = _build_data(snapshot, vehicle, cmap)
        motion = process_and_send_6dof(data)              # 6DOF UDP (+ 6축 반환)
        t_sent = time.perf_counter()

        # ① CARLA 월드 프레임 (source=carla) — HDMap 뷰어 + ws_monitor
        publish_frame(_viewer_frame(data, map_short, actor_id))
        # ② 6DOF 모션 프레임 (source=6dof) — ws_monitor 가 6DOF 를 별도 스트림으로
        #    잡아 표시하고 CARLA→6DOF 처리지연(latency_ms)을 산출. ref_frame 으로 짝지음.
        if isinstance(motion, dict):
            publish_frame(_motion_frame(motion, data["frame"], t_cap, t_sent))
        # ③ 주변 차량 + 신호등 (보조 렌더 스트림, 스로틀) — HDMap 배경 drive_bg.html
        if data["frame"] % _ACTORS_EVERY == 0:
            af = _actors_frame(world, vehicle, map_short)
            if af is not None:
                publish_frame(af)

    print("[Collector] 6DOF 송신 루프 종료")


def stop_collector():
    _stop_event.set()
    if _thread is not None:
        _thread.join(timeout=2.0)
    _stop_output()        # 50Hz 보간 송신 스레드 정리 (sock.close 전에)
    stop_ws_server()
    try:
        sock.close()
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────
# 메인 엔트리포인트
#   - run_collector()                              → 단독 실행 (data-server/main.py)
#   - run_collector(world, vehicle, background=True) → 시나리오 내부에서 백그라운드 스레드로
# ──────────────────────────────────────────────────────────────

def run_collector(world=None, vehicle=None, background=False):
    if background:
        if world is None or vehicle is None:
            raise ValueError("background=True 모드에서는 world와 vehicle을 넘겨야 합니다.")
        global _thread
        if _thread is not None and _thread.is_alive():
            print("[Collector] 이미 실행 중")
            return
        _stop_event.clear()
        # 송신측 DT 를 실제 sim delta 로 동기 (가속 EMA·속도제한 정합; sim Hz 변경 대응)
        try:
            _fd = world.get_settings().fixed_delta_seconds
            if _fd and _fd > 0:
                _set_send_dt(_fd)
                print(f"[Collector] 송신 DT 동기 = {_fd*1000:.1f}ms (sim delta={1.0/_fd:.0f}Hz)")
        except Exception as e:
            print(f"[Collector] DT 동기 실패(무시): {e}")
        start_ws_server()  # HDMap 웹 뷰어용 인프로세스 WebSocket 서버 (ws://127.0.0.1:8765)
        _thread = threading.Thread(
            target=_collector_loop, args=(world, vehicle), daemon=True
        )
        _thread.start()
        return

    # ── 단독 실행 모드 ────────────────────────────────────────
    # 1. CARLA 연결 설정
    client = carla.Client("localhost", 2000)
    client.set_timeout(10.0)
    world = client.get_world()

    # 2. request 주기 설정
    settings = world.get_settings()

    settings.synchronous_mode = True
    settings.fixed_delta_seconds = 0.02

    world.apply_settings(settings)

    # 3. 대상 차량(ego) 설정
    vehicle = None

    for actor in world.get_actors().filter('vehicle.*'):
        if actor.attributes.get('role_name') == 'hero':
            vehicle = actor
            break

    if vehicle is None:
        print("ego_vehicle을 찾을 수 없습니다.")
        exit()

    print("데이터 추출 및 분배를 시작합니다.")

    cmap = world.get_map()                         # lane_offset 계산용(1회 캐시)
    map_short = cmap.name.split("/")[-1]
    actor_id = vehicle.id
    start_ws_server()  # HDMap 웹 뷰어용 인프로세스 WebSocket 서버

    # 4. 메인 루프 (1프레임마다 반복)
    try:
        while True:
            world.tick()
            snapshot = world.get_snapshot()

            t_cap = time.perf_counter()
            data = _build_data(snapshot, vehicle, cmap)

            # 1. 6DOF 전송
            motion = process_and_send_6dof(data)
            t_sent = time.perf_counter()

            # 2. DB 저장 예정
            # save_to_db(data)

            # 3. WebSocket 송신 — ① CARLA 프레임 ② 6DOF 모션 프레임(지연 포함)
            publish_frame(_viewer_frame(data, map_short, actor_id))
            if isinstance(motion, dict):
                publish_frame(_motion_frame(motion, data["frame"], t_cap, t_sent))
            # 주변 차량 + 신호등 (보조 렌더 스트림, 스로틀) — HDMap 배경 drive_bg.html
            if data["frame"] % _ACTORS_EVERY == 0:
                af = _actors_frame(world, vehicle, map_short)
                if af is not None:
                    publish_frame(af)

            if data["frame"] % 50 == 0:
                print(f"[{data['frame']}] {data['speed_kmh']:.1f} km/h")

    except KeyboardInterrupt:
        print("종료")
    finally:
        stop_ws_server()
        sock.close()
