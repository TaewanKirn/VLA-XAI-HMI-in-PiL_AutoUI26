"""Mock CARLA WebSocket 서버 (:8766) — CARLA 없이 HMI 연동을 검증한다.

목적(G2 게이트 축소): 음성/시각 HMI(`06_stimuli/HCI-prototype`)의 CARLA 브리지가
실제로 도는지 확인하려면 8766 으로 `scenario_event` 를 쏴줄 송신원이 필요하다. 원래는
CARLA(`data-server/sender/websocket_sender.py`)가 그 서버지만, 이 스크립트는 **CARLA 를
전혀 건드리지 않고** 같은 메시지 계약(scenario_event/world_metric/hmi_interaction 왕복)을
재생하는 독립 WS 서버다. → `npm run dev` 로 HMI 띄우고 이 스크립트만 돌리면 오버레이 전환·
시나리오 자동전환·왕복 송신·연결점이 끝까지 검증된다. (CarlaUE4·시나리오 main.py 미실행.)

메시지 계약 정본: `04_design/CARLA/C1_beat_event_map.md`(C1 변곡점→event),
  `hmi_carla_sync_logging_260531.md §2`(scenario_event 형태), `scenarios/hmi_test_client.html`.
websocket_sender.publish_event 와 동일하게 top-level scenario/event + payload 로 보낸다.

사용:
    py -3.10 -m pip install "websockets>=12"     # 최초 1회(없으면)
    py -3.10 scenarios\mock_hmi_server.py          # C1→(쉬고)→C2 1회 재생 후 대기
    py -3.10 scenarios\mock_hmi_server.py --loop    # 무한 반복
    py -3.10 scenarios\mock_hmi_server.py --scenario c1 --metric   # C1 만 + world_metric 스트림
    py -3.10 scenarios\mock_hmi_server.py --interval 2.0           # 비트 간격(초) 조절
    py -3.10 scenarios\mock_hmi_server.py --realtime                # 실측에 가까운 타이밍

HMI 쪽: `06_stimuli/HCI-prototype` 에서 `.env`(VITE_CARLA_HOST=127.0.0.1, PORT=8766) 두고
  `npm run dev` → http://localhost:5173/hmi 접속(상단 연결점 초록 확인). 같은 PC면 127.0.0.1,
  태블릿 분리면 이 PC LAN IP + 방화벽 8766 개방(HMI_prototype_integration.md §4-b).

종료: Ctrl+C.
"""
import argparse
import asyncio
import json
import time

try:
    import websockets
except ImportError:
    raise SystemExit(
        '[mock] websockets 미설치 → py -3.10 -m pip install "websockets>=12"'
    )

PORT = 8766
SESSION_ID = "MOCK"

_clients = set()
_t0 = time.monotonic()


def _now_bus():
    return round(time.monotonic() - _t0, 3)


# ── 비트 시퀀스(정본: C1_beat_event_map.md §1) ─────────────────────────────
# 각 항목: (event, payload, 실측에 가까운 t_sim). payload 의 동적 수치는 HMI 가
# {recommended_kmh}/{Nsec_to_recover}/{current_kmh} 자리에 주입한다.
# C1 타이밍 재설계 2R(2026-06-25) — ego_controller 발화 계약을 미러.
#   drive_start(t≈0 정상) → 도착 → gap_attempt(2회째 진입 어려움) → enter_success('안착'=속도회복) →
#   1.5바퀴 후 deadlock(바퀴마다 재노출, payload.lap) → stuck_stop=lane_change(동시, force_merge ~12s 전) →
#   force_merge=abnormal_loop(동시, 강제진입 직후 한 바퀴 더) → 한 바퀴 → 실제 진출 exit_success → cleared.
#   2R 변경: drive_start 신설 / merge_done 폐기 / abnormal_loop 을 force_merge 직후로 / lane_change 를 stuck_stop 시점으로.
# HMI 게이팅: drive_start·junction_arrive=정상, gap_attempt 는 payload.attempt_n>=2 부터 C1-2.
C1_BEATS = [
    # C1-1 시나리오 시작(정상) — 0~free_roam 정상 주행 구간 표시
    ("drive_start",             {"current_kmh": 30},                                           1.0),
    # C1-1 회전교차로 도착(정상, HMI 미노출)
    ("junction_arrive",         {"current_kmh": 9},                                            91.0),
    # C1-2 진입 시도 — attempt_n 1(정상 유지), 2부터 C1-2 진입 어려움, 4/5 강제
    ("gap_attempt",             {"attempt_n": 1, "current_kmh": 6, "forced": False},           93.0),
    ("gap_attempt",             {"attempt_n": 2, "current_kmh": 5, "forced": False},           98.0),
    ("gap_attempt",             {"attempt_n": 3, "current_kmh": 5, "forced": False},          105.0),
    ("gap_attempt",             {"attempt_n": 4, "current_kmh": 4, "forced": True},           112.0),
    ("gap_attempt",             {"attempt_n": 5, "current_kmh": 4, "forced": True},           118.0),
    # C1-3 진입 후 '안착'(속도 회복 ≥9km/h) = 정상 순환
    ("enter_success",           {"forced": True, "current_kmh": 12},                          124.0),
    # (안쪽 차로 변경 — 정상 순환 유지)
    ("to_inner",                {"current_kmh": 16},                                          167.0),
    # C1-4 1.5바퀴 후 비정상 감지 + 정수 바퀴마다 재노출(payload.lap 으로 재트리거)
    ("junction_deadlock_start", {"recommended_kmh": 18, "current_kmh": 16, "Nsec_to_recover": None, "lap": 1.5}, 181.0),
    ("junction_deadlock_start", {"recommended_kmh": 18, "current_kmh": 16, "Nsec_to_recover": None, "lap": 2},   195.0),
    ("junction_deadlock_start", {"recommended_kmh": 18, "current_kmh": 16, "Nsec_to_recover": None, "lap": 3},   224.0),
    # C1-6 진출지점 정지·갇힘 + 사전고지(lane_change 동시 발행, force_merge ~12s 전)
    ("stuck_stop",              {"current_kmh": 0},                                           258.0),
    ("lane_change",             {"current_kmh": 0},                                           258.0),
    # C1-6 2차로 강제 비집기(STUCK 12s 후) + abnormal_loop(강제진입 직후 한 바퀴 더, 동시)
    ("force_merge",             {"recommended_kmh": 18, "current_kmh": 9, "Nsec_to_recover": 26}, 270.0),
    ("abnormal_loop",           {"current_kmh": 9},                                           270.0),
    # C1-9 한 바퀴 후 실제 진출 성공 → 정상 복귀
    ("exit_success",            {"current_kmh": 18},                                           300.0),
    ("cleared",                 {"current_kmh": 17},                                           302.0),
]

# C2(수막): puddle_enter 1건(요동→감속 묶음). ScenarioSetting §5 + Puddle scenario_event.
C2_BEATS = [
    ("puddle_enter", {"recommended_kmh": 40, "current_kmh": 78, "Nsec_to_recover": 6}, 95.0),
    ("cleared",      {},                                                               110.0),
]


def _event_msg(scenario, event, payload, t_sim):
    """websocket_sender.publish_event 와 동일한 top-level 스키마."""
    return {
        "type": "scenario_event",
        "source": "carla",
        "scenario": scenario,
        "event": event,
        "t_sim": t_sim,
        "session_id": SESSION_ID,
        "t_bus": _now_bus(),
        "payload": payload,
    }


def _metric_msg(speed_kmh, yaw_rate=0.0, long_accel=0.0, lat_accel=0.0, brake=0.0, lane_offset_m=0.0):
    return {
        "type": "world_metric",
        "source": "carla",
        "session_id": SESSION_ID,
        "t_bus": _now_bus(),
        "speed_kmh": round(speed_kmh, 1),
        "yaw_rate": round(yaw_rate, 3),
        "long_accel": round(long_accel, 3),
        "lat_accel": round(lat_accel, 3),
        "brake": round(brake, 3),
        "lane_offset_m": round(lane_offset_m, 3),
    }


def _broadcast(obj):
    if not _clients:
        return
    text = json.dumps(obj, ensure_ascii=False)
    websockets.broadcast(list(_clients), text)


async def _handler(conn):
    _clients.add(conn)
    peer = getattr(conn, "remote_address", ("?",))[0]
    print(f"[mock] HMI 연결됨 ({peer}) · 현재 {len(_clients)}개")
    try:
        # 왕복: HMI 가 보낸 hmi_interaction 을 받아 t_bus 찍어 출력(+echo).
        async for raw in conn:
            try:
                msg = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if not isinstance(msg, dict):
                msg = {"value": msg}
            msg.setdefault("type", "hmi_interaction")
            msg.setdefault("source", "hmi")
            msg.setdefault("session_id", SESSION_ID)
            msg["t_bus"] = _now_bus()
            print(f"[mock] ◀ 수신 {msg.get('type')} "
                  f"{msg.get('action')}={msg.get('value')} (modality={msg.get('modality')})")
            _broadcast(msg)  # 모니터 echo
    except Exception:
        pass
    finally:
        _clients.discard(conn)
        print(f"[mock] HMI 연결 종료 · 현재 {len(_clients)}개")


async def _metric_stream(stop_evt, get_speed):
    """world_metric 을 ~20Hz 로 흘린다(실시간 게이지/DV 로깅용, 화면 넘김과 무관)."""
    while not stop_evt.is_set():
        spd = get_speed()
        _broadcast(_metric_msg(spd, yaw_rate=0.05, lat_accel=0.3, brake=0.0))
        await asyncio.sleep(0.05)


async def _play(beats, scenario, interval, realtime, label):
    print(f"\n[mock] ── {label} 재생 시작 ({len(beats)} 비트) ──")
    prev_t = None
    for event, payload, t_sim in beats:
        if realtime and prev_t is not None:
            wait = max(0.5, (t_sim - prev_t) * 0.1)  # 실측 간격의 1/10(검증 편의)
        else:
            wait = interval
        prev_t = t_sim
        await asyncio.sleep(wait)
        msg = _event_msg(scenario, event, payload, t_sim)
        _broadcast(msg)
        tag = "(미연결 — HMI 띄우고 연결되면 다음부터 수신)" if not _clients else ""
        print(f"[mock] ▶ {scenario}/{event:<24} t_sim={t_sim:<6} payload={payload} {tag}")


async def main_async(args):
    state = {"speed": 50.0}
    stop_evt = asyncio.Event()

    async with websockets.serve(_handler, "0.0.0.0", PORT):
        print(f"[mock] CARLA mock WS 서버 ws://0.0.0.0:{PORT} (scenario_event 재생)")
        print(f"[mock] HMI: 06_stimuli/HCI-prototype 에서 npm run dev → http://localhost:5173/hmi")
        print(f"[mock] 같은 PC면 .env VITE_CARLA_HOST=127.0.0.1 · 태블릿이면 이 PC LAN IP + 방화벽 8766")
        print(f"[mock] 연결을 기다립니다… (HMI 안 띄워도 재생은 진행 — 연결되면 그 시점부터 수신)")

        metric_task = None
        if args.metric:
            metric_task = asyncio.create_task(_metric_stream(stop_evt, lambda: state["speed"]))

        # 첫 비트 전 잠깐 대기(HMI 연결 여유)
        await asyncio.sleep(2.0)

        seqs = []
        if args.scenario in ("c1", "both"):
            seqs.append((C1_BEATS, "roundabout", "C1 회전교차로 답답함"))
        if args.scenario in ("c2", "both"):
            seqs.append((C2_BEATS, "aquaplaning", "C2 빗길 수막현상"))

        while True:
            for beats, scn, lbl in seqs:
                await _play(beats, scn, args.interval, args.realtime, lbl)
                await asyncio.sleep(args.interval * 1.5)  # 시나리오 사이 간격
            if not args.loop:
                break
            print("\n[mock] --loop: 시퀀스 재시작\n")

        print("\n[mock] 재생 완료. 서버는 계속 떠 있습니다(왕복 송신 테스트 가능). Ctrl+C 로 종료.")
        if metric_task:
            await asyncio.Event().wait()  # 유지
        else:
            await asyncio.Event().wait()


def main():
    ap = argparse.ArgumentParser(description="CARLA 없이 HMI 연동을 검증하는 mock 8766 서버")
    ap.add_argument("--scenario", choices=["c1", "c2", "both"], default="both",
                    help="재생할 시나리오 (기본 both: C1→C2)")
    ap.add_argument("--interval", type=float, default=3.5,
                    help="비트 간격(초). 기본 3.5 (검증용 압축)")
    ap.add_argument("--realtime", action="store_true",
                    help="실측 t_sim 간격의 1/10 으로 재생(상대 타이밍 보존)")
    ap.add_argument("--loop", action="store_true", help="시퀀스 무한 반복")
    ap.add_argument("--metric", action="store_true",
                    help="world_metric(~20Hz)도 함께 스트리밍(실시간 게이지 테스트)")
    args = ap.parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\n[mock] 종료(Ctrl+C).")


if __name__ == "__main__":
    main()
