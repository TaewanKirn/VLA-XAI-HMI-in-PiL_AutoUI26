# check_roundabout.py
# (-75, 0) 회전교차로 진입로 waypoint 확인

import carla

client    = carla.Client('localhost', 2000)
client.set_timeout(20.0)
world     = client.load_world('Town03')
world_map = world.get_map()

center = carla.Location(x=-75.0, y=0.0, z=0.0)

print('=== 진입로 후보 waypoint ===')
offsets = [
    ( 0,  40), ( 0, -40),
    (40,   0), (-40,  0),
    ( 0,  30), ( 0, -30),
    (30,   0), (-30,  0),
    ( 0,  50), ( 0, -50),
    (50,   0), (-50,  0),
]
for ox, oy in offsets:
    loc = carla.Location(x=center.x + ox,
                         y=center.y + oy, z=0.0)
    wp  = world_map.get_waypoint(loc, project_to_road=True)
    if wp:
        print(f'  오프셋({ox:4},{oy:4})'
              f'  실제위치: ({wp.transform.location.x:7.1f},'
              f' {wp.transform.location.y:7.1f})'
              f'  junction: {wp.is_junction}'
              f'  road_id: {wp.road_id}')