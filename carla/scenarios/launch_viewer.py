"""
3면 viewer 자동 실행 헬퍼.

각 시나리오의 main.py 가 ego 스폰 직후 호출하면 viewer 를 백그라운드 실행.

viewer.py 는 role_name='hero' ego 를 30초 동안 polling 하며 기다리므로
ego 스폰 전에 호출돼도 OK.

레이아웃 선택 (환경변수 VIEWER_LAYOUT):
    surround    ← 기본. NVIDIA Surround 단일 디스플레이(5760x1080)에
                  좌/중/우 3뷰를 '한 창·한 프로세스'로 렌더 (현재 리그).
                  창 위치/크기 env 로 덮어쓰기:
                      VIEWER_RES   (기본 5760x1080)
                      VIEWER_POS_X (기본 1920)   VIEWER_POS_Y (기본 -1080)
                      VIEWER_VIEWS (기본 left,center,right)
    experiment  ← (구) 4K 모니터 3개 가로 배치 — viewer.py 3개 프로세스
    dev         ← 1920x1080 한 모니터에 작게 타일 (개발용)

끄기:
    set SKIP_VIEWER=1              (cmd)
    $env:SKIP_VIEWER=1              (PowerShell)
"""
import os
import sys
import subprocess


def _detect_surround_origin(want_w):
    """가로폭이 want_w 에 가장 가까운 디스플레이의 좌상단 (left, top) 반환 (Windows).
    서라운드 자동 추종 — 모니터 재배치/이동으로 창이 화면 밖으로 나가는 것 방지.
    감지 실패/비-Windows → None (그러면 프리셋 좌표 사용)."""
    if os.name != 'nt':
        return None
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        u.SetProcessDPIAware()
        mons = []
        PROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HANDLE, wintypes.HANDLE,
                                  ctypes.POINTER(wintypes.RECT), wintypes.LPARAM)

        def _cb(h, hdc, lprc, lp):
            r = lprc.contents
            mons.append((r.left, r.top, r.right - r.left))
            return 1
        u.EnumDisplayMonitors(0, 0, PROC(_cb), 0)
        if not mons:
            return None
        return tuple(min(mons, key=lambda m: abs(m[2] - want_w))[:2])  # 폭 근접 모니터 (left,top)
    except Exception:
        return None


# ── 단일창(서라운드) 프리셋 ───────────────────────────────────────
# NVIDIA Surround 로 합친 5760x1080 디스플레이 1개에 3뷰를 한 창으로.
# 좌표 기본값은 현재 리그 실측: 서라운드 좌상단 (1920, -1080), 크기 5760x1080.
# (감지: Control 1920x1080 @ (0,0)  /  Surround 5760x1080 @ (1920,-1080))
_SURROUND_DEFAULT = {
    'views': 'left,center,right',
    'res':   '5760x1080',
    'pos_x': '1920',
    'pos_y': '0',           # 자동감지 실패 시 fallback (2026-06-06 서라운드 y=0)
    'fov':   '72',          # 패널 화각 = 이음새 각도(±fov/2) 조절. A필러가 이음새에 오도록 (#2)
    'yaw':   '6',           # 전체 리그 yaw[deg] — A필러 좌측 정렬 (#1, 보며 조정)
    'ss':    '1.0',         # 슈퍼샘플링 OFF (v29: Epic+ss 프레임드랍 → 복구). 선명도 원하면 1.25~1.5
    'render':'full',        # 패널 네이티브(1920x1080) 캡처 = 선명(2026-06-18 사용자 확인 '화질 확실히 좋아짐').
                            #   카메라 해상도는 sim 틱(~38ms)에 영향 없음 확인됨. 가볍게 가려면 VIEWER_RENDER_RES=1280x720.
}

# ── (구) 멀티프로세스 레이아웃 프리셋 ─────────────────────────────
# 각 튜플: (view, pos_x, pos_y, res) — viewer.py 를 시점별 1개씩 spawn

# 개발용 — 1920x1080 단일 모니터에 가로로 작게 3개
_LAYOUT_DEV = [
    ('left',     0,   0, '640x480'),
    ('center', 640,   0, '640x480'),
    ('right', 1280,   0, '640x480'),
]

# 실험용 — 4K 모니터 3개 가로 배치
# Control [0..1919]  LEFT [1920..5759]  FRONT [5760..9599]  RIGHT [9600..]
_LAYOUT_EXPERIMENT = [
    ('left',   1920, 0, '3840x2160'),
    ('center', 5760, 0, '3840x2160'),
    ('right',  9600, 0, '3840x2160'),
]

_LAYOUTS = {
    'dev':        _LAYOUT_DEV,
    'experiment': _LAYOUT_EXPERIMENT,
}


def launch_viewer_bat():
    if os.environ.get('SKIP_VIEWER'):
        print('[Viewer] SKIP_VIEWER 환경변수 감지 → viewer 실행 안 함')
        return None

    layout_name = os.environ.get('VIEWER_LAYOUT', 'surround').lower()

    here      = os.path.dirname(os.path.abspath(__file__))
    viewer_py = os.path.join(here, 'frustration', 'viewer.py')

    if not os.path.exists(viewer_py):
        print(f'[Viewer] viewer.py 못 찾음 → 자동 실행 건너뜀: {viewer_py}')
        return None

    # 각 viewer.py 가 자기 콘솔 창을 가지도록
    flags = subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
    workdir = os.path.dirname(viewer_py)

    # ── 단일창(서라운드): viewer.py 1개가 3뷰를 한 창에 렌더 ──────
    if layout_name == 'surround':
        s     = _SURROUND_DEFAULT
        views = os.environ.get('VIEWER_VIEWS', s['views'])
        res   = os.environ.get('VIEWER_RES',   s['res'])
        # 서라운드 위치 자동 감지 (모니터 재배치로 창이 화면 밖으로 나가는 것 방지)
        _det  = _detect_surround_origin(int(res.split('x')[0]))
        pos_x = os.environ.get('VIEWER_POS_X', str(_det[0]) if _det else s['pos_x'])
        pos_y = os.environ.get('VIEWER_POS_Y', str(_det[1]) if _det else s['pos_y'])
        fov   = os.environ.get('VIEWER_FOV',   s['fov'])   # 이음새=A필러 각도 조절 (#2)
        yaw   = os.environ.get('VIEWER_YAW',   s['yaw'])   # A필러 좌우 정렬 (#1)
        ss    = os.environ.get('VIEWER_SS',    s['ss'])    # 슈퍼샘플링 선명도 (#5)
        rres  = os.environ.get('VIEWER_RENDER_RES', s['render'])  # 캡처 해상도(낮추면 medium·가벼움, #6)
        cmd = [sys.executable, viewer_py,
               '--views', views,
               '--res',   res,
               '--pos-x', str(pos_x),
               '--pos-y', str(pos_y),
               '--fov',   str(fov),
               '--yaw',   str(yaw),
               '--ss',    str(ss),
               '--smooth']
        # render-res 지정 시 카메라를 그 해상도로 캡처 후 패널로 업스케일 ('medium' 부하절감, #6).
        #   full/none/off/빈값 → 풀해상도(패널 크기로 캡처).
        if rres and rres.lower() not in ('full', 'none', 'off', ''):
            cmd += ['--render-res', rres]
        print(f'[Viewer] 레이아웃 = "surround" (단일창) '
              f'views={views} res={res} pos=({pos_x},{pos_y}) fov={fov} yaw={yaw} ss={ss} render={rres}')
        try:
            proc = subprocess.Popen(cmd, cwd=workdir, creationflags=flags)
            print(f'[Viewer] 단일창 실행 — pid={proc.pid}')
            return [proc]
        except Exception as e:
            print(f'[Viewer] 단일창 실행 실패: {e}')
            return None

    # ── (구) 멀티프로세스: 시점별 viewer.py 1개씩 ─────────────────
    views = _LAYOUTS.get(layout_name)
    if views is None:
        print(f'[Viewer] 알 수 없는 VIEWER_LAYOUT="{layout_name}" → surround 로 fallback')
        os.environ['VIEWER_LAYOUT'] = 'surround'
        return launch_viewer_bat()

    print(f'[Viewer] 레이아웃 = "{layout_name}" (멀티프로세스)')

    procs = []
    for view, pos_x, pos_y, res in views:
        try:
            proc = subprocess.Popen(
                [sys.executable, viewer_py,
                 '--view',  view,
                 '--pos-x', str(pos_x),
                 '--pos-y', str(pos_y),
                 '--res',   res],
                cwd=workdir,
                creationflags=flags,
            )
            procs.append(proc)
            print(f'[Viewer] {view:6s} 실행 — pos=({pos_x},{pos_y}), res={res}, pid={proc.pid}')
        except Exception as e:
            print(f'[Viewer] {view} 실행 실패 (무시): {e}')

    if not procs:
        print('[Viewer] 어떤 viewer 도 실행 못 함')
    return procs
