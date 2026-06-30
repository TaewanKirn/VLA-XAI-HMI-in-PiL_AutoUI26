# check_town03.py
# Town03 회전교차로 실제 좌표 확인용

import carla

client = carla.Client('localhost', 2000)
client.set_timeout(20.0)
world     = client.load_world('Town03')
world_map = world.get_map()

# junction waypoint 전체 출력
all_wps       = world_map.generate_waypoints(2.0)
junction_locs = [wp.transform.location
                 for wp in all_wps if wp.is_junction]

# 클러스터링
clusters = {}
for loc in junction_locs:
    key = (round(loc.x / 25) * 25,
           round(loc.y / 25) * 25)
    clusters[key] = clusters.get(key, 0) + 1

# 밀도 순으로 정렬 출력
print('=== Junction 클러스터 (밀도 순) ===')
for k, v in sorted(clusters.items(),
                   key=lambda x: x[1], reverse=True)[:10]:
    print(f'  위치: ({k[0]:6.1f}, {k[1]:6.1f})  밀도: {v}')