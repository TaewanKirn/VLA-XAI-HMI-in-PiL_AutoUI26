# check_town04.py
# Town04 합류구간 실제 좌표 확인

import carla

client    = carla.Client('localhost', 2000)
client.set_timeout(20.0)
world     = client.load_world('Town04')
world_map = world.get_map()

all_wps       = world_map.generate_waypoints(2.0)
junction_locs = [wp.transform.location
                 for wp in all_wps if wp.is_junction]

clusters = {}
for loc in junction_locs:
    key = (round(loc.x / 25) * 25,
           round(loc.y / 25) * 25)
    clusters[key] = clusters.get(key, 0) + 1

print('=== Junction 클러스터 (밀도 순) ===')
for k, v in sorted(clusters.items(),
                   key=lambda x: x[1], reverse=True)[:15]:
    print(f'  위치: ({k[0]:7.1f}, {k[1]:7.1f})  밀도: {v}')

# 고속도로 직선 구간 스폰 포인트 확인
print('\n=== 스폰 포인트 앞 20개 ===')
for i, sp in enumerate(world_map.get_spawn_points()[:20]):
    wp = world_map.get_waypoint(sp.location)
    print(f'  [{i:2}] ({sp.location.x:7.1f}, {sp.location.y:7.1f})'
          f'  junction: {wp.is_junction}'
          f'  road_id: {wp.road_id}')