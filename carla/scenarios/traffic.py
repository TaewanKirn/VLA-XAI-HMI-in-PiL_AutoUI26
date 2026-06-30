"""평소 주변 트래픽(ambient traffic) 스폰 — 모든 시나리오 공통 (요청 #5).

ego 스폰 후 호출하면 무작위 spawn point 에 NPC 차량 N대를 autopilot 으로 띄운다.
정상주행 구간에 "평소 차들이 좀 있는" 환경을 만든다. NPC 는 기본 TM 거동
(신호등 준수·차선변경 허용)이라 ego 와 자연스럽게 섞인다.

사용:
    from traffic import spawn_ambient_traffic, destroy_traffic
    npcs = spawn_ambient_traffic(world, tm, n=30, ego=ego)
    ...
    destroy_traffic(npcs)            # 종료 시 (finally)
"""
import random
import carla


def spawn_ambient_traffic(world, tm, n=30, ego=None, speed_diff=0.0,
                          exclude_radius=18.0, seed=None, desired_speed_kmh=None,
                          roundabout_center=None, roundabout_radius=0.0,
                          near_ego_first=False, near_radius=0.0):
    """무작위 spawn point 에 4륜 NPC n대 스폰 → autopilot.

    n                 : 목표 대수 (spawn point 부족하면 가능한 만큼)
    ego               : 주면 ego 반경 exclude_radius m 안에는 스폰 안 함(끼임·충돌 방지)
    speed_diff        : NPC 속도 = 제한속도 대비 % (양수=느리게). 0 = 제한속도.
    desired_speed_kmh : 지정 시 도로 제한과 무관하게 절대속도[km/h] 로 통일
                        (set_desired_speed). 도로마다 제한이 달라도 일정 속도 유지.
    seed              : 재현성용 난수 시드 (None=매번 랜덤)
    roundabout_center : (x,y) 주면 이 중심 반경 roundabout_radius m 안에는 ambient 스폰 안 함.
    roundabout_radius : v21 — 회전교차로 링·진입구를 ambient 로 막지 않게 제외(핸드오프 #4).
                        링엔 통제된 RoundaboutNPC 만 남아 gap-gate 가 예측대로 동작.
    near_ego_first    : v31 — True 면 spawn point 를 ego 와 가까운 순으로 정렬해 ego 주변에 군집
                        스폰(대형 맵 Town04 고속 시나리오에서 '주변 트래픽 안 보임' 방지).
    near_radius       : v31 — >0 이면 ego 로부터 이 거리 안의 spawn point 만 우선 사용
                        (그 안이 n대보다 적으면 가까운 순으로 그 밖에서 채움).
    """
    bp_lib = world.get_blueprint_library()
    # 4륜 차량만 (자전거/오토바이 제외). v23b: 버스·대형 밴도 제외(길어서 충돌·정체 유발, 리그 피드백).
    _excl = ('fusorosa', 'sprinter', 't2', 'firetruck', 'ambulance', 'carlacola')
    car_bps = [b for b in bp_lib.filter('vehicle.*')
               if b.has_attribute('number_of_wheels')
               and int(b.get_attribute('number_of_wheels')) == 4
               and not any(x in b.id for x in _excl)]
    if not car_bps:
        print('[Traffic] 4륜 차량 blueprint 없음 → 트래픽 스폰 건너뜀')
        return []

    spawn_points = list(world.get_map().get_spawn_points())
    rng = random.Random(seed)
    rng.shuffle(spawn_points)
    ego_loc = ego.get_location() if ego is not None else None

    # v31: ego 주변 군집 스폰 — 큰 맵에서 트래픽이 ego 주변에 보이도록 가까운 순으로 정렬.
    if near_ego_first and ego_loc is not None:
        ordered = sorted(spawn_points, key=lambda tf: tf.location.distance(ego_loc))
        if near_radius > 0.0:
            within = [tf for tf in ordered if tf.location.distance(ego_loc) <= near_radius]
            spawn_points = within if len(within) >= n else ordered
        else:
            spawn_points = ordered
    ra_loc = (carla.Location(x=roundabout_center[0], y=roundabout_center[1], z=0.0)
              if (roundabout_center and roundabout_radius > 0.0) else None)

    npcs = []
    n_ra_skip = 0
    for tf in spawn_points:
        if len(npcs) >= n:
            break
        if ego_loc is not None and tf.location.distance(ego_loc) < exclude_radius:
            continue
        if ra_loc is not None and tf.location.distance(ra_loc) < roundabout_radius:
            n_ra_skip += 1                 # v21: 회전교차로 반경 내 spawn point 제외
            continue
        bp = rng.choice(car_bps)
        if bp.has_attribute('color'):
            vals = bp.get_attribute('color').recommended_values
            if vals:
                bp.set_attribute('color', rng.choice(vals))
        bp.set_attribute('role_name', 'traffic')
        v = world.try_spawn_actor(bp, tf)
        if v is None:
            continue                      # 점유된 spawn point → 다음
        v.set_autopilot(True, tm.get_port())
        tm.auto_lane_change(v, True)
        # v23: 우측 차로 규율 복원 — 자연스러운 도심 주행(우회전을 우측 차로에서).
        #   (옛 keep_right_rule=0 은 폐기된 '불법주차 블로커 우회'용 hack 이었음 → 제거.)
        try:
            tm.keep_right_rule_percentage(v, 100.0)
        except Exception:
            pass
        if desired_speed_kmh is not None:
            try:
                tm.set_desired_speed(v, desired_speed_kmh)        # 절대속도 통일
            except Exception:
                tm.vehicle_percentage_speed_difference(v, speed_diff)
        else:
            tm.vehicle_percentage_speed_difference(v, speed_diff)
        npcs.append(v)

    ra_note = (f', 회전교차로 반경 {roundabout_radius:.0f}m 내 {n_ra_skip}개 spawn 제외'
               if ra_loc is not None else '')
    print(f'[Traffic] 주변 트래픽 {len(npcs)}/{n} 대 스폰 (autopilot, 신호 준수{ra_note})')
    return npcs


def recycle_traffic_ahead(world, tm, npcs, ego, behind_dist=200.0,
                          ahead_min=180.0, ahead_max=340.0, max_recycle=2,
                          clearance=22.0, blend_speed_ms=14.0, seed=None):
    """v31/32: ego 뒤로 충분히 멀어진(시야 밖) NPC 를 ego 앞 도로로 재배치 → 고속 직선주행
    (Town04 등 큰 맵)에서도 주변 트래픽이 계속 보이게 유지한다.

    v32(충돌 방지, 사용자 '사고 많이 남'):
    - 뒤로 behind_dist(200m) 이상 멀어진 차만 옮김(시야 밖).
    - 앞 ahead_min~ahead_max(180~340m) — 더 멀리 둬 ego 가 곧장 들이받지 않게.
    - 목표 지점 반경 clearance(22m) 안에 다른 차가 있으면 **skip**(겹침·추돌 방지).
    - 재배치 후 속도 0 으로 떨구지 않고 **교통 속도(blend_speed_ms)로 합류** → 뒤차가 받지 않음.
    - 한 번에 max_recycle(2)대만, 호출 빈도도 낮춤(시나리오에서 6s).
    반환: 이번에 옮긴 대수.
    """
    if ego is None or not getattr(ego, 'is_alive', False):
        return 0
    ego_tf  = ego.get_transform()
    ego_loc = ego_tf.location
    fwd     = ego_tf.get_forward_vector()
    cmap    = world.get_map()
    rng     = random.Random(seed)
    # 겹침 검사용 — 모든 살아있는 차량 위치(자신 제외 비교는 거리 0 으로 자연 통과)
    alive   = [(v, v.get_location()) for v in (npcs or []) if v.is_alive]
    if ego.is_alive:
        alive.append((ego, ego_loc))
    moved   = 0
    for v in (npcs or []):
        if moved >= max_recycle:
            break
        if not v.is_alive:
            continue
        vl  = v.get_location()
        dx, dy = vl.x - ego_loc.x, vl.y - ego_loc.y
        dot = dx * fwd.x + dy * fwd.y            # <0 = ego 뒤
        dist = (dx * dx + dy * dy) ** 0.5
        if dot >= 0 or dist < behind_dist:
            continue                             # 앞쪽이거나 아직 가까우면 그대로 둠
        ego_wp = cmap.get_waypoint(ego_loc, project_to_road=True,
                                   lane_type=carla.LaneType.Driving)
        if ego_wp is None:
            continue
        nxts = ego_wp.next(rng.uniform(ahead_min, ahead_max))
        if not nxts:
            continue
        twp = nxts[0]
        # 옆차선 섞기(같은 방향 Driving 차선) — 한 차선에 몰리지 않게
        cand = twp.get_left_lane() if rng.random() < 0.5 else twp.get_right_lane()
        if cand is not None and cand.lane_type == carla.LaneType.Driving \
                and cand.lane_id * twp.lane_id > 0:
            twp = cand
        tloc = twp.transform.location
        # 겹침/추돌 방지: 목표 주변에 다른 차가 있으면 skip (자신은 멀리 있어 자동 통과)
        if any(o is not v and oloc.distance(tloc) < clearance for o, oloc in alive):
            continue
        tf = twp.transform
        tf.location.z += 0.3
        fv = twp.transform.get_forward_vector()   # 새 차선 진행 방향
        try:
            v.set_transform(tf)
            # 정지로 떨구지 않고 교통 속도로 합류 → 뒤에서 오던 차가 추돌하지 않음
            v.set_target_velocity(carla.Vector3D(fv.x * blend_speed_ms,
                                                 fv.y * blend_speed_ms,
                                                 fv.z * blend_speed_ms))
            moved += 1
        except Exception:
            pass
    return moved


def spawn_slow_crawler(world, tm, locations, speed_kmh=12.0):
    """'불법주차'를 대신하는 아주 느린 서행 차량을 지정 위치에 스폰(autopilot, 저속).

    CARLA TM 은 정지차를 추월 못 해 정지 블로커는 영구 gridlock 을 만든다(ego 접근까지 봉쇄).
    서행차는 '움직이므로' 한 지점을 영구 봉쇄하지 않아, 뒤차가 깔끔히 추월 못 해도 '굴러가는
    정체'가 되어 ego 가 회전교차로에 도달할 수 있다. 반환: 스폰된 차 리스트(destroy_traffic 로 정리).
    """
    bp_lib = world.get_blueprint_library()
    bp = bp_lib.find('vehicle.tesla.model3')
    if bp.has_attribute('color'):
        bp.set_attribute('color', '230,200,0')      # 눈에 띄는 색
    cmap = world.get_map()
    cars = []
    for (x, y) in locations:
        wp = cmap.get_waypoint(carla.Location(x=x, y=y, z=0),
                               project_to_road=True, lane_type=carla.LaneType.Driving)
        if wp is None:
            continue
        tf = wp.transform; tf.location.z += 0.3
        c = world.try_spawn_actor(bp, tf)
        if c is None:
            continue
        c.set_autopilot(True, tm.get_port())
        tm.auto_lane_change(c, False)                # 서행차는 차선유지
        try:
            tm.set_desired_speed(c, speed_kmh)
        except AttributeError:
            tm.vehicle_percentage_speed_difference(c, 70.0)
        cars.append(c)
    print(f'[Crawler] 서행 차량 {len(cars)}대 스폰 (~{speed_kmh:.0f}km/h, 굴러가는 정체)')
    return cars


def relieve_blocker_jam(tm, npcs, blocker, max_dist=20.0, slow_kmh=6.0):
    """불법주차(정지 블로커) 뒤에 막혀 느려진 트래픽을 좌측(1차로)으로 강제 차선변경 → 우회.

    TM 의 자동추월이 정지 차량엔 잘 안 걸려 '영원히 정지'하는 문제 해결(리그 피드백).
    주기적으로 호출 — 블로커 근처에서 느린(막힌) 차만 골라 force_lane_change(False=왼쪽).
    이미 우회한 차는 속도가 붙어 자동 제외된다. 반환: 이번에 우회시킨 대수.
    """
    if blocker is None:
        return 0
    blocs = [v.get_location() for v in getattr(blocker, 'vehicles', []) if v.is_alive]
    if not blocs:
        return 0
    cmap = None
    for v in (npcs or []):
        if v.is_alive:
            cmap = v.get_world().get_map(); break
    if cmap is None:
        return 0
    n = 0
    for v in (npcs or []):
        if not v.is_alive:
            continue
        vel = v.get_velocity()
        spd = 3.6 * (vel.x ** 2 + vel.y ** 2 + vel.z ** 2) ** 0.5
        if spd > slow_kmh:               # 이미 흐르는 차는 패스
            continue
        loc = v.get_location()
        if not any(loc.distance(b) < max_dist for b in blocs):
            continue
        # 옆에 같은 방향 Driving 차선이 있는 쪽으로 추월(없으면 기본 왼쪽)
        wp = cmap.get_waypoint(loc, project_to_road=True, lane_type=carla.LaneType.Driving)
        to_right = False
        if wp is not None:
            L, R = wp.get_left_lane(), wp.get_right_lane()
            if L and L.lane_type == carla.LaneType.Driving and L.lane_id * wp.lane_id > 0:
                to_right = False
            elif R and R.lane_type == carla.LaneType.Driving and R.lane_id * wp.lane_id > 0:
                to_right = True
        try:
            tm.force_lane_change(v, to_right)   # 막힌 차를 옆 Driving 차선으로
            n += 1
        except Exception:
            pass
    return n


def destroy_traffic(npcs):
    """스폰한 트래픽 정리 (종료 시)."""
    cnt = 0
    for v in (npcs or []):
        try:
            v.set_autopilot(False)
            if v.destroy():
                cnt += 1
        except Exception:
            pass
    if cnt:
        print(f'[Traffic] 주변 트래픽 {cnt}대 정리')
