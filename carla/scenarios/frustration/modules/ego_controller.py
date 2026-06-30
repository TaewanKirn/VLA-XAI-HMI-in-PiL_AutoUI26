import carla
import math
import time as _t

# 진출-블록 마커(scenario_event) 발행용. main.py 가 data-server 를 sys.path 에 올린 뒤
# 이 모듈을 import 하므로 여기서 바로 잡힌다. 없으면 no-op (시나리오는 그대로 동작).
try:
    from sender.websocket_sender import publish_event as _publish_event
except Exception:
    def _publish_event(*_a, **_k):
        pass


class EgoController:
    """Ego: TM autopilot + gap-gate + 시계방향 경로."""

    def __init__(self, world, tm, spawn_location, exit_location,
                 roundabout_center, roundabout_npc,
                 vehicle_type='vehicle.tesla.model3',
                 gap_check_angle_deg=40.0,
                 gap_check_radius=19.0,
                 inner_radius=19.5,
                 outer_radius=23.0,
                 exit_attempt_target=3,
                 exit_gap_angle_deg=25.0,
                 leading_distance=4.0,
                 target_speed_kmh=20.0,
                 ring_speed_kmh=18.0,
                 max_wait_time=15.0,
                 num_laps=2,
                 pre_spawn_steps=0,
                 pre_spawn_step_meters=5.0,
                 approach_target_radius=8.0,
                 approach_route=None,
                 free_roam_secs=None,
                 free_roam_spawn=None,
                 free_roam_trigger_radius=60.0,
                 free_roam_route_in_max=120.0,
                 ring_trigger_radius=None,
                 free_roam_fallback_secs=45.0,
                 free_roam_teleport=False,
                 fade_out_dur=0.8,
                 fade_in_dur=1.0,
                 route_planner_fn=None):

        self.world = world
        self.tm = tm
        self.spawn_location = spawn_location          # 원래 진입점 (회전교차로 바로 앞)
        self.exit_location = exit_location
        self.cx, self.cy = roundabout_center
        self.npc_module = roundabout_npc

        self.gap_check_angle = math.radians(gap_check_angle_deg)
        self.default_gap_angle = self.gap_check_angle
        # v21: 강제 모드 전용 진입구 게이트(작은 각도). 일반 게이트(40°)는 NPC 5대 간격(72°)보다
        #   윈도(±40°=80°)가 넓어 '영원히 안 열림'(=의도된 답답함, 15s 후 강제). 강제 진입은
        #   '입구에 차가 코앞에 있나'만 봐야 하므로 차 1대 폭+여유≈20°(윈도 40° < 간격 72°)로 판정
        #   → 주기적으로 열려, 정면충돌 없이 안전 진입. (핸드오프 #5 강제진입 충돌 해결)
        self.force_gap_angle = math.radians(20.0)
        # v22: 2차로 회전교차로 — ego 는 안쪽 차로(inner)로 진입·순환한다.
        #   링/진입 gap 검사는 안쪽 반경 기준. 진출(merge-out)은 바깥 차로(outer) 빈틈 검사.
        self.inner_radius = inner_radius
        self.outer_radius = outer_radius
        self.gap_check_radius = inner_radius       # 링 loop·진입 gap = 안쪽 차로
        self.leading_distance = leading_distance
        self.target_speed_kmh = target_speed_kmh   # 접근 구간 순항 속도 + gap 예측 기준
        # v22c: 회전교차로 안에서는 더 느리게(로터리 = 저속). 진입 횡단 속도도 이걸 따라
        #   '진입이 너무 빠름'(리그 피드백) 완화. _setup_loop_path 에서 적용.
        self.ring_speed_kmh = ring_speed_kmh
        self.max_wait_time = max_wait_time         # WAITING 최대 대기 (초과 시 강제 진입)

        # ── v22: 진출-블록 답답함 (2차로 진출 시도) ───────────────────
        # 진출각 통과 = 진출 시도. 1·2회차는 '바깥 차로 막힘'으로 블록(한 바퀴 더),
        # exit_attempt_target(3) 회차부터 바깥 차로 빈틈이 진출각에 오면 진출(merge-out).
        self.exit_attempt_target = exit_attempt_target
        self.exit_gap_angle = math.radians(exit_gap_angle_deg)
        # v22e: 진입(바깥 차로 횡단) gap 임계 + 크립-주저(움찔움찔) 파라미터.
        #   commit(진입): 안쪽>in_commit AND 바깥>out_commit. brake(정지): 코앞<entry_brake_*.
        #   그 사이(애매) = creep(살짝 전진) → 곧 blocked 걸려 멈춤 = '움찔움찔'(탑승자 답답함).
        self.outer_entry_gap = math.radians(24.0)   # 일반 진입 허용(바깥 최근접 NPC 이보다 멀면)
        self.outer_force_gap = math.radians(15.0)   # 15s 후 강제 모드: 더 작은 빈틈에도 진입(관대)
        self.entry_brake_in  = math.radians(11.0)   # 안쪽 코앞 → 정지
        self.entry_brake_out = math.radians(13.0)   # 바깥 코앞 → 정지
        self.creep_throttle  = 0.18                 # v23d: 0.30→0.18 살짝만 전진(움찔은 유지, surge lurch↓)
        self._exit_pass_count = 0          # 진출각 통과(시도) 누계
        self._exit_window_latched = False  # 이번 바퀴 윈도 진입 처리 여부
        self.target_laps = num_laps        # (하위호환: loop 경로 길이 산정에만 사용)
        self._lap_accum_angle = 0.0
        self._lap_last_angle = None

        # ── pre-spawn (접근 단계) 설정 ─────────────────────────────────
        # pre_spawn_steps > 0 이면 진입점에서 그 개수만큼 거슬러 올라간 지점에 스폰하고
        # 'APPROACHING' 상태에서 천천히 진입점까지 자동주행한 뒤
        # 진입점 근접 시 기존 'WAITING' (gap-gate) 로직으로 전환.
        # 한 스텝당 거리 = pre_spawn_step_meters (기본 5m).
        # 총 거슬러 올라간 거리 ≈ pre_spawn_steps × pre_spawn_step_meters
        self.pre_spawn_steps = pre_spawn_steps
        self.pre_spawn_step_meters = pre_spawn_step_meters
        self.approach_target_radius = approach_target_radius
        # 외부 GRP 장거리 접근 경로(list[carla.Location], 스폰→…→진입점). 있으면 pre_spawn 대신 사용.
        self.approach_route = approach_route
        # 자유주행(free-roam) 설정: free_roam_secs 있으면 FREE_ROAM 으로 시작 → 시간+근접 시 진입.
        self.free_roam_secs = free_roam_secs
        self.free_roam_spawn = free_roam_spawn
        self.free_roam_trigger_radius = free_roam_trigger_radius   # 진입점까지 이 거리 안에서만 진입 시도
        self.free_roam_route_in_max = free_roam_route_in_max       # 진입 경로가 이보다 길면 보류(막힘 방지)
        self.route_planner_fn = route_planner_fn
        # v31: 자유주행(free-roam) + '어느 출입구로 들어와도' 진입감지 트리거.
        #   무장(free_roam_secs 경과) 후 ego 가 링 중심에서 이 반경 안에 들면 그 자리에서 이벤트 점화.
        #   v32: outer+6(29m)는 자연진입 포착 실패(ego가 링 근처 안 들어옴) → outer+15(38m)로 넓혀
        #   진입로 접근 단계부터 감지(자연 진입↑). 너무 넓히면 인접 도로 통과 시 오발火 → 38m 절충.
        self.ring_trigger_radius = (ring_trigger_radius if ring_trigger_radius is not None
                                    else outer_radius + 15.0)
        # 무장 후 이 시간(초) 내 링 미진입 시 링쪽 유도(route_planner_fn), 그래도 안되면 최후 텔레포트.
        self.free_roam_fallback_secs = free_roam_fallback_secs
        # ── 텔레포트 타이밍 모드(옵션 A, 2026-06-15 사용자 결정) ──
        #   자유주행으로 free_roam_secs 정상주행 → 화면 페이드아웃(암전) → 진입점 텔레포트 →
        #   페이드인 → 이벤트. Town03 좌표경로/근접진입 불가(실측)를 근본 회피하고 전환은 암전으로 가림.
        self.free_roam_teleport = free_roam_teleport
        self.fade_out_dur = fade_out_dur   # 암전까지 [s]
        self.fade_in_dur = fade_in_dur     # 복귀까지 [s]
        self.fade_alpha = 0                # 0=투명 ~ 255=완전 암전 (ego_camera 가 읽어 오버레이)
        self._fade_phase = None            # None | 'out' | 'in'
        self._fade_t0 = 0.0
        self._tp_started = False           # 텔레포트 시퀀스 시작 여부(1회성)

        sx, sy = spawn_location
        self.entry_angle = math.atan2(sy - self.cy, sx - self.cx)
        ex, ey = exit_location
        self.exit_angle = math.atan2(ey - self.cy, ex - self.cx)

        self.vehicle = None
        self.collision_sensor = None
        self.collision_history = []

        if free_roam_secs:
            self.state = 'FREE_ROAM'
        elif pre_spawn_steps > 0 or approach_route:
            self.state = 'APPROACHING'
        else:
            self.state = 'WAITING'
        self.wait_time = 0.0
        self.force_enter_until = 0.0
        self.forced_mode = False      # v21: 대기 초과/SPACE 시 ON. 단 진입구 빌 때만 진입(정면충돌 방지)
        self._event_triggered = False # v24: 정상주행 중 버튼으로 이벤트(텔레포트) 조기 시작
        self.autopilot_on = False
        self.exit_triggered = False   # E 키 누르면 True → 출구로 빠짐
        self.loop_path_set = False    # _setup_loop_path 호출 여부
        self._route_idx = 0           # 접근 경로 진행도(인덱스) — 조기 WAITING 방지용
        self._armed = False           # v31: 자유주행 이벤트 무장(free_roam_secs 경과) 여부
        self._fallback_routed = False # v31: 무장 후 링 유도 경로 주입 여부
        # v32: 자유주행 '리시' — Town03 허브에서 로터리로부터 너무 멀어지면(장거리 라우팅 불안정)
        #   자연 진입 실패 → 이 반경 밖으로 나가면 짧은 경로로 로터리 쪽으로 끌어당겨 근처를 계속 돌게 함.
        self.free_roam_leash = 90.0
        self._last_leash = -999.0
        self.event_started = False    # v31: 이벤트(링 순환) 시작 — 6DOF 답답함 모션 게이트
        self._lap_reasserted = 0      # v31: loop set_path 재주입한 정수 바퀴 수(어느 입구든 N바퀴 보장)

        # ── C(2026-06-18 사용자): 회전교차로 거동 = 바깥1 → 안쪽3 → STUCK(5s) → 바깥1 → 진출 ──
        #   2차선(outer)으로 진입 1바퀴 → 1차선(inner) 차선변경 3바퀴 → 진출지점 근처 1차로
        #   한가운데 5초 정지(갇힘의 절정) → 2차로 강제 비집기 → 바깥 1바퀴 → 진출. 총 5바퀴.
        self.ring_phase     = None    # OUTER_IN | INNER | STUCK | OUTER_OUT
        # 3R(2026-06-25 사용자 피드백 B): 2차로 진입 후 '거의 한 바퀴' 돌고 to_inner 하던 것
        #   → 반바퀴 이전에 1차로로. 진입(2차로) 후 0.4바퀴만에 차선변경.
        self.OUTER_IN_LAPS  = 0.4
        self.INNER_LAPS     = 3
        # C1 타이밍 재설계 2R(2026-06-25): force_merge → '한 바퀴' → exit_success.
        #   merge_done(정상) 폐기·한 바퀴만 돌므로 OUTER_OUT_LAPS=1.
        #   3R(피드백 C): abnormal_loop 은 force_merge '직후 즉시'가 아니라 2차로에서
        #   ABNORMAL_LOOP_OUT_LAPS(0.3바퀴) 이동한 뒤 발화(아래 OUTER_OUT 블록).
        self.OUTER_OUT_LAPS = 1
        # 3R-b/c(2026-06-25 피드백): abnormal_loop(C1-8)을 force_merge=C1-7('정상 주행') 후
        #   '정상 주행' 뒤 발화. 5초→7초(C1-7 재생 후 7초 뒤 C1-8). 시간게이트.
        self.ABNORMAL_LOOP_DELAY_SECS = 7.0
        self._force_merge_t           = 0.0
        # STUCK 5→12s: lane_change 를 STUCK 진입(stuck_stop) 즉시 발화 → force_merge 까지 ~12s 리드.
        self.STUCK_SECS     = 12.0
        self._stuck_t0      = 0.0
        self._stuck_done_lap = 0.0

        # C1-4(2026-06-25 재설계): junction_deadlock_start = '1.5바퀴 후 비정상 감지' 첫 발행 +
        #   순환(STUCK 진입 전) 동안 '정수 바퀴마다 재노출'. (옛 임계 2바퀴 → 1.5바퀴로 당김.)
        self.DEADLOCK_START_LAPS = 1.5        # 이 누적 바퀴(float)부터 비정상 감지 발화 시작
        # 3R-c(2026-06-25 피드백): 정수 바퀴 스냅(2,3…)이면 마지막 발화가 stuck_stop/lane_change
        #   직전에 몰려 C1-4 음성이 끊김 → '1.0바퀴 간격'(1.5,2.5…)으로 재발행. INNER 가 ~3.2바퀴서
        #   stuck 으로 빠지므로 마지막 발화는 2.5(stuck 0.7바퀴 전)라 TTS 가 끝까지 재생됨.
        self._deadlock_started        = False  # 첫 발행(1.5바퀴 도달) 여부
        self._deadlock_last_emit_lap  = -1.0   # 마지막으로 deadlock 을 발행한 누적 바퀴(float, 1.0 간격)

        # C1 GAP 보강(2026-06-22): 정본 순서 발행용 1회성 플래그.
        self._ev_junction_arrive   = False
        self._ev_abnormal_loop     = False
        # (deprecated) 옛 '첫 진출각 놓침' 래치 — 2026-06-25 재설계로 out_done≥1 게이팅이 대체.
        #   미사용이나 하위 참조 안전 위해 초기화만 남김.
        self._outer_out_pass_seen  = False
        # C1 타이밍 재설계(2026-06-25): 신규 이벤트 1회성 가드.
        self._ev_drive_start       = False    # 시나리오/자유주행 시작 = 정상 주행(C1-1)
        self._ev_enter_success     = False    # 진입 후 '안착'(속도 회복) 정상 순환(C1-3)
        self._enter_pending        = False    # WAITING→DRIVING 진입 플래그(아직 enter_success 미발화)
        self._ev_lane_change       = False    # lane_change 사전고지(stuck_stop 시점 = C1-6)
        # 2R(2026-06-25): merge_done(C1-7 정상) 폐기 — 사용자 '진입 후 정상 아님'. 가드만 잔존.
        self._ev_merge_done        = False
        # enter_success '안착' 속도 임계(km/h): 강제진입 직후 0.3km/h 정지상태가 아니라
        #   실제 원 안에서 순환할 때 발화하도록. 8~10 중 9로 잡음(ring_speed 17.5 의 절반↑).
        self.ENTER_SUCCESS_KMH     = 9.0
        # 3R(2026-06-25 피드백): enter_success('정상 주행 중')는 2차선(outer)에 '완벽히 진입'해
        #   순환을 시작한 뒤 띄운다. 속도(≥9km/h)만으론 진입(merge) 도중에 떠서, 링 위 누적
        #   회전각이 ENTER_SUCCESS_MIN_LAPS 이상(= outer 차로 안착·순환 시작)도 함께 요구한다.
        #   (좌표/각도 기반 게이트. OUTER_IN_LAPS=0.4 보다 작아 to_inner 이전에 발화.)
        self.ENTER_SUCCESS_MIN_LAPS = 0.12

        # C1 성공률(gap_attempt) 보강(2026-06-24): 진입 시도(creep 움찔) 1회당 1발행.
        #   creep 버스트의 '시작 에지'에서만 발행하려고 이전 프레임 creep 여부를 추적한다.
        self._gap_attempt_n     = 0       # 누적 진입 시도 횟수
        self._was_creeping      = False   # 직전 프레임이 creep(전진) 상태였는가
        # 3R(2026-06-25 피드백 A): C1-2('진입 어려움', gap_attempt att>=2) 노출이 너무 짧음
        #   (enter_success 가 att=2 직후 ~2s 만에 발화). 진입 커밋을 최소 MIN_STRUGGLE_SECS 동안
        #   막아 분투(움찔움찔·gap_attempt 누적)를 길게 → C1-2 노출창 연장. wait_time 은 매 틱
        #   증가하므로 데드락 없음(빈틈 확보 + 이 시간 경과 후 커밋, forced_mode 도 동일 적용).
        self.MIN_STRUGGLE_SECS  = 18.0
        # 3R-b/c(2026-06-25 피드백): gap_attempt(=C1-2 '진입 간격 확보 어려움')를 creep '시작'이
        #   아니라 '움찔했다가 다시 막혀 슬로다운'하는 순간(실패한 진입 시도 완료)에 발행.
        #   속도 0→튐→복귀 의 하강 에지. 임계 0.8→6.0(0~6km/h 밴드): 0 근처 jitter(노이즈)를
        #   같이 잡던 것 방지 — 6km/h 이하로 떨어지면 1회 카운트(완전 정지까지 안 기다림).
        self.GAP_ATTEMPT_STOP_KMH = 6.0

        self._spawn_ego(vehicle_type)
        self._attach_collision_sensor()
        self._setup_tm()

    def _spawn_ego(self, vehicle_type):
        bp_lib = self.world.get_blueprint_library()
        bp = bp_lib.find(vehicle_type)
        bp.set_attribute('role_name', 'hero')
        if bp.has_attribute('color'):
            bp.set_attribute('color', '255,255,255')

        sx, sy = self.spawn_location  # 원래 진입점
        entry_wp = self.world.get_map().get_waypoint(
            carla.Location(x=sx, y=sy, z=0),
            project_to_road=True,
            lane_type=carla.LaneType.Driving)

        # ── pre_spawn: 진입점에서 거슬러 올라간 지점으로 spawn waypoint 이동 ──
        # 거슬러 올라가면서 waypoint 들을 수집 → 역순으로 뒤집으면 spawn→entry 경로
        self.approach_waypoints = []   # 접근 경로 (spawn → entry 순)
        if self.free_roam_secs:
            # 자유주행 모드: 지정 위치 스폰, set_path 없음(TM 자유주행). 접근 경로는 진입 전환 시 생성.
            fx, fy = self.free_roam_spawn
            spawn_wp = self.world.get_map().get_waypoint(
                carla.Location(x=fx, y=fy, z=0),
                project_to_road=True, lane_type=carla.LaneType.Driving)
            print(f'[Ego] 자유주행(free-roam) 모드 — ({fx:.0f},{fy:.0f}) 스폰, '
                  f'{self.free_roam_secs:.0f}s 후 회전교차로 진입')
        elif self.approach_route:
            # 외부 GRP 경로 사용 (먼 스폰 → 회전교차로). 스폰 = 경로 '첫 점'(=멀리 떨어진 곳).
            carla_map = self.world.get_map()
            self.approach_waypoints = [
                wp for wp in (
                    carla_map.get_waypoint(l, project_to_road=True,
                                           lane_type=carla.LaneType.Driving)
                    for l in self.approach_route)
                if wp is not None]
            if not self.approach_waypoints:
                raise RuntimeError('[Ego] 접근 경로 waypoint 투영 실패(전부 None)')
            spawn_wp = self.approach_waypoints[0]
            _sl = spawn_wp.transform.location
            _sd = math.hypot(_sl.x - self.cx, _sl.y - self.cy)
            print(f'[Ego] 먼 스폰 접근 경로 — {len(self.approach_waypoints)}개 waypoint, '
                  f'스폰 ({_sl.x:.1f},{_sl.y:.1f}) 중심거리 {_sd:.0f}m → 회전교차로 직접 주행')
        elif self.pre_spawn_steps > 0:
            # scenarios1 방식 복원(사용자: 이 방식이 진입점에서 도로를 따라 멀리(빨간 동그라미)까지
            #   거슬러 올라가 긴 경로로 잘 갔음). 진입점에서 previous()[0] 로 도로를 그대로 따라감
            #   (분기=첫 번째). ⚠️ '멀어지는 분기만' 필터/피더 교정 없음 — 그 필터가 구불구불한
            #   긴 경로(중간에 회전교차로 쪽으로 가까워지는 구간 포함)를 끊어 먼 스폰을 막았음.
            cx, cy = self.cx, self.cy
            walked_back = [entry_wp]   # entry 부터 거꾸로 모음
            current = entry_wp
            step_m = self.pre_spawn_step_meters
            actual_steps = 0
            for _ in range(self.pre_spawn_steps):
                prev_list = current.previous(step_m)
                if not prev_list:
                    print(f'[Ego] 진입로 끝 도달 — '
                          f'{actual_steps} 스텝만 거슬러 올라감 '
                          f'(요청 {self.pre_spawn_steps})')
                    break
                current = prev_list[0]   # 분기 있으면 첫 번째(scenarios1 동일 = 같은 경로 재현)
                walked_back.append(current)
                actual_steps += 1
            spawn_wp = current
            # 역순으로 뒤집어서 TM 에 주입할 접근 경로 (spawn → ... → entry)
            self.approach_waypoints = list(reversed(walked_back))
            _sl = spawn_wp.transform.location
            _sd = math.hypot(_sl.x - cx, _sl.y - cy)
            print(f'[Ego] 접근 단계 — 진입점 상류 {actual_steps}×{step_m:.1f}m 도로 따라감, '
                  f'스폰 ({_sl.x:.1f},{_sl.y:.1f}) 중심거리 {_sd:.0f}m, '
                  f'경로 {len(self.approach_waypoints)}점')
        else:
            spawn_wp = entry_wp

        spawn_tf = spawn_wp.transform
        spawn_tf.location.z += 0.5

        # #1: 스폰 방향을 접근 경로 진행 방향으로 강제. 스폰 차선의 기본 yaw 가 진입점
        #     반대(회전교차로 멀어지는 쪽)면 출발 직후 불법 U턴이 발생함(리그 피드백).
        #     접근 경로 두 번째 waypoint 를 향하게 해 처음부터 진입점 쪽으로 출발.
        if len(self.approach_waypoints) >= 2:
            _a = self.approach_waypoints[0].transform.location
            _b = self.approach_waypoints[1].transform.location
            spawn_tf.rotation.yaw = math.degrees(math.atan2(_b.y - _a.y, _b.x - _a.x))

        self.vehicle = self.world.try_spawn_actor(bp, spawn_tf)
        if self.vehicle is None:
            for dx, dy in [(3, 0), (-3, 0), (0, 3), (0, -3)]:
                spawn_tf.location.x = spawn_wp.transform.location.x + dx
                spawn_tf.location.y = spawn_wp.transform.location.y + dy
                self.vehicle = self.world.try_spawn_actor(bp, spawn_tf)
                if self.vehicle is not None:
                    break

        if self.vehicle is None:
            raise RuntimeError('[Ego] 스폰 실패')

        print(f'[Ego] 스폰: ({spawn_tf.location.x:.1f}, {spawn_tf.location.y:.1f})')

    def _attach_collision_sensor(self):
        bp = self.world.get_blueprint_library().find('sensor.other.collision')
        self.collision_sensor = self.world.spawn_actor(
            bp, carla.Transform(), attach_to=self.vehicle)
        self.collision_sensor.listen(self._on_collision)

    def _on_collision(self, event):
        impulse = event.normal_impulse
        intensity = math.sqrt(impulse.x**2 + impulse.y**2 + impulse.z**2)
        self.collision_history.append({
            'frame': event.frame,
            'intensity': intensity,
            'other_actor': event.other_actor.type_id
        })
        print(f'[Ego] 충돌! {event.other_actor.type_id} (강도 {intensity:.1f})')

    def _cw_waypoints(self, r, step_deg=10):
        """시계방향(CW) 경로점 리스트 (entry → exit)."""
        cx, cy = self.cx, self.cy
        a = self.entry_angle
        target = self.exit_angle
        if target >= a:
            target -= 2 * math.pi
        points = []
        step = math.radians(step_deg)
        ang = a - step
        while ang > target:
            points.append((cx + r * math.cos(ang),
                           cy + r * math.sin(ang)))
            ang -= step
        return points

    def _cw_loop_waypoints(self, r, step_deg=10, num_laps=20):
        """엔트리 각도부터 시계방향으로 num_laps만큼 도는 경로점."""
        cx, cy = self.cx, self.cy
        points = []
        step = math.radians(step_deg)
        ang = self.entry_angle - step
        end = self.entry_angle - num_laps * 2 * math.pi
        while ang > end:
            points.append((cx + r * math.cos(ang),
                           cy + r * math.sin(ang)))
            ang -= step
        return points

    def _setup_tm(self):
        """기본 TM 설정.
        pre_spawn 모드면 접근 속도만 잡고 경로는 안 잡음 (TM 자동 도로 추종).
        아니면 즉시 회전교차로 loop 경로 주입.
        """
        # v(2026-06-15 후속3): 긴 접근 set_path 추종 = scenarios1 설정으로 맞춤(사용자: 주황색 루프
        #   = 현재 코드가 set_path 이탈해 좌상단서 빙빙 돔). 핵심 = **auto_lane_change=False**
        #   (차선변경 켜면 TM 이 경로를 벗어나 도로 자연주행→루프) + 신호/표지 무시(긴 경로서 빨간불
        #   정지 방지). ⚠️ 접근 중 신호 무시 = 정상주행 현실성 일부 희생(사용자 요청 우선).
        approaching = (self.pre_spawn_steps > 0) or bool(self.approach_route)
        if approaching:
            # 2026-06-19(P1 dead-time 수정): 접근 신호 '부분 준수'(ignore_lights 0→90).
            #   이력: 100(완전무시)→0(완전준수, 2026-06-18)→90(부분). 완전준수는 빨간불 대기 누적으로
            #   진입 t≈237s(정지 ~158s)·DONE t≈478s → 400s 컷에 안 맞음(dead-time 과도). 90%는
            #   빨간불 대부분 통과해 대기 최소화(진입 ~140s 목표). TM 충돌회피는 ignore_lights 와 무관하게
            #   유지되어 차량 추돌은 계속 방지(완전무시 시절의 '돌진'은 leading_distance 6 + 부분준수로 완화).
            #   사용자: '거리 따라 나눠 정지는 큰 차이 없다' → 부분준수의 약한 단계정지 수용.
            #   ⚠️ 90→완주 timing 은 relaunch 로 검증(진입/DONE 시각 확인 후 미세조정).
            self.tm.ignore_lights_percentage(self.vehicle, 90)
            self.tm.ignore_signs_percentage(self.vehicle, 100)
            self.tm.auto_lane_change(self.vehicle, False)   # set_path 충실히 따라가게(루프 방지)
        else:
            # 즉시 회전교차로 모드/자유주행: 현실성(신호 준수·차선변경) 유지
            self.tm.ignore_lights_percentage(self.vehicle, 0)
            self.tm.ignore_signs_percentage(self.vehicle, 0)
            self.tm.auto_lane_change(self.vehicle, True)
            try:
                self.tm.keep_right_rule_percentage(self.vehicle, 100.0)
            except Exception:
                pass
        self.tm.distance_to_leading_vehicle(self.vehicle, self.leading_distance)

        if self.free_roam_secs:
            # 자유주행: 규정속도만, set_path 없음 (TM 자유주행). 진입 경로는 전환 시 주입.
            self._set_approach_speed()
        elif self.pre_spawn_steps > 0 or self.approach_route:
            # 접근 단계: 규정속도 + spawn→…→entry 명시 경로로 TM 주입
            self._set_approach_speed()
            self._setup_approach_path()
        else:
            # 즉시 회전교차로 모드
            self._setup_loop_path()

    def _setup_approach_path(self):
        """spawn 지점 → 진입점까지 명시적 경로를 TM 에 주입(직접 주행 = TM autopilot 이 이 경로를
        따라감). TM 이 분기에서 무작위로 다른 길로 새는 것을 방지.
        v(2026-06-15): '촘촘히'(사용자 요청) — 검증된 스폰 위치/거리(pre_spawn 17스텝, ~85m)는 그대로
        두고, 연속 waypoint 사이에 도로 투영 중간점을 보간해 set_path 밀도를 약 2배(~5m→~2.5m)로 올림
        → TM 추종 정밀도↑(경로 이탈·U턴 방지). geometry(스폰점·경로 자체)는 불변."""
        if not self.approach_waypoints:
            print('[Ego] approach_waypoints 비어있음 — set_path 건너뜀')
            return
        base = [wp.transform.location for wp in self.approach_waypoints]
        cmap = self.world.get_map()
        dense = []
        for i in range(len(base) - 1):
            a, b = base[i], base[i + 1]
            dense.append(a)
            mid = carla.Location(x=0.5 * (a.x + b.x),
                                 y=0.5 * (a.y + b.y),
                                 z=0.5 * (a.z + b.z))
            mwp = cmap.get_waypoint(mid, project_to_road=True,
                                    lane_type=carla.LaneType.Driving)
            # 보간 중간점이 같은 차로(원 경로 근처)에 투영될 때만 삽입 — 엉뚱한 도로로 튀는 것 방지
            if mwp and mwp.transform.location.distance(mid) <= 2.0:
                dense.append(mwp.transform.location)
        dense.append(base[-1])
        try:
            self.tm.set_path(self.vehicle, dense)
            print(f'[Ego] 접근 경로 set_path 주입 완료 — 촘촘히 {len(base)}→{len(dense)}개 '
                  f'waypoint(중간점 보간, ~2.5m 간격, TM 직접 주행)')
        except Exception as e:
            print(f'[Ego] 접근 경로 set_path 실패: {e}')

    def _set_desired_speed(self, kmh):
        """ego 순항 = 고정 kmh. 리그 #1·#3: ego·traffic 을 동일 저속으로 맞춰 모션 꿀렁·급가감속 완화
        (규정속도 추종은 빠르고 들쭉날쭉 → 폐기). set_desired_speed 우선, 구버전 % diff fallback."""
        try:
            self.tm.set_desired_speed(self.vehicle, kmh)
            print(f'[Ego] 순항 속도 {kmh:.0f} km/h (set_desired_speed)')
        except AttributeError:
            reduction = max(0.0, (50.0 - kmh) / 50.0 * 100.0)
            self.tm.vehicle_percentage_speed_difference(self.vehicle, reduction)
            print(f'[Ego] 순항 속도 약 {kmh:.0f} km/h ({reduction:.0f}% diff)')

    def _set_approach_speed(self):
        """접근 단계 속도 = 단일 순항 속도 (전 구간 동일)."""
        self._set_desired_speed(self.target_speed_kmh)

    def _setup_loop_path(self):
        """회전교차로 시계방향 loop path 주입 + NPC collision detection + 정상 속도."""
        if self.loop_path_set:
            return
        self.loop_path_set = True

        # v24: 이벤트 시작(ego 가 회전교차로 도달=WAITING) 시 NPC 스폰. 그 전 정상주행
        #   동안엔 빈 로터리(지연 스폰). 어느 접근 모드든 여기서 일괄 처리(idempotent).
        if hasattr(self.npc_module, 'spawn_now'):
            self.npc_module.spawn_now()

        # 회전교차로 진입부터는 표지(stop/yield) 무시 — gap-gate 강제진입 로직과 충돌 방지 (#4).
        #   (접근 구간에선 _setup_tm 에서 0 으로 둬 스탑사인 준수.)
        self.tm.ignore_signs_percentage(self.vehicle, 100)
        # v23: 회전교차로 안에서는 차선변경 끔(set_path 순환 안정). free-roam 의 True 를 되돌림.
        self.tm.auto_lane_change(self.vehicle, False)

        # v22c: 회전교차로 안에서는 저속(ring_speed_kmh, 로터리는 원래 느림).
        #   진입 횡단 속도도 이걸 따라 '진입이 너무 빠름'(리그 피드백) 완화.
        #   멀미 저감은 6DOF 진폭 축소(udp_sender.TURN_COMFORT_SCALE)도 병행.
        self._set_desired_speed(self.ring_speed_kmh)

        # v22c: 충돌 감지 ON = 안쪽+바깥 전부. 진입 횡단·순환 중 ego 가 어느 차로 NPC 든
        #   들이받지/끼이지 않게 TM 이 감속·양보(끼임·고착 방지). 바깥은 진출 머지 직전에만
        #   trigger_exit 에서 잠깐 OFF(빈틈으로 빠져나가게).
        if self.npc_module is not None:
            count = 0
            for npc_v in getattr(self.npc_module, 'vehicles', []):
                if npc_v and npc_v.is_alive:
                    try:
                        self.tm.collision_detection(self.vehicle, npc_v, True)
                        # v32: NPC 도 ego 를 회피(양방향) — WAITING(수동제어)에서 정지·크립하는 ego 를
                        #   순환 NPC 가 들이받지 않게(진입 충돌 방지, 회전교차로 양보 거동).
                        self.tm.collision_detection(npc_v, self.vehicle, True)
                        count += 1
                    except Exception as e:
                        print(f'[Ego] collision_detection 설정 실패: {e}')
            print(f'[Ego] 회전교차로 NPC {count}대와 collision detection ON (양방향, 안쪽+바깥)')

        cx, cy = self.cx, self.cy
        r = self.outer_radius          # C: 진입은 바깥 차로(2차선) — 이후 _update_ring 이 단계 전환
        carla_map = self.world.get_map()
        path = []

        def add_wp(x, y):
            wp = carla_map.get_waypoint(
                carla.Location(x=x, y=y, z=0),
                project_to_road=True,
                lane_type=carla.LaneType.Driving)
            if wp:
                path.append(wp.transform.location)
                return True
            return False

        # ego (= 진입점 부근) → 링 진입점 중간 경유
        ego_loc = self.vehicle.get_location()
        ring_entry_x = cx + r * math.cos(self.entry_angle)
        ring_entry_y = cy + r * math.sin(self.entry_angle)
        for t in [0.4, 0.8]:
            add_wp(
                ego_loc.x + (ring_entry_x - ego_loc.x) * t,
                ego_loc.y + (ring_entry_y - ego_loc.y) * t
            )

        # 링 진입점
        add_wp(ring_entry_x, ring_entry_y)

        # C: 진입 = 바깥 차로(outer)에서 OUTER_IN_LAPS(+여유) 바퀴. 이후 단계 전환은 _update_ring.
        loop_laps = self.OUTER_IN_LAPS + 1
        for x, y in self._cw_loop_waypoints(r, step_deg=5, num_laps=loop_laps):
            add_wp(x, y)

        print(f'[Ego] LOOP 경로 {len(path)}개 waypoint (바깥 차로 진입, '
              f'outer{self.OUTER_IN_LAPS}→inner{self.INNER_LAPS}→정지→outer{self.OUTER_OUT_LAPS}→진출)')
        if path:
            try:
                self.tm.set_path(self.vehicle, path)
                print('[Ego] TM 경로 설정 완료 (회전 모드)')
            except Exception as e:
                print(f'[Ego] set_path 실패: {e}')

        # C: 진입 = 바깥 차로 순환 단계 시작.
        self.ring_phase = 'OUTER_IN'
        # v31: 어느 진입 모드든 여기서 이벤트(링 순환)가 시작됨 → 6DOF 답답함 모션 게이트 ON.
        self.event_started = True

        # C1-2 junction_arrive(GAP): 회전교차로 입구 도착 = 이벤트 시작 시점(1회). 정본 순서 첫 이벤트.
        if not self._ev_junction_arrive:
            self._ev_junction_arrive = True
            _publish_event('scenario_event', {'scenario': 'roundabout', 'event': 'junction_arrive',
                           't': round(_t.time(), 2),
                           'payload': {'current_kmh': round(self._get_speed_kmh(), 1)}})

    def _is_gap_available(self, elapsed, gap_angle=None, angles=None, ref_angle=None):
        """기준각(ref_angle, 기본=진입각) ±gap_angle 안에 NPC 가 없으면 True.
        angles 미지정 시 안쪽 차로(진입 게이트). 진출 게이트는 바깥 차로 각도를 넘긴다.
        v22e: NPC 가 TM autopilot 이라 angles 는 **실시간 중심각**(inner_angles/outer_angles).
        analytical 투영(angular_speed×elapsed) 폐기 — elapsed 는 호환 위해 남겨두되 미사용."""
        ga = self.gap_check_angle if gap_angle is None else gap_angle
        ref = self.entry_angle if ref_angle is None else ref_angle
        angs = (self.npc_module.inner_angles if angles is None else angles)
        for cur in angs:
            diff = math.atan2(math.sin(cur - ref), math.cos(cur - ref))
            if abs(diff) < ga:
                return False
        return True

    def _nearest_angle_gap(self, ref, angles):
        """ref(기준각) 기준 가장 가까운 NPC 의 각거리(rad, 0..pi). NPC 없으면 pi(=완전 빔)."""
        best = math.pi
        for cur in angles:
            d = abs(math.atan2(math.sin(cur - ref), math.cos(cur - ref)))
            if d < best:
                best = d
        return best

    def _is_path_clear(self, elapsed, safety_arc_deg=8, lookahead_steps=8):
        """ego가 entry → exit 전체 traversal 끝낼 때까지
        NPC와 동일 각도(±safety_arc)에 동시에 있지 않는지 예측."""
        if self.npc_module is None:
            return True

        speed_ms = max(self.target_speed_kmh / 3.6, 1.0)

        # 시계방향 traversal arc 길이 (라디안)
        arc_rad = self.entry_angle - self.exit_angle
        while arc_rad <= 0:
            arc_rad += 2 * math.pi

        T_ego = (self.gap_check_radius * arc_rad) / speed_ms
        safety_arc = math.radians(safety_arc_deg)

        for step in range(lookahead_steps + 1):
            t_rel = (step / lookahead_steps) * T_ego
            # ego 예상 각도 (CW = 각도 감소)
            ego_angle = self.entry_angle - (t_rel / T_ego) * arc_rad

            for init_a in self.npc_module.initial_angles:
                npc_angle = init_a + self.npc_module.angular_speed * (elapsed + t_rel)
                diff = math.atan2(
                    math.sin(ego_angle - npc_angle),
                    math.cos(ego_angle - npc_angle),
                )
                if abs(diff) < safety_arc:
                    return False
        return True


    def _get_speed_kmh(self):
        v = self.vehicle.get_velocity()
        return 3.6 * math.sqrt(v.x**2 + v.y**2 + v.z**2)

    def _set_autopilot(self, on):
        if on != self.autopilot_on:
            self.vehicle.set_autopilot(on, self.tm.get_port())
            self.autopilot_on = on
            print(f'[Ego] autopilot {"ON" if on else "OFF"}')

    def _is_near_exit(self, threshold=10.0):
        loc = self.vehicle.get_location()
        ex, ey = self.exit_location
        return math.hypot(loc.x - ex, loc.y - ey) < threshold

    def trigger_event_now(self):
        """정상주행 중 버튼(SPACE)으로 이벤트 조기 시작 요청. 다음 update 에서 텔레포트."""
        self._event_triggered = True

    def _start_event_at_entry(self, elapsed):
        """v24: 정상주행 종료 트리거 → ego 를 이벤트 시작 좌표(진입점)로 '텔레포트' + WAITING.
        라우팅으로 도달하지 않으므로 Town03 의 막힘/벽/방황 문제를 근본 회피(사용자 제안).
        텔레포트 직전 정지(velocity 0)해 6DOF 충격 최소화."""
        carla_map = self.world.get_map()
        sx, sy = self.spawn_location          # EGO_ENTRY_POINT (진입점, 링 바로 밖)
        wp = carla_map.get_waypoint(carla.Location(x=sx, y=sy, z=0),
                                    project_to_road=True, lane_type=carla.LaneType.Driving)
        loc = wp.transform.location if wp else carla.Location(x=sx, y=sy, z=0.3)
        # 링 중심을 바라보게 → WAITING creep 의 전방(=링쪽) 전진이 자연스럽게 동작
        yaw = math.degrees(math.atan2(self.cy - loc.y, self.cx - loc.x))

        # 이벤트 시점에 회전교차로 NPC 스폰(그 전 정상주행 동안엔 빈 로터리)
        if hasattr(self.npc_module, 'spawn_now'):
            self.npc_module.spawn_now()

        self._set_autopilot(False)
        self.vehicle.set_transform(carla.Transform(
            carla.Location(x=loc.x, y=loc.y, z=loc.z + 0.3),
            carla.Rotation(yaw=yaw)))
        try:
            self.vehicle.set_target_velocity(carla.Vector3D(0, 0, 0))
            self.vehicle.set_target_angular_velocity(carla.Vector3D(0, 0, 0))
        except Exception:
            pass

        self.state = 'WAITING'
        self.wait_time = 0.0
        self.forced_mode = False
        self._setup_loop_path()               # 링 loop 경로 + collision_detection + ring 속도
        print(f'[Ego] 정상주행 종료(t={elapsed:.0f}s) → 이벤트 시작 좌표({loc.x:.0f},{loc.y:.0f}) '
              f'텔레포트 → WAITING(이벤트 시작)')

    def _start_event_in_place(self, elapsed):
        """v31: 자유주행 중 링 진입 감지 → '그 자리(현재 들어온 입구)'에서 이벤트 시작.
        텔레포트 없음. entry_angle 을 현재 위치 기준으로 재계산 → 어느 출입구로 들어와도 동작.
        진출각(exit_angle)/exit_location 은 검증된 EGO_EXIT_POINT 기준 그대로 유지 →
        N바퀴 후 검증된 merge-out 경로로 빠져나간다."""
        loc = self.vehicle.get_location()
        self.entry_angle = math.atan2(loc.y - self.cy, loc.x - self.cx)
        self._lap_last_angle = None
        self._lap_accum_angle = 0.0
        self._lap_reasserted = 0
        self.exit_triggered = False
        self.loop_path_set = False            # 이번 진입 기준으로 loop 재구성 허용
        self.wait_time = 0.0
        self.forced_mode = False
        # v32: 바로 순환하지 않고 먼저 WAITING(크립-주저, 움찔움찔) — '진입 시 더 주저'(사용자 요청).
        #   바깥(진출) 차로가 조밀(n_outer 12)해 빈틈을 못 찾고 움찔거리다, 빈틈/한계(max_wait 28s)
        #   시 안쪽 차로로 진입 → 이후 N바퀴 순환. 진입 자체가 답답하게 느껴지도록.
        self.state = 'WAITING'
        self._set_autopilot(False)
        self._setup_loop_path()               # NPC 스폰 + 링 loop(현재 입구각 기준) + collision + ring 속도
        print(f'[Ego] t={elapsed:.0f}s — 링 진입 감지(입구각 '
              f'{math.degrees(self.entry_angle):.0f}°) → 진입 주저(WAITING) 후 '
              f'{self.target_laps}바퀴 순환·진출')
        _publish_event('scenario_event', {'scenario': 'roundabout', 'event': 'circling_start',
                       'entry_deg': round(math.degrees(self.entry_angle), 1),
                       't': round(elapsed, 2)})

    def _track_laps_and_circle(self, elapsed):
        """[DEPRECATED — 비활성 레거시] v31 단순-순환 경로. 현재 활성 FSM은 _update_ring 이며,
        _lap_accum_angle/_lap_last_angle/_lap_reasserted 누산은 _update_ring 만 수행한다.
        이 레거시가 같은 누산 상태를 다시 적분하면 활성 각도가 오염되므로(G0-5),
        호출 자체를 막는다. (코드는 이력 보존용으로 아래에 남겨둠.)"""
        raise RuntimeError(
            '_track_laps_and_circle 는 비활성 레거시입니다 — 각도 누산은 _update_ring 만 수행')
        loc = self.vehicle.get_location()
        ang = math.atan2(loc.y - self.cy, loc.x - self.cx)
        if self._lap_last_angle is None:
            self._lap_last_angle = ang
            return
        d = math.atan2(math.sin(ang - self._lap_last_angle),
                       math.cos(ang - self._lap_last_angle))
        self._lap_accum_angle += d
        self._lap_last_angle = ang
        laps = abs(self._lap_accum_angle) / (2 * math.pi)

        lap_int = int(laps)
        if lap_int > self._lap_reasserted and lap_int < self.target_laps:
            self._lap_reasserted = lap_int
            self._reassert_loop_path()
            print(f'[Ego] {lap_int}바퀴 — 바깥(진출) 차로 막힘 → 한 바퀴 더 (답답함)')
            _publish_event('scenario_event', {'scenario': 'roundabout', 'event': 'exit_blocked',
                           'attempt': lap_int, 't': round(elapsed, 2)})

        if laps >= self.target_laps:
            print(f'[Ego] 회전교차로 {laps:.1f}바퀴 완료 → 진출(merge-out)')
            _publish_event('scenario_event', {'scenario': 'roundabout', 'event': 'exit_success',
                           'attempt': self.target_laps, 't': round(elapsed, 2)})
            self.trigger_exit()

    def _reassert_loop_path(self):
        """[DEPRECATED — 비활성 레거시] _track_laps_and_circle(비활성) 전용 헬퍼. 활성 FSM은
        _reassert_ring/_lay_ring 을 쓴다. 누산 상태는 건드리지 않으나 호출 경로가 비활성이라 죽은 코드.
        v31: 현재 위치 기준 시계방향 loop 경로를 다시 주입 — TM 이 출구로 빠지지 않고
        계속 순환하게(어느 입구든 N바퀴 보장, 90°만 돌고 나가던 문제 방지)."""
        if not self.vehicle or not self.vehicle.is_alive:
            return
        cx, cy, r = self.cx, self.cy, self.gap_check_radius
        cmap = self.world.get_map()
        loc = self.vehicle.get_location()
        cur = math.atan2(loc.y - cy, loc.x - cx)
        path = []
        step = math.radians(5)
        ang = cur - step
        end = cur - (self.target_laps + 2) * 2 * math.pi
        while ang > end:
            wp = cmap.get_waypoint(
                carla.Location(x=cx + r * math.cos(ang), y=cy + r * math.sin(ang), z=0),
                project_to_road=True, lane_type=carla.LaneType.Driving)
            if wp:
                path.append(wp.transform.location)
            ang -= step
        if path:
            try:
                self.tm.set_path(self.vehicle, path)
            except Exception as e:
                print(f'[Ego] loop 재주입 실패: {e}')

    # ══ C(2026-06-18): 회전교차로 단계기계 (바깥1 → 안쪽3 → STUCK 5s → 바깥1 → 진출) ══
    def _lay_ring(self, radius, laps, merge_from=None, merge_arc_deg=40):
        """현재 위치각부터 CW 로 radius 차로에 laps 바퀴 경로 주입.
        merge_from 지정 시 첫 merge_arc 동안 merge_from→radius 반경 보간(=차선변경)."""
        if not self.vehicle or not self.vehicle.is_alive:
            return
        cmap = self.world.get_map()
        cx, cy = self.cx, self.cy
        loc = self.vehicle.get_location()
        cur = math.atan2(loc.y - cy, loc.x - cx)
        step = math.radians(5)
        merge_arc = math.radians(merge_arc_deg)
        path = []
        ang = cur - step
        end = cur - laps * 2 * math.pi - math.radians(20)
        while ang > end:
            if merge_from is not None and (cur - ang) < merge_arc:
                f = (cur - ang) / merge_arc          # 0→1: merge_from→radius (차선변경)
                rr = merge_from + (radius - merge_from) * f
            else:
                rr = radius
            P = carla.Location(x=cx + rr * math.cos(ang), y=cy + rr * math.sin(ang), z=0)
            wp = cmap.get_waypoint(P, project_to_road=True, lane_type=carla.LaneType.Driving)
            # 도로(진출로 등)로 새는 투영 제거 — 의도한 링 원점에서 3.5m 이내만 채택.
            #   바깥 차로(r23)는 진출 도로와 연결돼 일부 각도에서 도로로 투영되며 ego 를
            #   링 밖으로 끌어냄(드리프트) → 이 필터로 링 위 점만 남겨 순환 유지.
            if wp and wp.transform.location.distance(P) <= 3.5:
                path.append(wp.transform.location)
            ang -= step
        if path:
            try:
                self.tm.set_path(self.vehicle, path)
            except Exception as e:
                print(f'[Ego] _lay_ring 실패: {e}')

    def _reassert_ring(self, radius, laps):
        """정수 바퀴가 늘 때마다 같은 차로 경로 재주입 → TM 이 출구로 새지 않게(순환 유지)."""
        li = int(laps)
        if li > self._lap_reasserted:
            self._lap_reasserted = li
            self._lay_ring(radius, 2)

    def _near_exit_angle(self, ang, tol_deg=25):
        d = math.atan2(math.sin(ang - self.exit_angle), math.cos(ang - self.exit_angle))
        return abs(d) < math.radians(tol_deg)

    def _maybe_emit_deadlock(self, elapsed, laps):
        """C1-4(2026-06-25 재설계): 누적 1.5바퀴(float) 경과 시 '비정상 반복 회전 감지' =
        junction_deadlock_start 첫 발행, 이후 순환(STUCK 진입 전) 동안 매 정수 바퀴마다 재발행.
        OUTER_IN/INNER(순환) 단계에서만 — STUCK/OUTER_OUT 진입 후엔 멈춘다.

        3R-c: 첫 발행은 연속 누산값 laps(1.5바퀴), 이후 재노출은 '직전 발행 + 1.0바퀴'마다
        (정수 스냅 아님 → 1.5,2.5,3.5…). 마지막 발화가 stuck 직전에 몰리지 않게 한다."""
        if self.ring_phase not in ('OUTER_IN', 'INNER'):
            return
        if laps < self.DEADLOCK_START_LAPS:
            return

        def _emit(lap_val):
            # lap 을 payload 안에도 싣는다 — HMI 가 payload.lap 변화로 '바퀴마다 재노출'을
            #   재트리거(같은 C1-4 화면을 매 바퀴 다시 띄움). top-level lap 은 하위호환 유지.
            _publish_event('scenario_event', {
                'scenario': 'roundabout', 'event': 'junction_deadlock_start',
                'phase': 'circling', 't': round(elapsed, 2), 'lap': lap_val,
                'payload': {
                    'lap': lap_val,
                    'recommended_kmh': round(self.ring_speed_kmh),
                    'current_kmh': round(self._get_speed_kmh(), 1),
                    'Nsec_to_recover': None,
                }})

        if not self._deadlock_started:
            # 첫 발행 = 1.5바퀴 도달(연속값). 재노출 기준선 = 이 발행 바퀴.
            self._deadlock_started = True
            self._deadlock_last_emit_lap = laps
            _emit(round(laps, 2))
            return

        # 직전 발행에서 1.0바퀴 경과 시 재발행(1.5 → 2.5 → 3.5 …).
        if laps - self._deadlock_last_emit_lap >= 1.0:
            self._deadlock_last_emit_lap += 1.0
            _emit(round(laps, 2))

    def _update_ring(self, elapsed):
        """누적 회전각으로 단계 전환: 바깥1 → 안쪽3 → STUCK(5s) → 바깥1 → 진출."""
        loc = self.vehicle.get_location()
        ang = math.atan2(loc.y - self.cy, loc.x - self.cx)
        if self._lap_last_angle is None:
            self._lap_last_angle = ang
            return
        d = math.atan2(math.sin(ang - self._lap_last_angle),
                       math.cos(ang - self._lap_last_angle))
        self._lap_accum_angle += d
        self._lap_last_angle = ang
        laps = abs(self._lap_accum_angle) / (2 * math.pi)

        # C1-4: 2바퀴 후 비정상 감지 → 순환(STUCK 진입 전) 동안 매 바퀴 재발행.
        self._maybe_emit_deadlock(elapsed, laps)

        # STUCK: 1차로 한가운데 STUCK_SECS(12s) 정지 (최우선)
        #   2R: lane_change 는 stuck_stop 시점(INNER→STUCK)에 이미 발행됨 → force_merge 까지
        #   STUCK_SECS(~12s) 리드. merge_done(C1-7 정상)은 폐기(발행 안 함).
        if self.ring_phase == 'STUCK':
            self._set_autopilot(False)
            self.vehicle.apply_control(carla.VehicleControl(throttle=0.0, brake=1.0))
            if elapsed - self._stuck_t0 >= self.STUCK_SECS:
                self.ring_phase = 'OUTER_OUT'
                self._stuck_done_lap = laps
                self._lap_reasserted = int(laps)
                self._set_autopilot(True)
                self._lay_ring(self.outer_radius, self.OUTER_OUT_LAPS + 1,
                               merge_from=self.inner_radius)      # 강제 비집기(안쪽→바깥)
                print('[Ego] 정지 종료 → 2차로 강제 비집기 → 바깥 순환')
                _publish_event('scenario_event', {'scenario': 'roundabout', 'event': 'force_merge',
                               't': round(elapsed, 2)})
                self._force_merge_t = elapsed
                # C1-8(abnormal_loop) 3R-b: force_merge 후 ABNORMAL_LOOP_DELAY_SECS(5s) '정상 주행'
                #   뒤 발화(아래 OUTER_OUT 블록). 사용자 피드백: 강제진입해 정상 주행하다 5초 후
                #   '출구를 빠져나가지 못해 한 바퀴 더'.
            return

        # 바깥 1바퀴 → 1차로(안쪽) 차선변경
        if self.ring_phase == 'OUTER_IN':
            if laps >= self.OUTER_IN_LAPS:
                self.ring_phase = 'INNER'
                self._lap_reasserted = int(laps)
                self._lay_ring(self.inner_radius, self.INNER_LAPS + 1,
                               merge_from=self.outer_radius)
                print(f'[Ego] 바깥 {self.OUTER_IN_LAPS}바퀴 → 1차로 차선변경 → 안쪽 {self.INNER_LAPS}바퀴')
                _publish_event('scenario_event', {'scenario': 'roundabout', 'event': 'to_inner',
                               't': round(elapsed, 2)})
                # C1-4 junction_deadlock_start 는 to_inner 직후가 아니라 '2바퀴 후·바퀴마다'
                #   _maybe_emit_deadlock 가 담당(아래 _update_ring 상단에서 매 틱 호출).
            else:
                self._reassert_ring(self.outer_radius, laps)
            return

        # 안쪽 3바퀴 → 진출각 근처서 STUCK
        if self.ring_phase == 'INNER':
            inner_done = laps - self.OUTER_IN_LAPS
            if inner_done >= self.INNER_LAPS - 0.2 and self._near_exit_angle(ang):
                self.ring_phase = 'STUCK'
                self._stuck_t0 = elapsed
                print('[Ego] 안쪽 3바퀴 + 진출지점 → 1차로 한가운데 정지(갇힘)')
                _publish_event('scenario_event', {'scenario': 'roundabout', 'event': 'stuck_stop',
                               't': round(elapsed, 2)})
                # C1-6 사전고지(lane_change) 2R: stuck_stop 시점에 즉시 발행 → force_merge 까지
                #   STUCK_SECS(~12s) 리드(최대한 앞당김). 사용자 요청: 차선변경을 더 일찍 알림.
                if not self._ev_lane_change:
                    self._ev_lane_change = True
                    print(f'[Ego] stuck_stop 시점 → 2차로 차선 변경 사전고지(lane_change, '
                          f'force_merge {self.STUCK_SECS:.0f}s 전)')
                    _publish_event('scenario_event', {
                        'scenario': 'roundabout', 'event': 'lane_change',
                        't': round(elapsed, 2),
                        'payload': {'current_kmh': round(self._get_speed_kmh(), 1)}})
            else:
                self._reassert_ring(self.inner_radius, laps)
            return

        # C1 타이밍 재설계 2R(2026-06-25): abnormal_loop 은 force_merge 직후(위 STUCK 블록)에서
        #   이미 발행됨. 여기 OUTER_OUT 은 '한 바퀴'(out_done≥OUTER_OUT_LAPS=1) 돌고 진출각에서
        #   trigger_exit. exit_success 는 여기서 발행하지 않는다 — 실제 진출(DRIVING→DONE)을
        #   main.py 가 아닌 update() DRIVING→DONE 전이에서 발행(R 항목 7).
        if self.ring_phase == 'OUTER_OUT':
            out_done = laps - self._stuck_done_lap
            at_exit = self._near_exit_angle(ang)
            # C1-8(abnormal_loop) 3R-b(피드백): force_merge 후 ABNORMAL_LOOP_DELAY_SECS(5s)
            #   '정상 주행' 뒤 '출구 못 빠져나가 한 바퀴 더' 1회 발행. (옛 0.3바퀴 → 5초 시간게이트.)
            if not self._ev_abnormal_loop \
                    and (elapsed - self._force_merge_t) >= self.ABNORMAL_LOOP_DELAY_SECS:
                self._ev_abnormal_loop = True
                print(f'[Ego] force_merge 후 {self.ABNORMAL_LOOP_DELAY_SECS:.0f}s 정상 주행 → 한 바퀴 더 (abnormal_loop)')
                _publish_event('scenario_event', {
                    'scenario': 'roundabout', 'event': 'abnormal_loop',
                    't': round(elapsed, 2),
                    'payload': {'current_kmh': round(self._get_speed_kmh(), 1)}})
            if out_done >= self.OUTER_OUT_LAPS - 0.2 and at_exit:
                print(f'[Ego] 바깥 {self.OUTER_OUT_LAPS}바퀴 완료 → 진출(merge-out)')
                self.trigger_exit()
            else:
                self._reassert_ring(self.outer_radius, laps)
            return

    def update(self, elapsed):
        if not self.vehicle or not self.vehicle.is_alive:
            return

        # C1-1(drive_start): 시나리오/자유주행 시작 = 정상 주행. 첫 update 틱에서 1회 발행.
        #   이벤트(링 순환) 전 0~free_roam_secs 정상주행 구간을 HMI 가 C1-1 정상으로 표시.
        if not self._ev_drive_start:
            self._ev_drive_start = True
            _publish_event('scenario_event', {'scenario': 'roundabout', 'event': 'drive_start',
                           't': round(_t.time(), 2),
                           'payload': {'current_kmh': round(self._get_speed_kmh(), 1)}})

        # 페이드인 진행(텔레포트 직후 = state 가 이미 WAITING 이라 FREE_ROAM 밖에서 처리해야 함).
        if self._fade_phase == 'in':
            a = min(1.0, (elapsed - self._fade_t0) / max(0.1, self.fade_in_dur))
            self.fade_alpha = int(255 * (1.0 - a))
            if a >= 1.0:
                self.fade_alpha = 0
                self._fade_phase = None

        if self.state == 'FREE_ROAM':
            # v31: 정상주행 = TM autopilot 자유주행(신호 준수·트래픽 섞임, 도심 어디든).
            #   free_roam_secs 경과 = '무장'. 이후 ego 가 **어느 출입구로든** 회전교차로 링에
            #   진입(중심 반경 ring_trigger_radius 안)하면 그 자리에서 이벤트 점화(텔레포트 없음).
            #   → '특정 위치에서만 트리거'(구) 폐기, '어느 입구든 진입 시 N바퀴 순환'(사용자 요청).
            if not self.autopilot_on:
                self._set_autopilot(True)

            # ── 텔레포트 타이밍 모드(옵션 A): 근접 트리거 대신 시간 도달 시 페이드→텔레포트 ──
            #   free_roam_secs 정상주행 → 페이드아웃(암전) → 진입점 텔레포트 → 페이드인 → 이벤트.
            #   SPACE 로 조기 시작도 가능. 좌표경로/근접진입의 Town03 불가 문제를 근본 회피.
            if self.free_roam_teleport:
                if not self._tp_started and (elapsed >= self.free_roam_secs
                                             or self._event_triggered):
                    self._tp_started = True
                    self._fade_phase = 'out'
                    self._fade_t0 = elapsed
                    print(f'[Ego] t={elapsed:.0f}s — 정상주행 종료 → 페이드아웃(텔레포트 준비)')
                if self._fade_phase == 'out':
                    a = min(1.0, (elapsed - self._fade_t0) / max(0.1, self.fade_out_dur))
                    self.fade_alpha = int(255 * a)
                    if a >= 1.0:
                        self.fade_alpha = 255
                        self._start_event_at_entry(elapsed)   # 암전 상태에서 순간이동
                        self._fade_phase = 'in'               # 다음 틱부터 페이드인(update 상단에서 처리)
                        self._fade_t0 = elapsed
                return

            armed = elapsed >= self.free_roam_secs
            if armed and not self._armed:
                self._armed = True
                print(f'[Ego] t={elapsed:.0f}s — 이벤트 무장 '
                      f'(이후 어느 입구로든 링 진입 시 점화)')

            loc = self.vehicle.get_location()
            dist_c = math.hypot(loc.x - self.cx, loc.y - self.cy)

            # v32 리시: 로터리에서 free_roam_leash 밖으로 나가면 짧은 경로로 끌어당김 →
            #   ego 가 로터리 근처를 계속 돌게 해 자연 진입 확률↑(Town03 장거리 방황·라우팅 불안정 회피).
            #   짧은 경로(≤리시 반경)라 set_path 추종이 안정적. 8s 간격으로만 재주입.
            if dist_c > self.free_roam_leash and self.route_planner_fn is not None \
                    and (elapsed - self._last_leash) > 8.0:
                self._last_leash = elapsed
                seg = self.route_planner_fn(loc)
                if seg:
                    try:
                        self.tm.set_path(self.vehicle, seg)
                        print(f'[Ego] 리시 — 로터리에서 {dist_c:.0f}m 멀어짐 → 근처로 유도({len(seg)})')
                    except Exception:
                        pass

            # 점화: 버튼(SPACE) 또는 (무장 & 링 진입 감지)
            if self._event_triggered or (armed and dist_c <= self.ring_trigger_radius):
                self._start_event_in_place(elapsed)
                return

            # 폴백: 무장 후 일정 시간 미진입 → 링쪽 유도(route_planner_fn). 그래도 한참 안 들어오면
            #   (2×fallback) 최후 수단으로 진입점 텔레포트(이벤트는 반드시 발생하도록).
            if armed:
                over = elapsed - self.free_roam_secs
                if over >= self.free_roam_fallback_secs and not self._fallback_routed \
                        and self.route_planner_fn is not None:
                    seg = self.route_planner_fn(loc)
                    if seg:
                        try:
                            self.tm.set_path(self.vehicle, seg)
                            self._fallback_routed = True
                            print(f'[Ego] 무장 후 미진입 → 링쪽 유도 경로 주입({len(seg)}개)')
                        except Exception as e:
                            print(f'[Ego] 유도 경로 실패: {e}')
                if over >= 2 * self.free_roam_fallback_secs:
                    print('[Ego] 유도에도 미진입 → 최후 텔레포트로 이벤트 시작')
                    self._start_event_at_entry(elapsed)
            return

        if self.state == 'APPROACHING':
            # 접근 단계: autopilot ON, 도로 따라가게 TM 에 맡김
            if not self.autopilot_on:
                self._set_autopilot(True)

            loc = self.vehicle.get_location()

            # 경로 진행도(인덱스) 전진 추적 — 장거리 투어가 중간에 회전교차로 근처를
            # 지나가도 '경로 끝'에 도달하기 전엔 WAITING 으로 전환하지 않기 위함(조기발화 방지).
            n = len(self.approach_waypoints)
            if n >= 2:
                while self._route_idx < n - 1:
                    d_cur = loc.distance(self.approach_waypoints[self._route_idx].transform.location)
                    d_nxt = loc.distance(self.approach_waypoints[self._route_idx + 1].transform.location)
                    if d_nxt <= d_cur:
                        self._route_idx += 1
                    else:
                        break
                near_route_end = self._route_idx >= n - 3
            else:
                near_route_end = True

            # 원래 진입점까지 거리 체크 (경로 끝 도달했을 때만)
            sx, sy = self.spawn_location
            dist_to_entry = math.hypot(loc.x - sx, loc.y - sy)

            # 게이트 근접: 거리에 비례해 점진 감속 (거리 두고 천천히 — 급정지 방지, 리그 피드백)
            if near_route_end and dist_to_entry < 25.0:
                slow = max(8.0, self.target_speed_kmh * (dist_to_entry / 25.0))
                try:
                    self.tm.set_desired_speed(self.vehicle, slow)
                except Exception:
                    pass

            if near_route_end and dist_to_entry < self.approach_target_radius:
                print(f'[Ego] APPROACHING → WAITING '
                      f'(진입점 도착 t={elapsed:.1f}s, dist={dist_to_entry:.1f}m, '
                      f'route {self._route_idx}/{n})')
                self.state = 'WAITING'
                self._set_autopilot(False)
                # 이제 회전교차로 loop path + 정상 속도 적용
                self._setup_loop_path()
            return

        if self.state == 'WAITING':
            # 대기 타임아웃: max_wait_time 초과 시 강제 모드(더 작은 빈틈에도 진입 허용).
            if self.wait_time >= self.max_wait_time and not self.forced_mode:
                self.forced_mode = True
                print(f'[Ego] 대기 {self.wait_time:.1f}s 초과 (한계 '
                      f'{self.max_wait_time:.0f}s) → 강제 진입 모드(더 작은 빈틈에도 진입)')

            # v22e: 진입 = 바깥 차로(2차로) 횡단이 관건. 안쪽/바깥 '최근접 NPC 각거리'로 판단:
            #   commit(진입): 안쪽>in_commit AND 바깥>out_commit (빈틈 확보) → DRIVING(TM).
            #   brake(정지): 코앞에 차(entry_brake_*) 또는 더 나갈 데 없음 → 정지.
            #   그 사이(애매한 간격) → creep(살짝 전진) → 곧 코앞 차에 걸려 멈춤 = **움찔움찔**
            #     (탑승자가 '나가려다 못 나가는' 답답함을 체감). NPC 는 TM 이라 ego 가 코를
            #     내밀어도 충돌 회피(0충돌). 강제 모드면 임계를 낮춰 결국 비집고 진입.
            in_commit  = self.force_gap_angle if self.forced_mode else self.gap_check_angle
            out_commit = self.outer_force_gap if self.forced_mode else self.outer_entry_gap
            near_in  = self._nearest_angle_gap(self.entry_angle, self.npc_module.inner_angles)
            near_out = self._nearest_angle_gap(self.entry_angle, self.npc_module.outer_angles)

            # 3R(피드백 A): 빈틈이 확보돼도 최소 MIN_STRUGGLE_SECS 분투 전엔 커밋 보류
            #   → C1-2('진입 어려움') 노출창 연장. (wait_time 은 매 틱 증가 → 데드락 없음.)
            enough_struggle = self.wait_time >= self.MIN_STRUGGLE_SECS
            if near_in >= in_commit and near_out >= out_commit and enough_struggle:
                self.state = 'DRIVING'
                self._set_autopilot(True)
                self._was_creeping = False
                tag = ' (강제)' if self.forced_mode else ''
                print(f'[Ego] WAITING → DRIVING (대기 {self.wait_time:.1f}s, 빈틈 확보 진입){tag}')
                # C1-3(enter_success) 2R: WAITING→DRIVING 전이는 강제진입 순간(0.3km/h 정지상태)이라
                #   여기서 발화하면 '거의 멈춘 채 정상'이 뜬다. 진입 플래그만 세우고, 실제 발화는
                #   DRIVING 상태에서 속도가 ENTER_SUCCESS_KMH 이상 회복(원 안 순환)될 때 1회.
                self._enter_pending = True
            else:
                self.wait_time += 0.05
                self._set_autopilot(False)
                loc = self.vehicle.get_location()
                dist_c = math.hypot(loc.x - self.cx, loc.y - self.cy)
                blocked = (near_in < self.entry_brake_in) or (near_out < self.entry_brake_out)
                at_ring = dist_c <= (self.outer_radius + 1.0)   # C: 바깥 차로(2차선) 진입 → outer 직전까지만 creep
                if blocked or at_ring:
                    # 코앞에 차 / 더 나갈 데 없음 → 정지(움찔의 '멈춤')
                    self.vehicle.apply_control(carla.VehicleControl(throttle=0.0, brake=1.0))
                    # C1 gap_attempt 3R-b: 움찔(creep)했다가 다시 막혀 속도가 ~0 으로 복귀한
                    #   순간 1발행(속도 0→튐→0 의 '실패한 진입 시도' 완료 시점). creep 중이었고
                    #   (=_was_creeping) 속도가 GAP_ATTEMPT_STOP_KMH 이하로 떨어졌을 때만.
                    #   scenarioQA c1_success_rate = cleared / gap_attempt.
                    if self._was_creeping and self._get_speed_kmh() <= self.GAP_ATTEMPT_STOP_KMH:
                        self._was_creeping = False
                        self._gap_attempt_n += 1
                        # C1-2(2026-06-25): attempt_n 을 payload 안에도 싣는다 — HMI 가
                        #   payload.attempt_n>=2 일 때만 C1-2('진입 간격 확보 어려움')로 게이팅.
                        _publish_event('scenario_event', {
                            'scenario': 'roundabout', 'event': 'gap_attempt',
                            't': round(_t.time(), 2),
                            'attempt_n': self._gap_attempt_n,
                            'payload': {'attempt_n': self._gap_attempt_n,
                                        'current_kmh': round(self._get_speed_kmh(), 1),
                                        'forced': self.forced_mode}})
                else:
                    # 애매한 간격 → 살짝 전진(크립). 곧 위 blocked 에 걸려 멈춤 = 움찔움찔.
                    self.vehicle.apply_control(
                        carla.VehicleControl(throttle=self.creep_throttle, brake=0.0))
                    self._was_creeping = True

        elif self.state == 'DRIVING':
            # C1-3(enter_success) 2R: 진입 후 '안착' = 원 안에서 속도가 회복되어 실제 순환할 때 발화.
            #   강제진입 직후의 0.3km/h 정지상태가 아니라 ENTER_SUCCESS_KMH(9km/h) 이상 1회.
            #   (STUCK 단계는 의도된 정지라 enter_success 가 이미 발화된 뒤이므로 영향 없음.)
            #   3R(피드백): 속도 + 링 누적 회전각(2차선 완벽 진입·순환 시작) 둘 다 만족 시 발화.
            _entered_laps = abs(self._lap_accum_angle) / (2 * math.pi)
            if self._enter_pending and not self._ev_enter_success \
                    and self._get_speed_kmh() >= self.ENTER_SUCCESS_KMH \
                    and _entered_laps >= self.ENTER_SUCCESS_MIN_LAPS:
                self._ev_enter_success = True
                self._enter_pending = False
                _publish_event('scenario_event', {
                    'scenario': 'roundabout', 'event': 'enter_success',
                    't': round(_t.time(), 2),
                    'payload': {'forced': self.forced_mode,
                                'current_kmh': round(self._get_speed_kmh(), 1)}})
            # v31: '여러 바퀴 순환 후 진출'(고정 N바퀴 = 사용자 결정). 진입 위치 무관(어느 입구든).
            #   누적 회전각으로 바퀴 수를 세고, 매 바퀴 loop 경로를 재주입해 TM 이 출구로 새는 것
            #   (=90°만 돌고 나가던 문제) 방지 → target_laps 도달 시 merge-out 진출(검증된 trigger_exit).
            if not self.exit_triggered:
                self._update_ring(elapsed)              # C: outer1→inner3→STUCK→outer1→진출
            if self.exit_triggered and self._is_near_exit(threshold=10.0):
                self.state = 'DONE'
                print('[Ego] DRIVING → DONE')
                # C1-9(exit_success): 실제로 출구를 빠져나간 순간(=DONE) 발행. R 항목 7 —
                #   옛 _update_ring(링 안 진출각)에서 51s 빨리 발행하던 것을 실제 진출로 정합.
                #   직후 main.py 루프가 DONE 감지해 cleared(정상 복귀)를 잇는다.
                _publish_event('scenario_event', {
                    'scenario': 'roundabout', 'event': 'exit_success',
                    't': round(_t.time(), 2),
                    'payload': {'current_kmh': round(self._get_speed_kmh(), 1)}})

        elif self.state == 'DONE':
            pass

    def _track_laps(self):
        """[DEPRECATED — 비활성 레거시] 링 중심 누적 회전각 적분 자동출구. 활성 FSM(_update_ring)과
        _lap_accum_angle/_lap_last_angle 누산을 공유하므로(G0-5), 재활성 시 활성 각도를 오염시킨다.
        호출을 막아 격리한다. (코드는 이력 보존용으로 아래에 남겨둠.)"""
        raise RuntimeError(
            '_track_laps 는 비활성 레거시입니다 — 각도 누산은 _update_ring 만 수행')
        if self.exit_triggered:
            return
        loc = self.vehicle.get_location()
        ang = math.atan2(loc.y - self.cy, loc.x - self.cx)
        if self._lap_last_angle is None:
            self._lap_last_angle = ang
            return
        # 프레임 간 각도 변화를 [-pi, pi] 로 unwrap 후 누적 (CW = 음수 방향)
        d = math.atan2(math.sin(ang - self._lap_last_angle),
                       math.cos(ang - self._lap_last_angle))
        self._lap_accum_angle += d
        self._lap_last_angle = ang

        if abs(self._lap_accum_angle) >= self.target_laps * 2 * math.pi:
            laps = abs(self._lap_accum_angle) / (2 * math.pi)
            print(f'[Ego] 회전교차로 {laps:.1f}바퀴 완료 → 자동 출구')
            self.trigger_exit()

    def _handle_exit_attempts(self, elapsed):
        """[DEPRECATED — 비활성 레거시] 활성 FSM(_update_ring)이 진출 단계를 대체. 호출 경로 없음.
        (lap 누산 상태는 안 건드림 — 격리 대상 아님.)
        2차로 진출-블록 답답함: 매 바퀴 진출각 통과 시 진출 시도.
        1·2회차 = 바깥 차로 막힘 → 블록(한 바퀴 더, 마커 발행).
        exit_attempt_target(3) 회차부터 = 바깥 차로(진출 차로) 빈틈이 진출각에 오면 진출."""
        if self.exit_triggered:
            return
        loc = self.vehicle.get_location()
        ego_ang = math.atan2(loc.y - self.cy, loc.x - self.cx)
        # 시계방향 진행이라 ego 는 진출각보다 '큰 쪽(앞)'에서 접근 → delta>0 가 진출각 직전.
        delta = math.atan2(math.sin(ego_ang - self.exit_angle),
                           math.cos(ego_ang - self.exit_angle))   # [-pi, pi]
        window = math.radians(35.0)        # 진출각 35° 전 = 결정/머지 시작 구간
        in_window = (0.0 < delta <= window)

        # 이번 바퀴 윈도 첫 진입 = 새 진출 시도. v22g: 1·2회차는 블록(스크립트), 3회차에
        #   진출 경로를 깔아둔다 → TM 이 바깥 차로 빈틈 날 때 안전 머지(들이받지 않음=0충돌).
        #   (내 gap 검사로 무리한 강제진출하던 것 폐기 — 충돌 원인이었음.)
        if in_window and not self._exit_window_latched:
            self._exit_window_latched = True
            self._exit_pass_count += 1
            if self._exit_pass_count < self.exit_attempt_target:
                print(f'[Ego] 진출 {self._exit_pass_count}회차 시도 — 바깥 차로(2차로) 막힘 '
                      f'→ 진출 실패, 한 바퀴 더 (답답함)')
                _publish_event('scenario_event',
                               {'scenario': 'roundabout', 'event': 'exit_blocked',
                                'attempt': self._exit_pass_count, 't': round(elapsed, 2)})
            else:
                print(f'[Ego] 진출 {self._exit_pass_count}회차 — 진출 경로 설정 '
                      f'→ TM 이 바깥 차로 빈틈 날 때 안전 머지·진출')
                _publish_event('scenario_event',
                               {'scenario': 'roundabout', 'event': 'exit_success',
                                'attempt': self._exit_pass_count, 't': round(elapsed, 2)})
                self.trigger_exit()
        elif delta <= 0.0 or delta > window + math.radians(10.0):
            self._exit_window_latched = False   # 진출각 지나감 → 다음 바퀴 위해 래치 해제

    def adjust_gap_angle(self, delta_deg):
        new_deg = math.degrees(self.gap_check_angle) + delta_deg
        new_deg = max(5.0, min(60.0, new_deg))
        self.gap_check_angle = math.radians(new_deg)
        return new_deg

    def reset_gap_angle(self):
        self.gap_check_angle = self.default_gap_angle
        return math.degrees(self.gap_check_angle)

    def adjust_leading_distance(self, delta_m):
        self.leading_distance = max(0.5, min(15.0,
            self.leading_distance + delta_m))
        self.tm.distance_to_leading_vehicle(self.vehicle, self.leading_distance)
        return self.leading_distance

    def trigger_force_enter(self, duration=1.5):
        # v21: 강제 모드 ON (대기 무시). 단 WAITING 게이트가 '입구 빌 때만' 진입시켜
        #   정면충돌을 막는다(즉시 램 진입 아님). SPACE 수동 키도 이 경로를 탄다.
        self.force_enter_until = _t.time() + duration
        self.forced_mode = True
        print('[Ego] 강제 진입 모드 ON (입구 빌 때 진입)')

    def trigger_exit(self):
        """E 키 등으로 호출: 현재 위치부터 회전교차로 출구까지 경로 재설정."""
        if self.exit_triggered:
            print('[Ego] 이미 출구 트리거됨')
            return
        if not self.vehicle or not self.vehicle.is_alive:
            return

        self.exit_triggered = True

        # v22g: collision_detection 은 그대로 ON 유지(끄지 않음). NPC 가 TM autopilot 이라
        #   ego 와 서로 회피하므로, 진출 경로를 깔아두면 TM 이 바깥 차로 빈틈이 날 때
        #   '안전하게' 머지·진출한다(들이받지 않음 = 0충돌). 빈틈이 없으면 잠깐 더 돌다 나간다.

        cx, cy = self.cx, self.cy
        r = self.gap_check_radius
        ex, ey = self.exit_location
        carla_map = self.world.get_map()

        # 현재 ego 각도 계산
        loc = self.vehicle.get_location()
        cur_angle = math.atan2(loc.y - cy, loc.x - cx)

        # exit_angle을 cur_angle보다 작게 정규화 (CW 진행)
        end = self.exit_angle
        while end >= cur_angle:
            end -= 2 * math.pi

        new_path = []

        def add_wp(x, y):
            wp = carla_map.get_waypoint(
                carla.Location(x=x, y=y, z=0),
                project_to_road=True,
                lane_type=carla.LaneType.Driving)
            if wp:
                new_path.append(wp.transform.location)

        # 현재 위치 → 출구 각도까지 CW (#3: 10°→5° 촘촘하게).
        #   v22: 진출각 merge_arc° 전부터 안쪽(r)→바깥(outer) 반경으로 보간해 차로 머지.
        r_out = self.outer_radius
        merge_arc = math.radians(30.0)
        step = math.radians(5)
        a = cur_angle - step
        while a > end:
            d_to_exit = a - end                       # >0, 진출각에 가까워질수록 0
            if d_to_exit < merge_arc:
                f = 1.0 - (d_to_exit / merge_arc)     # 0→1: 안쪽→바깥
                rr = r + (r_out - r) * f
            else:
                rr = r
            add_wp(cx + rr * math.cos(a), cy + rr * math.sin(a))
            a -= step

        # 링 출구점 (바깥 차로 = 진출 차로)
        ring_exit_x = cx + r_out * math.cos(self.exit_angle)
        ring_exit_y = cy + r_out * math.sin(self.exit_angle)
        add_wp(ring_exit_x, ring_exit_y)

        # 출구 도로 경유점
        for t in [0.3, 0.6, 1.0]:
            add_wp(
                ring_exit_x + (ex - ring_exit_x) * t,
                ring_exit_y + (ey - ring_exit_y) * t,
            )

        print(f'[Ego] 출구 트리거! 갱신 경로 {len(new_path)}개 waypoint')
        if new_path:
            try:
                self.tm.set_path(self.vehicle, new_path)
                print('[Ego] TM 경로 재설정 완료 (출구 모드)')
            except Exception as e:
                print(f'[Ego] set_path 실패: {e}')

    def get_current_gap_deg(self):
        return math.degrees(self.gap_check_angle)

    def get_state(self):
        if not self.vehicle or not self.vehicle.is_alive:
            return None
        tf = self.vehicle.get_transform()
        return {
            'state': self.state,
            'x': tf.location.x,
            'y': tf.location.y,
            'speed_kmh': self._get_speed_kmh(),
            'wait_time': self.wait_time,
            'collisions': len(self.collision_history),
            'leading_distance': self.leading_distance,
            'event_started': self.event_started,   # v31: 링 순환 이벤트 시작 여부(답답함 모션 게이트)
        }

    def cleanup(self):
        if self.collision_sensor and self.collision_sensor.is_alive:
            self.collision_sensor.destroy()
        if self.vehicle and self.vehicle.is_alive:
            self._set_autopilot(False)
            self.vehicle.destroy()
        print(f'[Ego] 정리 완료 — 대기 {self.wait_time:.1f}s, '
              f'충돌 {len(self.collision_history)}회')
