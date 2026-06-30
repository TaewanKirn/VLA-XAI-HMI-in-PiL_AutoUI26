import carla
import math
import time
import sys
import os
import random

# ── data-server / scenarios 경로를 sys.path에 추가 ──
_BASE = os.path.dirname(os.path.abspath(__file__))
_DATA_SERVER    = os.path.normpath(os.path.join(_BASE, '..', '..', 'data-server'))
_SCENARIOS_ROOT = os.path.normpath(os.path.join(_BASE, '..'))
for _p in (_DATA_SERVER, _SCENARIOS_ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# 6DOF 프로파일 자동 선택: 이 시나리오 = A(답답함). 파이프라인 import '전에' 설정해야 함.
os.environ['SCENARIO'] = 'A'

from core.carla_setup import (
    connect, load_or_get_world, cleanup_actors,
    enable_sync_mode, disable_sync_mode
)
from perf import apply_lightweight_settings
from launch_viewer import launch_viewer_bat
from launch_hmi import launch_hmi                        # HMI 오버레이(중앙상단 640x480) DiL 직접 표시
from launch_map import launch_map                       # HDMap 웹뷰어 자동 오픈
from launch_monitor import launch_monitor               # 실험상황 모니터(ws_monitor) 자동 오픈
from traffic import spawn_ambient_traffic, destroy_traffic, spawn_slow_crawler  # 트래픽 + 서행 크롤러
from core.spectator import TopDownSpectator
from modules.roundabout_npc import RoundaboutNPC
from modules.ego_controller import EgoController
from modules.ego_camera import EgoCamera

# ── 6DOF UDP 송신 (data-server/collector) ──
try:
    from collector.carla_collector import run_collector, stop_collector
    UDP_AVAILABLE = True
    print('[Main] 6DOF UDP 모듈 로드 성공')
except ImportError as e:
    UDP_AVAILABLE = False
    print(f'[Main] 6DOF UDP 모듈 없음 → 모션 시뮬레이터 비활성: {e}')

# ── 답답함 이벤트(WAITING 중 반복 lurch) + 이벤트 마커 ──
try:
    from processing.transforms import trigger_event, stop_event, set_dt as set_motion_dt
    from sender.websocket_sender import publish_event
    FRUST_AVAILABLE = True
except ImportError as e:
    FRUST_AVAILABLE = False
    print(f'[Main] 답답함 이벤트 모듈 없음(무시): {e}')

# ── 장거리 접근 경로용 GlobalRoutePlanner (CARLA agents) ──
sys.path.append(r'C:\CARLA_0.9.15\PythonAPI\carla')
try:
    from agents.navigation.global_route_planner import GlobalRoutePlanner
    GRP_AVAILABLE = True
except Exception as e:
    GRP_AVAILABLE = False
    print(f'[Main] GRP 모듈 없음 → 짧은 pre_spawn 접근으로 대체: {e}')

# ================================================================
# 시나리오 설정
# ================================================================
# 재현성: 분석계획 §5 SEED=2026 고정. 주변차·스폰·TM 거동을 결정론화해
#   동일 빌드 재실행 시 CV가 수렴하도록 한다. 환경변수 SCENARIO_SEED 로 override 가능.
#   ⚠️ GPU 물리(서브스텝)·부동소수점·try_spawn 점유 충돌 등 시드로도 못 잡는 잔여는 남는다(아래 주석).
SEED              = int(os.environ.get('SCENARIO_SEED', '2026'))
TOWN              = 'Town03'
SCENARIO_DURATION = 600.0   # 2026-06-25: 500→600. 실측 드라이런서 이벤트 아크가 500s 안에 안 끝남
                            #   (junction_deadlock_start lap2 t≈374s·lap3 t≈405s, 이후 바퀴마다 재발행 지속).
                            #   600s 로 회전교차로 정체 사이클 충분히 관측. (이력 2026-06-19: 600→400→500.)
SIM_DELTA         = 1.0 / 26   # ≈38.5ms. 실측: 서버 틱 계산(물리+~50액터)이 ~38ms = 천장 ~26Hz.
                               #   delta 를 이 천장에 맞춰 '진짜 실시간 26Hz'로 돌린다(구 0.05=20Hz보다 매끄럽고,
                               #   1/30 처럼 delta<틱 이면 슬로모션이 되므로 천장값으로 고정).
                               #   ⚠️ 30Hz(33ms)는 틱이 못 따라가 0.88× 슬로모션 → 불가(실측). 병목은 해상도 아님(물리/액터).
ROUNDABOUT_CENTER = (0.0, 0.0)
SPECTATOR_HEIGHT  = 400.0   # 회전교차로 위 m. 클수록 넓게 보임 (디버깅용)
TRAFFIC_N         = 35      # v23d: 70→35. 70대는 신호 준수 시 긴 접근 경로에서 ego가 정체·빨간불에
                            #   막혀 정지(도달 실패). 35로 줄여 정체↓ → 신호 준수 유지하며 도달 시도(사용자 결정).
                            #   회전교차로 링은 별도 RoundaboutNPC(TM), ambient 는 링 반경 40m 밖에만 스폰.
ROUNDABOUT_EXCLUDE_RADIUS = 40.0  # v21: ambient 를 회전교차로 중심 반경 40m(링19+진입구28) 밖에만
                                  #   스폰 → 링엔 통제된 RoundaboutNPC 5대만 남아 gap-gate 예측대로 동작
                                  #   (핸드오프 #4: ambient 를 링 밖으로 제외).

EGO_ENTRY_POINT   = (3.0, 28.0)   # 기본/폴백 진입점(북). 안내경로 랜덤이 켜지면 ENTRANCE_POINTS 중 선택.
EGO_EXIT_POINT    = (50.0, 3.0)   # 진출(동쪽 출구 도로) — 어느 입구로 들어와도 N바퀴 후 이쪽으로 머지·진출.

# v32(사용자 결정 + 실차 제약): '입구 세션별 랜덤'. 세션마다 ENTRANCE_POINTS 중 하나를 랜덤 선택해
#   그 입구로 진입(피험자별 다른 입구 = '어느 입구든').
#   ENTRANCE_POINTS = 맵 프로브로 찾은 회전교차로 4개 진입로(링 바깥 driving wp, 중심 방향).
# ⚠️ 장거리 접근(자유주행·GRP 안내경로) = Town03+TM 에서 ego 를 목적지로 못 데려옴(검증, 재시도 금지).
#   → 신뢰 가능한 **짧은 pre_spawn 접근**(입구 상류 ~85m 스폰→곧장 진입)을 사용. 사전 주행은 짧음.
#   USE_GUIDED_APPROACH=True 로 두면 GRP 안내경로(~150s)를 쓰지만 도달 불안정(비권장).
RANDOM_ENTRANCE     = False    # ⚠️ 실차 검증: 짧은 접근도 입구마다 신뢰성 편차(북=OK, 서=정지). 검증된
                               #   북쪽(EGO_ENTRY_POINT) 고정이 유일하게 이벤트 완주 확인됨 → 기본 False.
                               #   True 로 켜면 ENTRANCE_POINTS 중 랜덤(코드 보존, Town03 접근 불안정 주의).
USE_GUIDED_APPROACH = False    # ⚠️ Town03 장거리 추종 불안정(자유주행/GRP 모두 도달 실패) → 항상 False(짧은 pre_spawn)
ENTRANCE_POINTS = [
    (3.7,  27.8),    # 북
    (22.9, -9.3),    # 동
    (-9.6, -23.9),   # 남
    (-22.3, 9.1),    # 서
]
GUIDED_LEN_MIN_M = 1100.0   # 안내경로 목표 길이 하한(m) ≈ 130s @30km/h
GUIDED_LEN_MAX_M = 1500.0   # 상한 ≈ 180s. 너무 길면 Town03 set_path 추종 불안정.


def _build_guided_approach(grp, world, entry_xy,
                           min_m=GUIDED_LEN_MIN_M, max_m=GUIDED_LEN_MAX_M):
    """GRP 로 '먼 spawn → 진입점' 안내경로 생성(~150~200s 정상주행). 경로 길이가 목표 범위인
    spawn point 를 찾아 사용(못 찾으면 중앙값에 가장 근접한 것 폴백). 반환: list[carla.Location]
    (spawn→…→entry) 또는 None."""
    entry_loc = carla.Location(x=entry_xy[0], y=entry_xy[1], z=0.2)
    sps = list(world.get_map().get_spawn_points())
    random.shuffle(sps)
    mid = 0.5 * (min_m + max_m)
    best = None  # (route, length)
    for sp in sps:
        try:
            route = grp.trace_route(sp.location, entry_loc)
        except Exception:
            continue
        if len(route) < 2:
            continue
        L = 0.0
        for i in range(1, len(route)):
            L += route[i - 1][0].transform.location.distance(route[i][0].transform.location)
        if min_m <= L <= max_m:
            best = (route, L)
            break
        if best is None or abs(L - mid) < abs(best[1] - mid):
            best = (route, L)
    if best is None:
        return None
    route, L = best
    locs = [wp.transform.location for k, (wp, _o) in enumerate(route) if k % 3 == 0]
    locs.append(entry_loc)
    print(f'[Approach] 안내경로 생성: 길이 {L:.0f}m (~{L/8.3:.0f}s @30km/h), '
          f'{len(locs)}점 → 입구 {entry_xy}')
    return locs


def _walk_upstream_road(world, anchor_xy, road_m, step=5.0):
    """앵커 waypoint 에서 previous() 로 '도로를 따라' road_m 미터 거슬러 올라가며(=회전교차로에서
    더 멀어지는 방향) waypoint 를 수집. 벡터 직선이 아니라 실제 도로 경로 기반 거리.
    반환: (chain[far→anchor], walked_m). 도로 끝/분기 막힘이면 거기까지만(walked<road_m)."""
    cmap = world.get_map()
    wp = cmap.get_waypoint(carla.Location(x=anchor_xy[0], y=anchor_xy[1], z=0.2),
                           project_to_road=True, lane_type=carla.LaneType.Driving)
    if wp is None:
        return [], 0.0
    cx, cy = ROUNDABOUT_CENTER
    def _dist_c(w):
        l = w.transform.location
        return math.hypot(l.x - cx, l.y - cy)
    chain = [wp]
    cur = wp
    walked = 0.0
    while walked < road_m:
        prevs = cur.previous(step)
        if not prevs:
            break
        cur_d = _dist_c(cur)
        # 회전교차로에서 멀어지는(중심거리 증가) 분기 우선 — 링 쪽으로 되돌아가는 것 방지
        away = [w for w in prevs if _dist_c(w) >= cur_d - 0.5]
        nxt = max(away, key=_dist_c) if away else prevs[0]
        chain.append(nxt)
        cur = nxt
        walked += step
    chain.reverse()   # far → anchor
    return chain, walked


# ── 장거리 정상주행 접근 경로 (리그 #: 이벤트 t≈240s) ──
# GRP 로 도심 투어 경로를 만들어 ego 가 ~4분 정상주행 후 회전교차로에 도착하게 함.
#   리스트 = [스폰 → 경유점들 → 진입점]. 마지막 점이 진입점(EGO_ENTRY_POINT).
#   ⏱ 이벤트 시각 튜닝: 경유점을 추가/제거해 경로 길이를 조절(실측 후). 규정속도+신호대기 포함.
#   NE→SE→ENTRY ≈ 1.47km (≈220~260s).  None 으로 두면 짧은 pre_spawn 접근 사용.
#   ⚠️ 1.5km 장거리 set_path 는 신호+트래픽으로 ego가 중간에 막혀 회전교차로 도달 실패 → 비활성.
# v24: 텔레포트 폐기(피험자 당황) → '안내 주행'(사용자 제안): ego 를 이벤트 좌표까지 GRP 경로로
#   몰고 가서 도달 시 이벤트 시작. 검증된 북쪽 경로(B, 벽 없음·ego 주행 확인, ~1055m, 로터리 비관통,
#   종단 road30 으로 (3,28) 진입). 트래픽 35 로 정체 없이 진행. NPC 는 ego 도달(WAITING) 시 스폰.
#   ⚠️ 같은-corridor 느낌이면 추후 출발점/경유점으로 변화 추가(벽 없는 도로로 검증 후).
# v23g/복원: 짧은 접근(이벤트 t≈5s) — None 이면 ego 가 진입점 직전(pre_spawn 17스텝 ~85m)에 스폰해
#   곧장 진입하고, NPC 도 시작 즉시 spawn_now() 로 로터리에 참(아래 main 의 분기). "원래 스폰 위치"·t≈5s 동작.
#   긴 '안내 주행'으로 되돌릴 땐 아래 리스트 주석을 해제(None 줄을 주석 처리).
# v(2026-06-15 사용자 결정): '멀리서 스폰' — pre_spawn walk-back 은 (3,28) 입구 목에서 상류 도로를
#   못 잡아 계속 회전교차로 코앞에 스폰돼서 폐기. 대신 approach_route 사용: ego 가 경로 '첫 점'에
#   스폰하므로 멀리서 스폰이 보장됨. 첫 점 = 검증된 북쪽 피더 (1.9,113)(중심에서 ~113m), 끝 점 =
#   진입점 (3,28). 사이는 GRP 도로 경로로 TM 이 직접 주행(텔레포트 없음).
# v(복원 2026-06-15, 사용자 "이때 코드로"): scenarios1식 pre_spawn 접근 상태로 복귀 —
#   approach_route(GRP) 끔(None) → ego 가 진입점(3,28)에서 previous()[0] 로 pre_spawn_steps(=44,
#   ≈220m) 거슬러 올라간 곳(좌상단)에 스폰해 그 긴 set_path 추종. 접근 단계 auto_lane_change=False·
#   신호/표지 무시(ego_controller._setup_tm). = '긴 경로로 가다 좌상단서 도는' 그 버전.
APPROACH_ROUTE_PTS = None
APPROACH_UPSTREAM_M = 0.0
# (구) 우회 좌표경로 보존(비활성):
# APPROACH_ROUTE_PTS = [(-9.0, 55.0), (-9.0, 150.0), (2.0, 150.0), (1.9, 113.0), (3.0, 28.0)]

# ── 장시간 정상주행 = 자유주행(free-roam) 후 회전교차로 진입 (이벤트 t≈240s) ──
#   ego 가 autopilot 자유주행(신호 준수·트래픽 섞임)으로 ~FREE_ROAM_SECS 초 도심을 돌다가,
#   회전교차로 중심 반경 FREE_ROAM_TRIGGER_RADIUS m 안에 들면 진입 경로 계산 → APPROACHING→WAITING.
#   set_path 추종이 아니라 자유주행이라 '경로에 막혀 멈춤'이 없음(안정적). 시각은 ±수십초 변동.
#   ⏱ 이벤트 시각 ≈ FREE_ROAM_SECS + 진입(~30~50s). 240 에 맞추려면 이 값을 실측 후 조정.
# v(2026-06-15 후속, 사용자 결정): '텔레포트 말고 직접 운전해서 진입'. → 자유주행/텔레포트(옵션 A)
#   비활성(FREE_ROAM_SECS=None). ego 가 FREE_ROAM 이 아니라 APPROACHING 으로 시작해 진입점 상류
#   ~85m(pre_spawn 17스텝, road30 직선·한 junction)에 스폰 → **직접 주행**으로 회전교차로 진입
#   (APPROACHING→WAITING). 이게 Town03+TM 에서 유일하게 '완주 검증'된 drive-in(북쪽 EGO_ENTRY_POINT 고정).
#   ⚠️ 장거리 직접주행(자유주행·GRP 안내경로·좌표경로 ~수백m~1km)은 실측상 ego 가 로터리에 도달 못 함
#   (재시도 금지). 더 긴 정상주행을 원하면 맵 변경 검토. (구) 자유주행+텔레포트 코드는 아래에 보존 —
#   환경변수 FRUST_FREE_ROAM_SECS 에 값(초)을 주면 그 방식으로 되돌아감.
_frs_env = os.environ.get('FRUST_FREE_ROAM_SECS')
FREE_ROAM_SECS           = float(_frs_env) if _frs_env else None  # None=직접 주행 진입(텔레포트 없음). 값 지정 시 (구)자유주행+텔레포트.
FREE_ROAM_TELEPORT       = True           # (FREE_ROAM_SECS 가 값일 때만 의미) True=페이드+텔레포트(옵션A). 직접주행 모드(None)에선 무시.
FADE_OUT_DUR             = 0.8            # 암전까지 [s]
FADE_IN_DUR              = 1.2            # 복귀까지 [s]
FREE_ROAM_SPAWN          = (1.9, 113.0)   # 북쪽 진입 corridor(road30) 위 — 자유주행 시작 스폰점
FREE_ROAM_TRIGGER_RADIUS = 80.0           # v23b: 근접 트리거 복원 — 진입점 80m 안을 지날 때만 route-in
                                          #   커밋(짧은 경로). 로터리가 허브라 ego 가 자주 근처를 지남.
FREE_ROAM_ROUTE_IN_MAX   = 150.0          # v23b: route-in 이 150m 이하일 때만 커밋(짧고 확실). 652m 멀리감 방지
ROUNDABOUT_SPAWN_TIME    = 240.0          # v23b: 폴백 — 이 시각까지 진입 안 했으면 그때라도 스폰(평소엔 진입 시 스폰)

BLOCKER_LOCATIONS = [
    (12.0, 20.0),
    (18.0, 14.0),
]
BLOCKER_SPAWN_TIME = 120.0   # 불법주차 차량을 시나리오 시작 후 이 시각(초)에 스폰 (리그 #4)

# v22e: 2차로 회전교차로 — NPC 는 TM autopilot 으로 실제 순환(바퀴 굴러감·미끄러짐 없음·
#   TM 충돌회피). 안쪽(ego 순환): 드물게. 바깥(진출 차로): 조밀(ego 가 못 빠져나가 도는 답답함).
ROUNDABOUT_CONFIG = {
    'inner_radius':   19.5,  # 안쪽 차로(lane -4) 중심 반경 (probe 실측 ~19.4-20.4)
    'outer_radius':   23.0,  # 바깥 차로(lane -5) 중심 반경 (probe 실측 ~22.9-23.9)
    'n_inner':        4,     # v32: 3→4 (이벤트 트래픽↑). 안쪽=ego 순환 차로 — 너무 많으면 ego 가 막혀
                             #   못 도니 적당히만 증가.
    'n_outer':        10,    # v32: 8→10 (트래픽↑·진출 차로 조밀). 12는 과밀로 ego 진입 불가·충돌 → 10으로.
    'ring_speed_kmh': 17.5,  # NPC 순환 속도 = ego ring_speed 와 동일(상대속도≈0 → 추돌 방지)
    'clockwise':      True,
    'num_laps':       12,    # set_path loop 바퀴 수(시나리오 동안 계속 돌도록 충분히)
}

EGO_CONFIG = {
    'vehicle_type':        'vehicle.tesla.model3',
    'gap_check_angle_deg': 40.0,
    'inner_radius':        19.5,  # ego 는 안쪽 차로로 진입·순환
    'outer_radius':        23.0,  # 진출 시 바깥 차로로 머지
    'exit_attempt_target': 3,     # 진출각 3회차에 진출(1·2회차는 바깥 막힘 → 블록=답답함)
    'exit_gap_angle_deg':  28.0,  # 진출 허용: 바깥 차로 NPC 가 진출각 ±28° 밖일 때
    'leading_distance':    6.0,   # 2026-06-18(후속): 24→6 정차 간격 가까이(사용자: '정차 거리가 멀다').
                                  #   24 로 키운 건 '나눠 멈춤'(2단 정지) 완화 목적이었으나, 사용자 확인 결과
                                  #   '거리에 따라 나눠 정지하는 정도는 큰 차이가 없다' → 멀게 둘 이유가 사라짐.
                                  #   (위험했던 '돌진→급정지'의 근본원인이던 신호 무시는 ignore_lights=0 으로 이미 해소.)
                                  #   리그에서 +/- 키로 0.5~15m 라이브 튜닝 가능(adjust_leading_distance).
    'target_speed_kmh':    30.0,  # 접근 구간 순항 30km/h. traffic 도 동일 30 (매칭). gap-math 기준
    'ring_speed_kmh':      17.5,  # v22d: 안쪽 NPC 선속도(19.5×0.25×3.6≈17.6)에 맞춤 → ego 가 NPC를 추월/추돌 안 함
    'max_wait_time':       28.0,  # v32: 15→28 (진입 시 더 오래 주저 = 답답함↑). 초과 시 강제(입구 빌 때) 진입
    'num_laps':            4,     # v32: 3→4 (순환 바퀴↑ = 더 못 빠져나감). target_laps = 순환 후 자동 진출 바퀴수
    # 회전교차로 멀미 저감은 속도가 아니라 6DOF 진폭 축소가 담당:
    #   data-server/sender/udp_sender.py 의 TURN_COMFORT_SCALE (yaw rate 기반)

    # ── 접근 단계 (회전교차로 진입 전 사전 주행) ──
    # 진입점에서 N 스텝 거슬러 올라간 지점에 스폰 → 자동주행 → 진입점 도달 시
    # 기존 WAITING (gap-gate) 로직으로 전환.
    # 한 스텝 = pre_spawn_step_meters (기본 5m). 총 거리 ≈ steps × step_meters.
    # 도착 시간은 TM 실효 속도에 비례 (실행마다 ±10~20s 변동).
    # 참고 기준선: 50 스텝 (=250m) → 약 166s, 36 스텝 (=180m) → 약 150s
    'pre_spawn_steps':            44,  # 진입점 상류 waypoint 수(=먼 스폰 거리). 44×5m≈220m.
    #   scenarios1(사용자 제시) 과 동일값 — 진입점 (3,28)에서 도로를 따라 220m 거슬러 올라가
    #   빨간 동그라미(좌상단) 부근에 스폰 → 그 구불구불한 긴 경로(set_path)를 따라 회전교차로로 진입.
    #   더 멀리/가까이는 이 숫자만 조절(예: 60≈300m). walk-back 은 previous()[0](scenarios1 동일).
    #   접근 경로는 _setup_approach_path 에서 중간점 보간으로 촘촘히 깔아 TM 추종.
    'pre_spawn_step_meters':      5.0, # 한 스텝당 거리 (m)
    'approach_target_radius':     8.0, # 진입점에 이만큼 가까우면 WAITING 전환
}

# 빠른 회전교차로(C) 반복 테스트용: FRUST_FAST=1 이면 접근을 짧게(진입점 가까이 스폰) →
#   ~30s 내 로터리 도달. 실제 실험은 이 변수 없이(긴 접근). 코드/거동엔 영향 없음(스폰 거리만).
if os.environ.get('FRUST_FAST'):
    EGO_CONFIG['pre_spawn_steps'] = 8
    print('[Main] FRUST_FAST — 접근 단축(pre_spawn_steps=8) → 로터리 빠른 도달(C 테스트용)')

CAMERA_CONFIG = {
    'fov':    90,
    'x':      1.5,
    'z':      1.5,
    'pitch': -10.0,
}


# ================================================================
# StaticBlocker
# ================================================================
class StaticBlocker:
    def __init__(self, world, locations):
        self.world = world
        self.vehicles = []
        self._spawn(locations)

    def _spawn(self, locations):
        bp_lib = self.world.get_blueprint_library()
        bp = bp_lib.find('vehicle.tesla.model3')
        if bp.has_attribute('color'):
            bp.set_attribute('color', '255,0,0')
        for x, y in locations:
            wp = self.world.get_map().get_waypoint(
                carla.Location(x=x, y=y, z=0),
                project_to_road=True,
                lane_type=carla.LaneType.Driving)
            if wp is None:
                continue

            road_tf = wp.transform   # 노면 transform (z = 도로 표면)

            # 1) spawn 시에는 try_spawn_actor 가 ground 와 충돌 안 나도록 0.5m 위에서
            spawn_tf = carla.Transform(
                carla.Location(x=road_tf.location.x,
                               y=road_tf.location.y,
                               z=road_tf.location.z + 0.5),
                road_tf.rotation,
            )
            v = self.world.try_spawn_actor(bp, spawn_tf)
            if not v:
                continue

            # 2) spawn 직후 정확한 노면 z 로 텔레포트 (살짝 +0.05 만 — 노면 z-fight 방지)
            v.set_transform(carla.Transform(
                carla.Location(x=road_tf.location.x,
                               y=road_tf.location.y,
                               z=road_tf.location.z + 0.05),
                road_tf.rotation,
            ))
            # 3) 이제 physics 꺼서 고정
            v.set_simulate_physics(False)
            self.vehicles.append(v)

    def update(self, elapsed):
        pass

    def cleanup(self):
        for v in self.vehicles:
            if v.is_alive:
                v.destroy()


# ================================================================
# 메인
# ================================================================
def main():
    # 0. 재현성 시드(분석계획 §5). 모든 난수 사용보다 먼저 고정한다.
    #   - 전역 random: roundabout_npc(blueprint/color choice)·ENTRANCE 선택·guided shuffle 가 소비.
    #   - TM 시드는 tm 핸들 획득 직후(아래) set_random_device_seed 로 별도 고정.
    random.seed(SEED)
    print(f'[Main] 재현성 시드 고정: SEED={SEED} (random + TrafficManager)')

    # 1. CARLA 셋업
    print('[Main] CARLA 서버 연결 중...')
    client = connect()
    world = load_or_get_world(client, TOWN)

    disable_sync_mode(world)
    cleanup_actors(world)
    enable_sync_mode(world, SIM_DELTA)
    apply_lightweight_settings(world)

    tm = client.get_trafficmanager(8000)
    tm.set_synchronous_mode(True)
    tm.set_random_device_seed(SEED)   # 재현성: TM 차선변경/갭선택 등 내부 난수 고정(분석계획 §5)

    # ── GRP 경로계획기 + 자유주행→진입 라우터 ──
    grp = None
    if GRP_AVAILABLE:
        try:
            grp = GlobalRoutePlanner(world.get_map(), 2.0)
        except Exception as e:
            print(f'[Main] GRP 생성 실패: {e}'); grp = None

    # v32: 입구 세션별 랜덤 + 짧은 pre_spawn 접근(신뢰성). 랜덤 입구를 spawn_location 으로 주면
    #   ego_controller 가 그 입구 상류 ~85m 로 pre_spawn 해 곧장 진입(approach_route=None).
    ego_entry_point = EGO_ENTRY_POINT
    approach_route = None
    if RANDOM_ENTRANCE:
        ego_entry_point = random.choice(ENTRANCE_POINTS)
        print(f'[Main] 세션 입구 랜덤 선택: {ego_entry_point}')
    if grp and USE_GUIDED_APPROACH:   # ⚠️ 장거리 추종 불안정(비권장) — 켜면 GRP 안내경로 사용
        approach_route = _build_guided_approach(grp, world, ego_entry_point)
        if approach_route is None:
            print('[Main] 안내경로 생성 실패 → 짧은 pre_spawn 접근 폴백')
    elif grp and APPROACH_ROUTE_PTS and len(APPROACH_ROUTE_PTS) >= 2:
        # 먼 스폰 → 진입점 도로 경로. 첫 점이 스폰(=멀리 떨어진 곳).
        try:
            pts = [carla.Location(x=x, y=y, z=0.2) for (x, y) in APPROACH_ROUTE_PTS]
            locs = []
            # ① 도로 경로 기반 연장: 첫 점(앵커)에서 도로를 따라 북쪽으로 더 거슬러 올라가 스폰 멀리.
            if APPROACH_UPSTREAM_M > 0:
                chain, walked = _walk_upstream_road(world, APPROACH_ROUTE_PTS[0],
                                                    APPROACH_UPSTREAM_M)
                locs.extend(wp.transform.location for wp in chain)   # far → anchor
                if chain:
                    fl = chain[0].transform.location
                    print(f'[Main] 먼 스폰 도로 연장: 앵커 {APPROACH_ROUTE_PTS[0]} 에서 북쪽 도로로 '
                          f'{walked:.0f}m 추가 → 스폰 ({fl.x:.1f},{fl.y:.1f}), {len(chain)}점')
                if walked < APPROACH_UPSTREAM_M - 1.0:
                    print(f'[Main] ⚠️ 요청 {APPROACH_UPSTREAM_M:.0f}m 중 {walked:.0f}m 만 연장됨 '
                          f'(도로 끝/분기) — 더 멀리 가려면 다른 corridor 필요')
            # ② 앵커 → 진입점 (잘 되는 GRP 도로 구간, 촘촘히 k%2)
            for i in range(len(pts) - 1):
                for j, (wp, _o) in enumerate(grp.trace_route(pts[i], pts[i + 1])):
                    if j % 2 == 0:
                        locs.append(wp.transform.location)
            locs.append(pts[-1]); approach_route = locs
            print(f'[Main] 먼 스폰 접근경로 생성: 총 {len(locs)}개 waypoint '
                  f'(스폰 → 진입점, 촘촘히)')
        except Exception as e:
            print(f'[Main] 접근경로 생성 실패: {e}'); approach_route = None

    # 폴백 라우터 '현재위치→진입점'(짧은 진입 경로). 안내경로 모드에선 거의 안 쓰임(접근이 직접 도달).
    route_planner_fn = None
    if grp:
        _entry_loc = carla.Location(x=ego_entry_point[0], y=ego_entry_point[1], z=0.2)
        def route_planner_fn(from_loc, _grp=grp, _entry=_entry_loc):
            try:
                seg = _grp.trace_route(from_loc, _entry)
                # v32: k%3→k%2 (경로 조밀화 → TM set_path 추종 안정, 유도가 링까지 잘 도달)
                locs = [wp.transform.location for k, (wp, _o) in enumerate(seg) if k % 2 == 0]
                locs.append(_entry)
                return locs
            except Exception as e:
                print(f'[Ego] 진입 경로 계산 실패: {e}')
                return None

    # 2. 모듈 초기화
    spectator = TopDownSpectator(world, ROUNDABOUT_CENTER,
                                 height=SPECTATOR_HEIGHT)

    roundabout = RoundaboutNPC(world, tm, ROUNDABOUT_CENTER, **ROUNDABOUT_CONFIG)
    # v23g/32: 짧은 pre_spawn 접근(approach_route 없음)에선 NPC 를 시작 시 스폰(곧 진입).
    #   안내경로(approach_route 있음)·자유주행에선 지연 스폰(WAITING 도달 시 _setup_loop_path → spawn_now).
    if approach_route is None and FREE_ROAM_SECS is None:
        roundabout.spawn_now()
    blocker    = None   # 불법주차 차량 — 시작 즉시 X, BLOCKER_SPAWN_TIME 후 지연 스폰 (리그 #4)
    ego        = EgoController(
        world, tm,
        spawn_location=ego_entry_point,   # v32: 세션별 랜덤 입구(USE_GUIDED_RANDOM_ENTRANCE)
        exit_location=EGO_EXIT_POINT,
        roundabout_center=ROUNDABOUT_CENTER,
        roundabout_npc=roundabout,
        approach_route=approach_route,
        free_roam_secs=FREE_ROAM_SECS,   # v24: 텔레포트 방식이라 GRP route_planner 불필요
        free_roam_spawn=FREE_ROAM_SPAWN,
        free_roam_trigger_radius=FREE_ROAM_TRIGGER_RADIUS,
        free_roam_route_in_max=FREE_ROAM_ROUTE_IN_MAX,
        free_roam_teleport=FREE_ROAM_TELEPORT,   # 옵션 A: 시간 도달 시 페이드+텔레포트
        fade_out_dur=FADE_OUT_DUR,
        fade_in_dur=FADE_IN_DUR,
        route_planner_fn=route_planner_fn,
        **EGO_CONFIG
    )

    # 카메라 + 컨트롤 통합 창 (ego 스폰 후에 생성)
    camera = EgoCamera(world, ego.vehicle, **CAMERA_CONFIG)

    # ── 평소 주변 트래픽 (이벤트 전 정상주행 현실성, #5) ──
    #   #1·#3: ego·traffic 을 동일 속도(30km/h)로 맞춰 모션 꿀렁·급가감속 완화 + 속도 매칭.
    #   v21: 회전교차로 중심 반경 ROUNDABOUT_EXCLUDE_RADIUS 안에는 ambient 안 띄움(링/진입구 비움).
    npcs = spawn_ambient_traffic(world, tm, n=TRAFFIC_N, ego=ego.vehicle,
                                 seed=SEED,                # 재현성: ambient 스폰포인트/blueprint 결정론화
                                 desired_speed_kmh=30.0,   # ego(30)와 매칭
                                 roundabout_center=ROUNDABOUT_CENTER,
                                 roundabout_radius=ROUNDABOUT_EXCLUDE_RADIUS)

    # ── 3면 viewer 자동 실행 ──
    launch_viewer_bat()

    # ── HMI 오버레이 자동 실행 — viewer 중앙 상단 640x480 (DiL 직접 표시, SKIP_HMI=1 로 끔) ──
    launch_hmi()

    # ── 6DOF UDP 송신 + HDMap 웹 뷰어 WebSocket(인프로세스) 시작 ──
    # collector가 매 tick ego 데이터를 6DOF UDP 와 ws://127.0.0.1:8765 양쪽으로 분배.
    # → HDMap 뷰어용 별도 텔레메트리 서버를 따로 켤 필요 없음. index.html 만 열면 됨.
    if UDP_AVAILABLE:
        run_collector(world, ego.vehicle, background=True)
        if FRUST_AVAILABLE:
            set_motion_dt(SIM_DELTA)                 # 답답함 이벤트 신호 시간축 동기
        print('[Main] 6DOF UDP(127.0.0.1:10000) + 웹 뷰어 WS(127.0.0.1:8765) 송신 시작')

    # ── HDMap 웹뷰어 + 실험상황 모니터 자동 오픈 (C2 와 동일) ──
    launch_map(town=TOWN)
    launch_monitor()

    # ── 라이브 맵 게이팅: 시나리오 시작 신호 (scenario_runtime/started) ──
    # HCI 인터페이스(App.jsx)는 이 신호를 받을 때만 /map_live.html iframe 을 마운트한다.
    # WS 서버는 위 run_collector(UDP_AVAILABLE)에서 이미 떠 있어야 함(=:8766).
    if FRUST_AVAILABLE:
        publish_event('scenario_runtime', {
            'scenario': 'frustration',
            'scenario_id': 'frustration_roundabout_loop',
            'map': 'Town03',
            'status': 'started',
        })
        print('[Main] scenario_runtime started 발행 (frustration/Town03)')

    print('[Main] 시작 — pygame 창 클릭해 포커스')
    print('  ↑/↓: gap_angle  +/-: leading_distance  SPACE: 강제진입  R: 리셋  ESC: 종료')

    # 3. 메인 루프
    start = time.time()
    # ── 실시간 페이싱 (sim 배속 방지) ──
    #   동기 모드라 world.tick() 은 서버가 계산하는 즉시 반환(틱 ~38ms < SIM_DELTA 50ms)
    #   → sim 이 실시간보다 ~1.3× 빠르게 흘러 6DOF 프레임당 모션 스텝이 커지고 '울컥/꿀렁'.
    #   매 루프를 SIM_DELTA(=50ms) wall-clock 으로 맞춰 실시간 1.0× 로 돌린다(모션 스텝 균일).
    _pace_next = time.perf_counter()
    quit_requested = False
    frust_on = False                # 답답함 이벤트(WAITING 중) 활성 상태
    _last_relief = -999.0           # 블로커 정체 해소 호출 간격 타이머
    _ego_left_start = False         # v23b: ego 가 출발점을 떠났는지(지연 스폰 트리거용)

    try:
        while time.time() - start < SCENARIO_DURATION and not quit_requested:
            elapsed = time.time() - start

            # 키보드 입력 (카메라 창에서 받음)
            events = camera.poll()

            if events['quit']:
                quit_requested = True
                continue
            if events['gap_decrease']:
                d = ego.adjust_gap_angle(-5.0)
                print(f'[Input] gap_angle = {d:.0f}°')
            if events['gap_increase']:
                d = ego.adjust_gap_angle(+5.0)
                print(f'[Input] gap_angle = {d:.0f}°')
            if events.get('lead_decrease'):
                d = ego.adjust_leading_distance(-0.5)
                print(f'[Input] leading_distance = {d:.1f}m')
            if events.get('lead_increase'):
                d = ego.adjust_leading_distance(+0.5)
                print(f'[Input] leading_distance = {d:.1f}m')
            if events['force_enter']:
                if ego.state == 'FREE_ROAM':
                    ego.trigger_event_now()          # v24: 정상주행 중 SPACE = 이벤트 조기 시작(텔레포트)
                    print('[Input] SPACE — 정상주행 종료, 이벤트 시작(텔레포트)')
                else:
                    ego.trigger_force_enter(1.5)
                    print('[Input] SPACE 강제 진입')
            if events['reset']:
                ego.reset_gap_angle()
                print('[Input] R 리셋')
            if events.get('exit_trigger'):
                ego.trigger_exit()
                print('[Input] E 출구로 빠지기')

            # (리그 결정) 불법주차/서행 블로커 폐기 — CARLA TM 이 정지·서행차를 추월 못 해
            #   영구 gridlock(접근 봉쇄) + 링 진입 시 3바퀴 방해. 답답함은 회전교차로 gap-gate
            #   (순환 차량 사이 빈틈 대기)+ambient 트래픽이 담당. blocker 는 항상 None.

            # v23b: 회전교차로 NPC 지연 스폰 — ego 가 출발점을 떠나(>120m) 정상주행하다가
            #   진입점 근처(<90m)로 '돌아올' 때 출현(=경로 종단 진입 직전). 그 전엔 빈 로터리 통과.
            #   폴백: ROUNDABOUT_SPAWN_TIME 까지 안 돌아오면 그때라도 스폰.
            # v24: NPC 스폰은 이벤트 시작 시 ego._start_event_at_entry(텔레포트)가 처리(그 전엔 빈 로터리).
            #   여기선 안전 폴백만 — 어떤 이유로든 그 시각까지 안 스폰됐으면 그때라도 스폰.
            if not roundabout.spawned and elapsed >= ROUNDABOUT_SPAWN_TIME:
                print(f'[Main] t={elapsed:.0f}s — 회전교차로 NPC 폴백 스폰')
                roundabout.spawn_now()

            # 시뮬레이션 업데이트
            roundabout.update(elapsed)
            ego.update(elapsed)

            world.tick()
            spectator.update()

            # ── 답답함 이벤트: 회전교차로 순환(이벤트 시작 ~ DONE 전) 동안 6DOF lurch 지속 ──
            #   v31: 트리거 기준을 'WAITING' → 'event_started'(링 순환 이벤트 시작)로 변경.
            #   자유주행-진입(어느 입구든) 흐름은 WAITING 을 거치지 않고 바로 순환에 들어가므로
            #   순환하는 동안 답답함 모션이 지속되도록 함. (짧은 pre_spawn 폴백도 동일하게 커버.)
            state = ego.get_state()
            if FRUST_AVAILABLE and state is not None:
                started = state.get('event_started', False)
                done = state.get('state') == 'DONE'
                if started and not done and not frust_on:
                    trigger_event()
                    # 2026-06-22: junction_deadlock_start 발행은 정본 순서대로
                    #   ego_controller._update_ring 의 to_inner 직후로 이동(중복 방지).
                    print(f'[Frust] t={elapsed:.0f}s  링 순환 이벤트 시작 → 답답함 lurch ON')
                    frust_on = True
                elif (done or not started) and frust_on:
                    stop_event()
                    _v = ego.vehicle.get_velocity()
                    _cur_kmh = 3.6 * math.sqrt(_v.x**2 + _v.y**2 + _v.z**2)
                    publish_event('scenario_event', {
                        'scenario': 'roundabout', 'event': 'cleared',
                        't_sim': round(elapsed, 2),
                        'payload': {'current_kmh': round(_cur_kmh, 1)}})
                    print(f'[Frust] t={elapsed:.0f}s  이벤트 종료 → lurch OFF')
                    frust_on = False

            # 카메라 + 패널 렌더링
            camera.render(
                elapsed=elapsed,
                scenario_duration=SCENARIO_DURATION,
                ego_state=state,
                gap_deg=ego.get_current_gap_deg(),
                fade_alpha=getattr(ego, 'fade_alpha', 0)
            )

            # ── 실시간 페이싱: 이번 틱이 SIM_DELTA(50ms) wall-clock 을 채우도록 대기 ──
            #   서버가 빨라 일찍 끝나면 남는 시간만큼 sleep → sim 1.0× 실시간.
            #   틱이 50ms 를 넘기면(드물게) sleep 없이 기준시계만 리셋(지연 누적 방지).
            _pace_next += SIM_DELTA
            _pace_sleep = _pace_next - time.perf_counter()
            if _pace_sleep > 0:
                time.sleep(_pace_sleep)
            else:
                _pace_next = time.perf_counter()

    except KeyboardInterrupt:
        print('\n[Main] 사용자 중단')

    finally:
        # ── 라이브 맵 게이팅: 시나리오 종료 신호 (scenario_runtime/stopped) ──
        # WS 서버(collector)를 내리기 '전에' 먼저 발행해야 인터페이스가 신호를 받는다.
        if FRUST_AVAILABLE:
            publish_event('scenario_runtime', {
                'scenario': 'frustration',
                'scenario_id': 'frustration_roundabout_loop',
                'map': 'Town03',
                'status': 'stopped',
            })
            print('[Main] scenario_runtime stopped 발행')

        # ── 6DOF UDP 송신 종료 ──
        if UDP_AVAILABLE:
            stop_collector()
            print('[Main] 6DOF UDP 송신 종료')

        camera.cleanup()
        ego.cleanup()
        if blocker:
            destroy_traffic(blocker)
        roundabout.cleanup()
        destroy_traffic(npcs)
        tm.set_synchronous_mode(False)
        disable_sync_mode(world)
        print('[Main] 종료')


if __name__ == '__main__':
    main()
