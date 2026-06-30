import carla
import random

class StaticBlocker:
    """회전교차로 내 특정 위치에 움직이지 않는 차량 배치."""
    
    def __init__(self, world, block_locations):
        """
        block_locations: [(x, y), ...] 리스트
        """
        self.world = world
        self.vehicles = []
        self._spawn(block_locations)
    
    def _spawn(self, locations):
        bp_lib = self.world.get_blueprint_library()
        bp = bp_lib.find('vehicle.tesla.model3')
        if bp.has_attribute('color'):
            bp.set_attribute('color', '255,0,0')  # 빨간색으로 식별
        
        for x, y in locations:
            wp = self.world.get_map().get_waypoint(
                carla.Location(x=x, y=y, z=0),
                project_to_road=True,
                lane_type=carla.LaneType.Driving)
            if wp is None:
                print(f'[Blocker] waypoint 없음: ({x}, {y})')
                continue
            
            tf = wp.transform
            tf.location.z += 0.5
            v = self.world.try_spawn_actor(bp, tf)
            if v:
                v.set_simulate_physics(False)  # 고정
                self.vehicles.append(v)
                print(f'[Blocker] 배치: ({tf.location.x:.1f}, {tf.location.y:.1f})')
    
    def update(self, elapsed):
        pass  # 고정이라 업데이트 없음
    
    def cleanup(self):
        for v in self.vehicles:
            if v.is_alive:
                v.destroy()
        print(f'[Blocker] {len(self.vehicles)}대 제거')