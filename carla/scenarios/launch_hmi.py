"""
HMI 오버레이 자동 실행 헬퍼 (DiL 직접 표시).

이미 구현된 HMI(React/Vite, `/hmi` 라우트, WS 8766 구독)를 서라운드 viewer
**위 중앙 상단에 640x480** 크기로 띄운다. 피험자가 6DOF 리그에서 전방 화면을
보면서 바로 HMI 인터페이스를 함께 보도록 하는 용도.

흐름:
    1) HMI dev 서버(vite, :5173)가 안 떠 있으면 `npm run dev` 백그라운드 실행
    2) :5173 이 응답할 때까지 대기
    3) Chrome/Edge `--app` 창을 (서라운드 중앙상단, 640x480)에 띄우고
       Windows 에서 **항상 위(topmost)** 로 고정 → NOFRAME pygame viewer 위에 표시

각 시나리오 main.py 가 `launch_viewer_bat()` 직후 `launch_hmi()` 를 호출하면 됨.
viewer 와 같은 서라운드 디스플레이 좌표(VIEWER_POS_*/VIEWER_RES 또는 자동감지)를
공유해 중앙 상단을 계산한다.

환경변수(노브):
    SKIP_HMI=1            HMI 오버레이 실행 안 함
    HMI_VARIANT=visual|voice  띄울 HMI 선택 (기본 visual=시각 인터페이스,
                              voice=음성 HMI). HMI_DIR 이 있으면 그게 우선.
    HMI_DIR=<경로>        HMI 프로젝트 루트(미설정 시 변형별 후보 경로 자동 탐색)
    HMI_URL=<url>         기본 http://localhost:5173/hmi
    HMI_W / HMI_H         창 크기 (기본 640 / 480)
    HMI_MARGIN_TOP        상단 여백 px (기본 0)
    HMI_NO_SERVER=1       npm dev 자동 실행 생략(이미 띄운 경우)
    HMI_BROWSER=<경로>    크롬/엣지 실행파일 직접 지정
"""
import os
import sys
import time
import shutil
import socket
import tempfile
import threading
import subprocess

# viewer 와 동일한 서라운드 원점 감지 로직 재사용 (창 위치 정합)
try:
    from launch_viewer import _detect_surround_origin, _SURROUND_DEFAULT
except Exception:                                    # 단독 실행/임포트 실패 fallback
    _SURROUND_DEFAULT = {'res': '5760x1080', 'pos_x': '1920', 'pos_y': '0'}

    def _detect_surround_origin(_want_w):
        return None


# ── HMI 변형(modality) → 프로젝트 폴더명 ──────────────────────────
#   visual = A안 시각 HMI(HCI-prototype-interface, 13장 카드)
#   voice  = B안 음성 HMI(HCI-prototype, STT/TTS)
# 둘 다 같은 WS 8766 scenario_event 계약·`/hmi` 라우트를 쓴다(브리지 2파일 공유).
_HMI_VARIANTS = {
    'visual': 'HCI-prototype-interface',
    'voice':  'HCI-prototype',
}


# ── HMI 프로젝트 경로 후보 ────────────────────────────────────────
def _find_hmi_dir():
    """띄울 HMI 프로젝트 폴더를 찾는다.

    선택 우선순위:
      1) HMI_DIR=<경로>      명시 지정(최우선, 변형 무시)
      2) HMI_VARIANT=visual|voice  (기본 visual = 시각 인터페이스)
    각 변형을 클론 내부(`06_stimuli/...`)와 연구 리포(형제 디렉터리) 양쪽에서 탐색.
    """
    env = os.environ.get('HMI_DIR')
    if env:
        return env if os.path.isdir(env) else None

    variant = os.environ.get('HMI_VARIANT', 'visual').strip().lower()
    folder = _HMI_VARIANTS.get(variant)
    if not folder:
        print(f'[HMI] 알 수 없는 HMI_VARIANT="{variant}" → "visual" 로 fallback '
              f'(가능: {"/".join(_HMI_VARIANTS)})')
        folder = _HMI_VARIANTS['visual']

    here = os.path.dirname(os.path.abspath(__file__))           # .../scenarios
    root = os.path.dirname(here)                                # CARLA-project-2026-main
    cands = [
        os.path.join(root, '06_stimuli', folder),              # 클론 내부에 둔 경우
        # 연구 리포(형제 디렉터리): .../휴자인-PM/HAVinteractiondesign-research/06_stimuli/<folder>
        os.path.abspath(os.path.join(root, '..', '..',
                                     'HAVinteractiondesign-research', '06_stimuli', folder)),
    ]
    for c in cands:
        if os.path.isdir(c) and os.path.exists(os.path.join(c, 'package.json')):
            print(f'[HMI] 변형="{variant}" → {c}')
            return c
    print(f'[HMI] 변형="{variant}"({folder}) 프로젝트 못 찾음 (탐색: {cands})')
    return None


def _port_open(host, port, timeout=0.4):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _start_dev_server(hmi_dir, port):
    """vite dev 서버(:port)가 안 떠 있으면 `npm run dev` 백그라운드 실행."""
    if _port_open('127.0.0.1', port):
        print(f'[HMI] dev 서버 이미 떠 있음 (:{port}) → 재사용')
        return None
    if os.environ.get('HMI_NO_SERVER'):
        print(f'[HMI] HMI_NO_SERVER → dev 서버 자동 실행 생략 (:{port} 응답 없음, 수동 기동 필요)')
        return None
    npm = shutil.which('npm') or shutil.which('npm.cmd')
    if not npm:
        print('[HMI] npm 못 찾음 → dev 서버 자동 실행 불가. 별도 터미널에서 `npm run dev` 후 재시도.')
        return None
    flags = subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
    try:
        proc = subprocess.Popen([npm, 'run', 'dev'], cwd=hmi_dir, creationflags=flags)
        print(f'[HMI] dev 서버 기동 — `npm run dev` (cwd={hmi_dir}, pid={proc.pid})')
    except Exception as e:
        print(f'[HMI] dev 서버 실행 실패: {e}')
        return None
    # 부팅 대기 (vite 콜드스타트 ~수초)
    for _ in range(60):                                  # 최대 ~30s
        if _port_open('127.0.0.1', port):
            print(f'[HMI] dev 서버 응답 확인 (:{port})')
            return proc
        time.sleep(0.5)
    print(f'[HMI] ⚠️ dev 서버 대기 시간초과(:{port}) — 그래도 창은 띄움(로딩될 수 있음)')
    return proc


def _find_browser():
    if os.environ.get('HMI_BROWSER'):
        return os.environ['HMI_BROWSER']
    pf   = os.environ.get('ProgramFiles', r'C:\Program Files')
    pf86 = os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')
    local = os.environ.get('LOCALAPPDATA', '')
    cands = [
        os.path.join(pf,   r'Google\Chrome\Application\chrome.exe'),
        os.path.join(pf86, r'Google\Chrome\Application\chrome.exe'),
        os.path.join(local, r'Google\Chrome\Application\chrome.exe') if local else '',
        os.path.join(pf86, r'Microsoft\Edge\Application\msedge.exe'),
        os.path.join(pf,   r'Microsoft\Edge\Application\msedge.exe'),
    ]
    for c in cands:
        if c and os.path.exists(c):
            return c
    return shutil.which('chrome') or shutil.which('msedge')


def _set_topmost(pid, w, h, x, y, deadline):
    """launched pid(및 자식)가 소유한 최상위 창을 찾아 HWND_TOPMOST 로 고정 (Windows)."""
    if os.name != 'nt':
        return
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        HWND_TOPMOST = -1
        SWP_NOSIZE, SWP_NOMOVE, SWP_SHOWWINDOW = 0x0001, 0x0002, 0x0040
        targets = {pid}
        found = []

        EP = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def _cb(hwnd, _lp):
            if not u.IsWindowVisible(hwnd):
                return True
            wpid = wintypes.DWORD()
            u.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
            if wpid.value in targets:
                length = u.GetWindowTextLengthW(hwnd)
                if length > 0:                            # 제목 있는 실제 앱 창만
                    found.append(hwnd)
            return True

        while time.time() < deadline:
            found.clear()
            u.EnumWindows(EP(_cb), 0)
            if found:
                for hwnd in found:
                    # 정확한 위치/크기로 올리고 topmost 고정.
                    #   포커스(SetForegroundWindow)는 일부러 안 뺏음 → viewer 키보드
                    #   단축키(+/-/SPACE) 유지. topmost 창은 포커스 없이도 위에 표시됨.
                    u.SetWindowPos(hwnd, HWND_TOPMOST, int(x), int(y), int(w), int(h),
                                   SWP_SHOWWINDOW)
                print(f'[HMI] 창 topmost 고정 ({len(found)}개) @ ({x},{y}) {w}x{h}')
                return
            time.sleep(0.3)
        print('[HMI] ⚠️ topmost 대상 창 못 찾음 (브라우저가 기존 인스턴스로 합쳐졌을 수 있음)')
    except Exception as e:
        print(f'[HMI] topmost 설정 건너뜀: {e}')


def _launch_hmi_worker():
    """HMI 오버레이를 서라운드 viewer 중앙 상단에 640x480 으로 띄운다.

    ⚠️ 이 함수는 dev 서버 부팅(`npm run dev` 콜드스타트, 최대 ~30s)과 topmost 창
    매칭 폴링(최대 10s)에서 **블로킹**한다. 절대 메인 스레드(시나리오 main.py)에서
    직접 호출하지 말 것 — 동기(synchronous) CARLA 모드에서 이 블로킹 동안 `world.tick()`
    이 멈춰 viewer.py 가 카메라 프레임을 못 받아 화면이 안 뜬다(2026-06-20 버그).
    반드시 `launch_hmi()`(데몬 스레드 래퍼)를 통해 호출한다.
    """
    hmi_dir = _find_hmi_dir()
    if not hmi_dir:
        print('[HMI] HMI 프로젝트(package.json) 못 찾음 → 오버레이 생략. '
              'HMI_DIR 환경변수로 경로 지정 가능.')
        return None

    url = os.environ.get('HMI_URL', 'http://localhost:5173/hmi')
    try:
        port = int(url.split(':')[2].split('/')[0])
    except Exception:
        port = 5173

    # 1) dev 서버 보장
    server_proc = _start_dev_server(hmi_dir, port)

    # 2) 위치 계산 — viewer 와 같은 서라운드 원점/해상도 사용 (중앙 상단)
    w = int(os.environ.get('HMI_W', 640))
    h = int(os.environ.get('HMI_H', 480))
    margin_top = int(os.environ.get('HMI_MARGIN_TOP', 0))
    res = os.environ.get('VIEWER_RES', _SURROUND_DEFAULT['res'])
    try:
        res_w = int(res.split('x')[0])
    except Exception:
        res_w = 5760
    det = _detect_surround_origin(res_w)
    origin_x = int(os.environ.get('VIEWER_POS_X', str(det[0]) if det else _SURROUND_DEFAULT['pos_x']))
    origin_y = int(os.environ.get('VIEWER_POS_Y', str(det[1]) if det else _SURROUND_DEFAULT['pos_y']))
    x = origin_x + (res_w - w) // 2                      # 가로 중앙
    y = origin_y + margin_top                            # 상단

    # 3) 브라우저 --app 창
    browser = _find_browser()
    if not browser:
        print('[HMI] Chrome/Edge 실행파일 못 찾음 → 오버레이 생략. HMI_BROWSER 로 지정 가능. '
              f'(수동: 브라우저로 {url} 열기)')
        return server_proc
    profile = os.path.join(tempfile.gettempdir(), 'hmi_overlay_profile')
    cmd = [
        browser,
        f'--app={url}',
        f'--window-size={w},{h}',
        f'--window-position={x},{y}',
        f'--user-data-dir={profile}',                    # 새 인스턴스 강제(pid→창 매칭 신뢰성)
        '--no-first-run', '--no-default-browser-check',
        '--disable-features=Translate',
        '--autoplay-policy=no-user-gesture-required',     # 음성/효과음 자동재생
    ]
    flags = subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
    try:
        bproc = subprocess.Popen(cmd, creationflags=flags)
        print(f'[HMI] 오버레이 창 실행 — {os.path.basename(browser)} '
              f'@ ({x},{y}) {w}x{h}  url={url}  pid={bproc.pid}')
    except Exception as e:
        print(f'[HMI] 브라우저 실행 실패: {e}')
        return server_proc

    # 4) NOFRAME viewer 위로 올라오도록 topmost 고정 (창 생성까지 잠깐 폴링)
    _set_topmost(bproc.pid, w, h, x, y, deadline=time.time() + 10.0)

    return [p for p in (server_proc, bproc) if p]


def launch_hmi():
    """HMI 오버레이를 **논블로킹**으로 띄운다 (시나리오 main.py 가 호출).

    실제 작업(`_launch_hmi_worker`)은 dev 서버 부팅 대기·topmost 폴링에서 길게(최대
    ~40s) 블로킹하므로 **데몬 스레드**에서 돌린다 → main.py 는 즉시 다음 단계
    (`run_collector`/메인 `world.tick()` 루프)로 진행한다. 이렇게 해야 동기 CARLA
    모드에서 viewer.py 가 곧바로 카메라 프레임을 받아 화면이 뜬다(2026-06-20 버그 픽스).
    오버레이 창은 몇 초 뒤 백그라운드에서 viewer 위로 올라온다.
    """
    if os.environ.get('SKIP_HMI'):
        print('[HMI] SKIP_HMI 환경변수 감지 → HMI 오버레이 실행 안 함')
        return None
    t = threading.Thread(target=_launch_hmi_worker, name='hmi-overlay', daemon=True)
    t.start()
    print('[HMI] 오버레이 백그라운드 기동 (논블로킹) — viewer/시뮬레이션은 즉시 진행')
    return t


if __name__ == '__main__':
    # 단독 실행 시엔 블로킹 워커를 직접 돌려 로그를 바로 본다(스레드 데몬이 먼저 끝나버리지 않게).
    if os.environ.get('SKIP_HMI'):
        print('[HMI] SKIP_HMI → 실행 안 함')
    else:
        _launch_hmi_worker()
    print('[HMI] 단독 실행 — Ctrl+C 로 종료(창은 유지).')
