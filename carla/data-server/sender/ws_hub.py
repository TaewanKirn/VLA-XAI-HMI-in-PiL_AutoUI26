"""상설 WebSocket 허브 (8766) — 시나리오와 독립적으로 미리 기동.

왜: 기존엔 WS 서버(8766)가 시나리오 main.py 안에서 in-process 로 떠서, 시나리오를
    켜야만 HMI 가 붙을 수 있었다. 그 사이 HMI 가 늦게 붙으면 시작 신호
    (scenario_runtime started)를 놓쳤다(→ 초기 정상 안내 누락). 이 허브를 **시나리오
    전에 미리** 띄워 두면 HMI/뷰어가 먼저 접속해 대기하고, 시나리오 main.py 는
    publisher 모드(websocket_sender 가 8766 점유를 감지)로 이 허브에 프레임을 전달한다.
    허브는 모든 클라에 중계 + 새 접속 시 마지막 시나리오 상태 재전송(replay-on-connect).

구조:
    [ws_hub.py :8766 상설]  ← publish ─  scenario main.py(시나리오)
            │  broadcast/replay
            └─────────────────→  HMI(시각/음성)·HDMap 뷰어·모니터

실행:
    py -3.10 data-server/sender/ws_hub.py        # Ctrl+C 로 종료
    (포트 변경: 환경변수 WS_PORT=8766 / 로그 고정: WS_LOG=<경로> / 세션키: SESSION_ID=P07_R2)

주의:
    - 허브를 먼저 띄운 뒤 시나리오를 실행해야 publisher 모드가 작동한다(순서 중요).
    - 허브가 없으면 시나리오는 기존처럼 자체 in-process 서버를 호스팅한다(하위호환).
    - JSONL 세션 로그는 허브가 기록한다. WS_LOG 미지정 시 시나리오 started 마다
      ws_session_<epoch>.jsonl 을 새로 연다(런별 분리 → scenarioQA 가 런 단위로 읽음).
      허브를 CARLA 루트에서 실행하면 로그가 그 위치에 쌓인다.
"""
import os
import sys
import time

# data-server/ 를 sys.path 에 올려 `from sender.websocket_sender import ...` 가 동작하게 한다.
_HERE = os.path.dirname(os.path.abspath(__file__))          # .../data-server/sender
sys.path.insert(0, os.path.dirname(_HERE))                  # .../data-server

from sender.websocket_sender import (   # noqa: E402
    start_ws_server, stop_ws_server, DEFAULT_WS_PORT, _probe_port,
)


def main():
    port = DEFAULT_WS_PORT
    if _probe_port(port):
        print(f"[hub] :{port} 이 이미 사용 중입니다(허브가 이미 떠 있거나 포트 충돌). 종료.")
        sys.exit(1)
    ok = start_ws_server(port=port)        # 포트가 비어 있으므로 in-process 호스팅 = 허브 본체
    if not ok:
        print(f"[hub] 8766 기동 실패(websockets 미설치? 포트 충돌?).")
        sys.exit(1)
    print(f"[hub] 상설 WS 허브 가동: ws://0.0.0.0:{port}  —  Ctrl+C 로 종료")
    print(f"[hub] 이제 HMI/뷰어를 먼저 붙이고, 시나리오 main.py 를 실행하세요(publisher 모드 자동).")
    try:
        while True:
            time.sleep(1.0)
    except KeyboardInterrupt:
        print("\n[hub] 종료 요청 수신...")
    finally:
        stop_ws_server()
        print("[hub] 종료 완료.")


if __name__ == "__main__":
    main()
