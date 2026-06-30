import carla
import math
import random


class RoundaboutNPC:
    """2차로 회전교차로 NPC — **TM autopilot 으로 실제 주행**(바퀴 굴러감·물리 ON·TM 충돌회피).

    이전의 set_transform 강제이동 방식은 바퀴가 안 굴러가 '미끄러지고(skating)', 2차로 밀집
    시 인접 차와 위치가 겹쳐 충돌이 났다(리그 피드백). → 폐기.

    대신 각 NPC 를 set_autopilot(True) + 자기 차로의 **원형 loop 경로 set_path** 로 띄워
    회전교차로를 계속 돌게 한다(ego 가 이미 이 방식으로 3바퀴 도는 게 검증됨). TM 이 차들
    간(그리고 ego 와의) 충돌을 자동 회피하므로 '충돌 난리'가 사라진다.

    - 안쪽(inner, lane -4, r≈19.5): ego 가 진입·순환하는 차로 → 드물게.
    - 바깥(outer, lane -5, r≈23.0): '진출 차로'(2차로) → 조밀(ego 가 못 빠져나가 도는 답답함).

    진입/진출 gap 판정은 각 차의 **실시간 위치**(get_location→중심각)로 한다(analytical 아님).
    """

    def __init__(self, world, tm, center,
                 inner_radius=19.5, outer_radius=23.0,
                 n_inner=3, n_outer=8,
                 ring_speed_kmh=17.5, clockwise=True, num_laps=12, **_ignore):
        self.world = world
        self.tm = tm
        self.cx, self.cy = center
        self.inner_radius = inner_radius
        self.outer_radius = outer_radius
        self.n_inner = n_inner
        self.n_outer = n_outer
        self.clockwise = clockwise
        self.ring_speed_kmh = ring_speed_kmh
        self.num_laps = num_laps

        # 인덱스 정렬 병렬 리스트
        self.vehicles = []
        self.lanes = []                  # 'inner' / 'outer'
        self.spawned = False

        self.ground_z = self._get_ground_z()
        # ⚠️ 지연 스폰: __init__ 에서 차량을 띄우지 않는다. 정상주행(빈 로터리 통과) 동안
        #   로터리는 비어 있어야 하므로, 이벤트 직전 main 이 spawn_now() 를 호출해 띄운다.

    def spawn_now(self):
        """이벤트 시점에 호출 — 두 차로에 TM autopilot 순환 NPC 를 실제로 띄운다."""
        if self.spawned:
            return
        self.spawned = True
        self._spawn_lane('inner', self.inner_radius, self.n_inner)
        self._spawn_lane('outer', self.outer_radius, self.n_outer)
        print(f'[Roundabout] 지연 스폰 완료 — 총 {len(self.vehicles)}대 순환 시작')

    # ── 실시간 차로별 중심각(ego_controller gap 판정용) ──
    def _angle_of(self, v):
        loc = v.get_location()
        return math.atan2(loc.y - self.cy, loc.x - self.cx)

    @property
    def inner_angles(self):
        return [self._angle_of(v) for v, ln in zip(self.vehicles, self.lanes)
                if ln == 'inner' and v.is_alive]

    @property
    def outer_angles(self):
        return [self._angle_of(v) for v, ln in zip(self.vehicles, self.lanes)
                if ln == 'outer' and v.is_alive]

    def _get_ground_z(self):
        wp = self.world.get_map().get_waypoint(
            carla.Location(x=self.cx + self.inner_radius, y=self.cy, z=0))
        z = wp.transform.location.z if wp else 0.0
        print(f'[Roundabout] 지면 z = {z:.2f}')
        return z

    def _vehicle_bps(self):
        bp_lib = self.world.get_blueprint_library()
        # v23b: 버스·대형 밴 제외 — 길이가 길어 차로/빈틈에 안 맞고 ego 와 충돌(리그 피드백).
        excl = ('isetta', 'carlacola', 'firetruck', 'ambulance',
                'fusorosa', 'sprinter', 't2')   # fusorosa=버스, sprinter/t2=대형 밴
        return [bp for bp in bp_lib.filter('vehicle.*')
                if int(bp.get_attribute('number_of_wheels')) == 4
                and not any(x in bp.id for x in excl)]

    def _loop_locations(self, radius, start_angle, step_deg=10):
        """start_angle 에서 진행방향(CW/CCW)으로 num_laps 바퀴 도는 차로중심 Location 리스트."""
        cmap = self.world.get_map()
        sign = -1.0 if self.clockwise else 1.0
        locs = []
        steps = int(self.num_laps * 360 / step_deg)
        for k in range(1, steps + 1):
            a = start_angle + sign * math.radians(step_deg * k)
            wp = cmap.get_waypoint(
                carla.Location(x=self.cx + radius * math.cos(a),
                               y=self.cy + radius * math.sin(a), z=0),
                project_to_road=True, lane_type=carla.LaneType.Driving)
            if wp:
                locs.append(wp.transform.location)
        return locs

    def _spawn_lane(self, lane, radius, n):
        if n <= 0:
            return
        bps = self._vehicle_bps()
        cmap = self.world.get_map()
        yaw_off = -90.0 if self.clockwise else 90.0
        spawned = 0
        for i in range(n):
            ang = i * (2 * math.pi / n)
            wp = cmap.get_waypoint(
                carla.Location(x=self.cx + radius * math.cos(ang),
                               y=self.cy + radius * math.sin(ang), z=0),
                project_to_road=True, lane_type=carla.LaneType.Driving)
            if wp is None:
                continue
            loc = wp.transform.location
            spawn_tf = carla.Transform(
                carla.Location(x=loc.x, y=loc.y, z=loc.z + 0.3),
                carla.Rotation(yaw=math.degrees(ang) + yaw_off))  # 진행방향으로 정렬
            bp = random.choice(bps)
            if bp.has_attribute('color'):
                vals = bp.get_attribute('color').recommended_values
                if vals:
                    bp.set_attribute('color', random.choice(vals))
            bp.set_attribute('role_name', 'roundabout')
            v = self.world.try_spawn_actor(bp, spawn_tf)
            if v is None:
                continue
            # TM autopilot — 실제 주행(바퀴 굴러감). 차로유지·신호/표지 무시(회전교차로 안 계속 돎).
            v.set_autopilot(True, self.tm.get_port())
            try:
                self.tm.auto_lane_change(v, False)
                self.tm.ignore_lights_percentage(v, 100)
                self.tm.ignore_signs_percentage(v, 100)
                self.tm.set_desired_speed(v, self.ring_speed_kmh)
            except Exception:
                pass
            # 자기 차로를 계속 돌도록 원형 loop 경로 주입
            loop = self._loop_locations(radius, ang)
            if loop:
                try:
                    self.tm.set_path(v, loop)
                except Exception as e:
                    print(f'[Roundabout] {lane} set_path 실패: {e}')
            self.vehicles.append(v)
            self.lanes.append(lane)
            spawned += 1
        print(f'[Roundabout] {lane} 차로 {spawned}/{n}대 (TM autopilot 순환, r={radius:.1f}, '
              f'{self.ring_speed_kmh:.0f}km/h)')

    def update(self, elapsed_time):
        """TM 이 운전하므로 매 틱 강제이동 불필요(no-op). (인터페이스 유지용)"""
        return

    def cleanup(self):
        cnt = 0
        for v in self.vehicles:
            try:
                if v.is_alive:
                    v.set_autopilot(False)
                    v.destroy()
                    cnt += 1
            except Exception:
                pass
        print(f'[Roundabout] {cnt}대 정리 완료')
