"""
시나리오별 6DOF filters 자동 디스패처.

SCENARIO 환경변수(A|B)에 따라 filters_A / filters_B 를 자동 선택한다.
규칙은 transforms 디스패처와 동일 — 시나리오 main.py 가 파이프라인 import 전에
    os.environ['SCENARIO'] = 'A'   # 또는 'B'
를 설정한다. 미설정 시 'A'.

→ 손으로 갈아끼울 필요 없음. A/B 원본은 filters_A.py / filters_B.py 로 공존. (수동 swap 폐기)
"""
import os as _os

SCENARIO = (_os.environ.get('SCENARIO', 'A').strip().upper() or 'A')

if SCENARIO == 'B':
    from processing.filters_B import *             # noqa: F401,F403
    from processing.filters_B import apply, velocity_limiter, reset_filter
else:
    from processing.filters_A import *             # noqa: F401,F403
    from processing.filters_A import apply, velocity_limiter, reset_filter
