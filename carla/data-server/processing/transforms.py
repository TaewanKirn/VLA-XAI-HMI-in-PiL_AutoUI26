"""
시나리오별 6DOF transforms 자동 디스패처.

SCENARIO 환경변수(A|B)에 따라 transforms_A / transforms_B 를 자동 선택한다.
시나리오 main.py 가 파이프라인 import '전에'
    os.environ['SCENARIO'] = 'A'   # 또는 'B'
를 설정하면, collector → udp_sender → (여기)로 이어지는 import 체인이
해당 시나리오의 프로파일을 적재한다. 미설정 시 'A'(무상태·컴포트 기본).

→ 더 이상 transforms.py 를 손으로 갈아끼울 필요 없음.
  A/B 원본은 transforms_A.py / transforms_B.py 로 공존한다. (수동 swap 폐기)
"""
import os as _os

SCENARIO = (_os.environ.get('SCENARIO', 'A').strip().upper() or 'A')

if SCENARIO == 'B':
    from processing.transforms_B import *          # noqa: F401,F403
    from processing.transforms_B import (          # 명시 재노출 (B 전용 API 포함)
        transform_motion, reset_state, set_dt, is_event_active, trigger_event,
    )
else:
    from processing.transforms_A import *          # noqa: F401,F403
    from processing.transforms_A import transform_motion, reset_state

print(f"[transforms] 프로파일 적재: 시나리오 {SCENARIO}")
