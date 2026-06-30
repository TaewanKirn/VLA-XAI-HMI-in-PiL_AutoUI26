# check_ramp.py
# Town04 램프/합류구간 좌표 확인

import carla

client    = carla.Client('localhost', 2000)
client.set_timeout(20.0)
world     = client.load_world('Town04')
world_map = world.get_map()

all_wps = world_map.generate_waypoints(5.0)

print('=== 합류 가능 구간 (junction 근처 도로) ===')
for wp in all_wps:
    if wp.is_junction:
        continue
    loc = wp.transform.location
    # 고속도로 구간 근처만
    if -400 < loc.y < -150 and 150 < loc.x < 450:
        nexts = wp.next(5.0)
        for n in nexts:
            if n.is_junction:
                print('  road:{} lane:{}  ({:.1f}, {:.1f})  yaw:{:.1f}  → junction 진입'.format(
                    wp.road_id, wp.lane_id,
                    loc.x, loc.y,
                    wp.transform.rotation.yaw))
                break