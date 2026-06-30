# check_ramp2.py
# 합류 junction 주변 램프 진입로 확인

import carla

client    = carla.Client('localhost', 2000)
client.set_timeout(20.0)
world     = client.load_world('Town04')
world_map = world.get_map()

# junction 진입 지점 (190, -374) 근처 모든 waypoint
print('=== junction 주변 전체 waypoint ===')
all_wps = world_map.generate_waypoints(3.0)
for wp in all_wps:
    loc = wp.transform.location
    if 180 < loc.x < 230 and -410 < loc.y < -350:
        print('  road:{:3} lane:{:3}  ({:7.1f}, {:7.1f})  yaw:{:7.1f}  junction:{}'.format(
            wp.road_id, wp.lane_id,
            loc.x, loc.y,
            wp.transform.rotation.yaw,
            wp.is_junction))