# check_merge.py
# Town04 합류구간 후보 상세 확인

import carla

client    = carla.Client('localhost', 2000)
client.set_timeout(20.0)
world     = client.load_world('Town04')
world_map = world.get_map()

# road_id 35, 42, 43 — 스폰 포인트 많은 고속도로 구간
# 합류구간 후보: junction 근처 직선 도로
print('=== road_id 35 구간 waypoint ===')
all_wps = world_map.generate_waypoints(10.0)
for wp in all_wps:
    if wp.road_id in [35, 42, 43] and not wp.is_junction:
        loc = wp.transform.location
        # y=-200 ~ -400 구간만
        if -400 < loc.y < -150:
            print(f'  road:{wp.road_id}'
                  f'  ({loc.x:7.1f}, {loc.y:7.1f})'
                  f'  yaw:{wp.transform.rotation.yaw:6.1f}'
                  f'  lane:{wp.lane_id}')