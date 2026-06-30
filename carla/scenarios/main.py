import subprocess
import sys
import os
import time

BASE = os.path.dirname(os.path.abspath(__file__))
RESET_CARLA = os.path.normpath(os.path.join(BASE, '..', 'reset_carla.py'))

SCENARIOS = {
    '1': ('당황   — 회전교차로 진입 차단 (Frustration)',
          os.path.join(BASE, 'frustration', 'main.py')),
    '2': ('불안   — 아쿠아플레이닝 / 빗길 미끄러짐 (Anxiety: Puddle)',
          os.path.join(BASE, 'anxiety', 'Puddle', 'main.py')),
}


def _kill_viewers():
    """남은 3면 뷰어 / 시나리오 프로세스 종료 (런처 자신은 제외).
    reset.bat 과 동일한 필터: viewer.py + (Puddle|frustration|Cutoff)\\main.py.
    scenarios\\main.py(런처)는 필터에 안 걸림."""
    if os.name != 'nt':
        return
    ps = (
        "Get-CimInstance Win32_Process | Where-Object { "
        "($_.Name -eq 'python.exe' -or $_.Name -eq 'pythonw.exe') -and "
        "($_.CommandLine -match 'viewer\\.py|(Puddle|frustration|Cutoff)\\\\main\\.py') } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    try:
        subprocess.run(
            ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
            timeout=15,
        )
    except Exception as e:
        print(f'[정리] 뷰어 종료 중 경고(무시): {e}')


def _reset_world():
    """CARLA world 를 async 로 복구 + 잔여 차량/센서 정리 (reset_carla.py 재사용).
    CARLA 서버 자체는 끄지 않음 — 다음 시나리오가 같은 서버를 재사용."""
    if not os.path.exists(RESET_CARLA):
        print(f'[정리] reset_carla.py 못 찾음 → 건너뜀: {RESET_CARLA}')
        return
    try:
        subprocess.run([sys.executable, RESET_CARLA], timeout=30)
    except Exception as e:
        print(f'[정리] CARLA 복구 중 경고(무시): {e}')


def _cleanup_between():
    print('\n[정리] 잔여 뷰어 종료 + CARLA world 복구 중...')
    _kill_viewers()
    _reset_world()
    time.sleep(1.0)   # 서버가 async 로 안정될 짧은 여유
    print('[정리] 완료 — 다음 시나리오를 바로 선택할 수 있습니다.\n')


def _run_scenario(name, path):
    print(f'\n[실행] {name}')
    print(f'       {path}')
    print('  ▶ 중단하고 다른 시나리오로 넘어가려면 이 창에서 Ctrl+C')
    print()

    # 시나리오를 자식 프로세스로 실행.
    # Ctrl+C 는 콘솔 그룹 전체에 전달되므로 자식이 스스로 정리·종료한다.
    # 런처(부모)는 Ctrl+C 를 무시하고 자식이 완전히 끝날 때까지 기다린 뒤
    # 메뉴로 복귀한다 (런처가 같이 죽지 않도록).
    proc = subprocess.Popen([sys.executable, path], cwd=os.path.dirname(path))
    while True:
        try:
            proc.wait()
            break
        except KeyboardInterrupt:
            print('\n[중단] Ctrl+C 감지 — 시나리오 종료 대기 중...')
            # 자식에게도 이미 전달됨. 끝까지 기다린다.
            continue

    _cleanup_between()


def main():
    while True:
        print()
        print('=' * 52)
        print('   CARLA HMI 실험 시나리오 런처')
        print('=' * 52)
        for key, (name, path) in SCENARIOS.items():
            missing = '' if os.path.exists(path) else '   (파일 없음!)'
            print(f'  [{key}]  {name}{missing}')
        print('  [r] 수동 정리 (잔여 뷰어 종료 + CARLA 복구)')
        print('  [q] 종료')
        print('=' * 52)
        print()

        try:
            choice = input('시나리오 선택: ').strip().lower()
        except (KeyboardInterrupt, EOFError):
            print('\n종료합니다.')
            return

        if choice == 'q':
            print('종료합니다.')
            return

        if choice == 'r':
            _cleanup_between()
            continue

        if choice not in SCENARIOS:
            print(f'잘못된 입력: {choice}')
            continue

        name, path = SCENARIOS[choice]

        if not os.path.exists(path):
            print(f'\n[오류] 파일 없음: {path}')
            print('해당 시나리오 main.py가 올바른 위치에 있는지 확인하세요.')
            continue

        _run_scenario(name, path)


if __name__ == '__main__':
    main()
