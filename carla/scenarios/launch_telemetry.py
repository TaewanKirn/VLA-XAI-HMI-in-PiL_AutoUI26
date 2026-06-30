"""HDMap 웹 뷰어용 텔레메트리 서버 자동 실행 헬퍼.

각 시나리오의 main.py 가 ego 스폰 직후 호출하면
C:\\CARLA_0.9.15\\HDMaps\\viewer\\scripts\\telemetry_server.py 를
별도 콘솔로 띄워 CARLA → WebSocket(ws://127.0.0.1:8765) 브리지를 시작함.

지도 화면은 viewer 폴더의 serve.bat 으로 직접 열어서
좌측 패널의 '연결' 버튼을 누르면 hero ego 위치가 점으로 표시됨.

주의: carla 0.9.15 wheel 은 cp310 전용이라 텔레메트리 서버는 반드시
Python 3.10 으로 실행해야 함 → 'py -3.10' 런처를 사용.

끄고 싶을 때:
    set SKIP_TELEMETRY=1   (PowerShell: $env:SKIP_TELEMETRY=1)

viewer 폴더가 다른 경로면:
    set HDMAP_VIEWER_DIR=D:\\어딘가\\viewer
"""
import os
import subprocess

_DEFAULT_VIEWER_DIR = r'C:\CARLA_0.9.15\HDMaps\viewer'


def launch_telemetry(host='127.0.0.1', port=2000, role='hero', rate=20):
    if os.environ.get('SKIP_TELEMETRY'):
        print('[Telemetry] SKIP_TELEMETRY 환경변수 감지 → 텔레메트리 서버 실행 안 함')
        return None

    viewer_dir = os.environ.get('HDMAP_VIEWER_DIR', _DEFAULT_VIEWER_DIR)
    script = os.path.join(viewer_dir, 'scripts', 'telemetry_server.py')

    if not os.path.exists(script):
        print(f'[Telemetry] telemetry_server.py 못 찾음 → 자동 실행 건너뜀: {script}')
        print('            HDMAP_VIEWER_DIR 환경변수로 viewer 폴더 경로를 지정하세요.')
        return None

    # carla 0.9.15 는 cp310 전용 → py -3.10 으로 고정 실행
    cmd = [
        'py', '-3.10', script,
        '--host', str(host),
        '--port', str(port),
        '--role', str(role),
        '--rate', str(rate),
    ]

    try:
        # CREATE_NEW_CONSOLE: 로그(ws listening / tracking actor)를 볼 수 있게 별도 콘솔
        flags = subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
        proc = subprocess.Popen(cmd, cwd=viewer_dir, creationflags=flags)
        print(f'[Telemetry] 텔레메트리 서버 실행 (role={role}, ws://127.0.0.1:8765)')
        print('[Telemetry] 지도 화면: viewer\\serve.bat 실행 후 브라우저에서 "연결"')
        return proc
    except FileNotFoundError:
        print('[Telemetry] py 런처(py -3.10)를 못 찾음 → 자동 실행 건너뜀.')
        return None
    except Exception as e:
        print(f'[Telemetry] 텔레메트리 서버 실행 실패 (무시): {e}')
        return None
