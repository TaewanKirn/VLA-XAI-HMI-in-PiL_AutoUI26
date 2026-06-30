# tools/check_loop.py
# 회전교차로 내부 순환 가능한 waypoint 찍기

import carla

client    = carla.Client('localhost', 2000)
client.set_timeout(20.0)
world     = client.load_world('Town03')
world_map = world.get_map()

import math

CENTER = (-75.0, 0.0)

print('=== 회전교차로 반경별 waypoint 샘플 ===')
for radius in [8, 10, 12, 14]:
    print(f'\n[반경 {radius}m]')
    for angle_deg in range(0, 360, 45):
        angle_rad = math.radians(angle_deg)
        x = CENTER[0] + radius * math.cos(angle_rad)
        y = CENTER[1] + radius * math.sin(angle_rad)
        wp = world_map.get_waypoint(
            carla.Location(x=x, y=y, z=0.0),
            project_to_road=True
        )
        if wp:
            wl = wp.transform.location
            print('  각도 {:3}°  요청({:6.1f}, {:6.1f})  → 실제({:6.1f}, {:6.1f})  lane:{}  junction:{}  yaw:{:.1f}'.format(
                angle_deg, x, y, wl.x, wl.y,
                wp.lane_id, wp.is_junction,
                wp.transform.rotation.yaw))