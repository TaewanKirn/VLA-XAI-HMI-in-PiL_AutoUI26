"""HDMap 웹 뷰어(index.html) 자동 오픈 헬퍼.

각 시나리오의 main.py 가 collector(= ws 서버) 시작 직후 호출하면
기본 브라우저로 viewer\\index.html 을 연다. URL 파라미터로 맵 선택 +
텔레메트리 자동연결까지 처리하므로 '연결' 버튼을 누를 필요 없이
차량 위치가 맵 위에 바로 표시됨.

collector(run_collector) 가 ws://127.0.0.1:8765 로 매 tick 프레임을 쏘므로
이 함수는 그 이후에 호출해야 autoconnect 가 바로 붙는다.

끄기:
    set SKIP_MAP=1                (cmd)
    $env:SKIP_MAP=1               (PowerShell)

viewer 폴더가 다른 경로면:
    set HDMAP_VIEWER_DIR=D:\\어딘가\\viewer
"""
import os
import webbrowser
from urllib.parse import quote

# 기본 뷰어 = 클론 사본(scenarios/hdmap_viewer) — 기본 자동연결 + 자동 재연결이라
# '연결' 버튼을 누를 필요가 없다. 사본이 없으면 외부 원본으로 폴백.
_HERE = os.path.dirname(os.path.abspath(__file__))               # scenarios/
_CLONE_VIEWER_DIR    = os.path.join(_HERE, 'hdmap_viewer')
_EXTERNAL_VIEWER_DIR = r'C:\CARLA_0.9.15\HDMaps\viewer'


def _default_viewer_dir():
    if os.path.exists(os.path.join(_CLONE_VIEWER_DIR, 'index.html')):
        return _CLONE_VIEWER_DIR
    return _EXTERNAL_VIEWER_DIR


def launch_map(town='Town04', ws_url=None):
    if os.environ.get('SKIP_MAP'):
        print('[Map] SKIP_MAP 환경변수 감지 → 맵 뷰어 열지 않음')
        return False

    # 2026-06-19: WS 포트 8765→8766(B안 음성 충돌 회피). WS_PORT env 로 덮어쓰기.
    if ws_url is None:
        ws_url = f"ws://127.0.0.1:{os.environ.get('WS_PORT', '8766')}"

    viewer_dir = os.environ.get('HDMAP_VIEWER_DIR', _default_viewer_dir())
    index = os.path.join(viewer_dir, 'index.html')

    if not os.path.exists(index):
        print(f'[Map] index.html 못 찾음 → 맵 열기 건너뜀: {index}')
        print('      HDMAP_VIEWER_DIR 환경변수로 viewer 폴더 경로를 지정하세요.')
        return False

    # file:// URL + 쿼리 파라미터 (맵 선택 + 자동연결).
    # 브라우저는 file:// 페이지에서도 location.search / ws://127.0.0.1 연결을 허용함.
    url = (
        'file:///' + index.replace('\\', '/')
        + f'?map={quote(town)}&ws={quote(ws_url)}&autoconnect=1'
    )

    try:
        webbrowser.open(url)
        print(f'[Map] HDMap 뷰어 열기 ({town}, 자동연결 {ws_url})')
        return True
    except Exception as e:
        print(f'[Map] 맵 뷰어 열기 실패 (무시): {e}')
        return False
