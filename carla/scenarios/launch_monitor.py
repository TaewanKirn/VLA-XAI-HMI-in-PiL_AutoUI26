"""실험상황 모니터(ws_monitor.html) 자동 오픈 — 연구자 화면용 (#7).

각 시나리오 main.py 가 collector(= ws 서버) 시작 직후 호출하면 기본 브라우저로
연구 클론의 ws_monitor.html 을 연다. 그 페이지는 ws://127.0.0.1:8765 에 자동 연결되어
CARLA 위치 + 6DOF 6축 + 이벤트 타임라인 + 수신율/지연을 실시간 표시한다.

끄기:    set SKIP_MONITOR=1   (PowerShell: $env:SKIP_MONITOR=1)
경로변경: set WS_MONITOR_PATH=D:\어딘가\ws_monitor.html
"""
import os
import webbrowser

# 이 파일(scenarios/launch_monitor.py) 기준으로 ws_monitor.html 정본을 상대 계산.
#   scenarios → CARLA-project-2026-main → HAVinteractiondesign_AutoUI26 → <루트>
#   <루트>/HAVinteractiondesign-research/04_design/CARLA/ws_monitor.html
# 클론을 다른 경로로 옮겨도 동작하도록 절대경로 하드코딩을 제거함.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_HERE, '..', '..', '..'))
_MONITOR_REL = os.path.join(
    'HAVinteractiondesign-research', '04_design', 'CARLA', 'ws_monitor.html'
)
# 후보 위치(앞에서부터 먼저 존재하는 것을 사용).
_MONITOR_CANDIDATES = [
    os.path.join(_ROOT, _MONITOR_REL),                 # 정상 클론 레이아웃
    os.path.join(_HERE, '..', '04_design', 'CARLA', 'ws_monitor.html'),  # 04_design 동봉 시
]


def _resolve_monitor():
    """존재하는 첫 후보 경로를 반환(없으면 첫 후보를 그대로 반환 → 안내용)."""
    override = os.environ.get('WS_MONITOR_PATH')
    if override:
        return override
    for cand in _MONITOR_CANDIDATES:
        cand = os.path.normpath(cand)
        if os.path.exists(cand):
            return cand
    return os.path.normpath(_MONITOR_CANDIDATES[0])


def launch_monitor():
    if os.environ.get('SKIP_MONITOR'):
        print('[Monitor] SKIP_MONITOR 환경변수 감지 → 실험 모니터 열지 않음')
        return False

    path = _resolve_monitor()
    if not os.path.exists(path):
        print(f'[Monitor] ws_monitor.html 못 찾음 → 건너뜀: {path}')
        print('          WS_MONITOR_PATH 환경변수로 경로를 지정하세요.')
        return False

    # ws_monitor.html 은 자체적으로 ws://127.0.0.1:8765 에 자동 연결한다.
    url = 'file:///' + path.replace('\\', '/')
    try:
        webbrowser.open(url)
        print(f'[Monitor] 실험상황 모니터 열기 ({path})')
        return True
    except Exception as e:
        print(f'[Monitor] 모니터 열기 실패 (무시): {e}')
        return False
