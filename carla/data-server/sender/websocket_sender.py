"""인프로세스 WebSocket 텔레메트리 송·수신 + 세션 로깅.

(기존) 시나리오 프로세스(main.py → collector) 안에서 WS 서버를 띄워
HDMap 웹 뷰어(index.html)로 ego 위치/속도 프레임을 브로드캐스트한다.
→ 별도의 telemetry_server.py 프로세스를 따로 켤 필요가 없다.

2026-06-04 확장 (PM 결정 ④·⑨ — `04_design/feedback_260604_decisions.md` §3-C):
  ① 양방향화 — `_handler` 가 클라(React HMI A/B·모니터)가 보낸 메시지를 `async for` 로
     수신한다(기존엔 `wait_closed()` 만 하여 일방향이었음). → HMI 반응/입력이 서버로 돌아옴.
  ② 단일 권위 시계 `t_bus` — 서버가 중계하는 모든 메시지(발신 프레임·수신 HMI 메시지)에
     단조시계(time.monotonic) 1개를 찍는다. 장치 시계차 없이 동기·latency 가 성립.
  ③ JSONL 세션 로거 — WebSocket 이 "센서 텔레메트리 로그 ∧ 실험 트래킹 로그"의 이중 역할.
     publish_frame(센서 스트림)과 수신 HMI 상호작용을 한 파일(JSONL)에 같은 t_bus 축으로
     남긴다. → `scenarios/tools/scenarioQA.py` 가 이 로그를 읽어 시나리오 6지표를 사후 산출.

하위호환: 기존 HDMap 뷰어는 그대로 동작한다(publish_frame 브로드캐스트 유지, 프레임에
키만 몇 개 더 붙을 뿐 뷰어는 모르는 키를 무시). 양방향·로깅은 순수 추가.
브라우저는 CARLA RPC(2000)에 직접 못 붙으므로 파이썬이 ws://<host>:8765 로 중계하는 구조는 유지.
websockets 패키지가 없으면 조용히 비활성화된다(지도/시나리오는 그대로 동작).

사용:
    from sender.websocket_sender import start_ws_server, publish_frame, stop_ws_server
    start_ws_server(port=8765)              # log_path=None → 자동 파일명, False → 로깅 끔
    publish_frame({"map":"Town04","id":1,"x":..,"y":..,"z":..,"yaw":..,"speed":..,"t":..})
    stop_ws_server()
"""
import asyncio
import json
import os
import socket
import threading
import time

try:
    import websockets
    _WS_AVAILABLE = True
except ImportError:
    _WS_AVAILABLE = False

_loop = None
_thread = None
_clients = set()
_stop_evt = None          # asyncio.Event (이벤트 루프 스레드 소유)
_started = threading.Event()

# ── 세션 JSONL 로거 (센서 ∧ 실험 트래킹 로그) ──
_log_fh = None
_log_lock = threading.Lock()
_t0 = None                # 서버 시작 시각(monotonic) — t_bus 의 0점

# 세션 식별자(스펙 §2.1·§5): 모든 메시지에 중앙 스탬프. 운영자 콘솔/실행 시 SESSION_ID env 로 지정
#   (예: P07_R2). 미지정이면 'DEV'. 피험자 식별정보가 아니라 세션키만 기록(연구 무결성).
_SESSION_ID = os.environ.get("SESSION_ID", "DEV")
# CARLA→HMI/뷰어 WebSocket 포트. 2026-06-19: 8765→8766 이동(B안 음성 wake_word_server :8765 충돌 회피).
#   WS_PORT env 로 덮어쓰기 가능. 브라우저 뷰어/HMI 도 같은 포트로 접속해야 함.
DEFAULT_WS_PORT = int(os.environ.get("WS_PORT", "8766"))

# 직전 world_metric 의 sim-time(t_sim, CARLA snapshot.elapsed_seconds). scenario_event 처럼
#   t_sim 이 없는 메시지에 같은 sim-clock 축을 중앙 스탬프하기 위함(scenarioQA G0-4: 미분/이벤트
#   기준 지표는 t_sim 축만 사용 → 이벤트가 t_bus 로 폴백되면 brake_delay 등이 다른 축과 섞임).
#   world_metric 이 ~26Hz 로 publish_frame 을 타며 갱신하므로 이벤트와의 오차는 한 틱(~38ms) 이내.
_LAST_SIM_T = None

# ── 상설 허브 / publisher 모드 (2026-06-27) ──────────────────────────────────
# 8766 이 이미 떠 있으면(별도 ws_hub.py 상설 허브) 시나리오 프로세스는 WS 서버를
# 직접 호스팅하지 않고, 허브에 WS 클라이언트로 붙어 프레임을 전달한다(publisher 모드).
# 허브가 모든 HMI/뷰어 클라에 중계 + 새 접속 시 마지막 시나리오 상태 재전송(replay-on-connect).
# 허브가 없으면(포트 비어 있음) 기존처럼 in-process 호스팅 → 완전한 하위호환.
_pub_mode = False         # True → 외부 허브로 전달(서버 미호스팅)
_pub_loop = None          # publisher asyncio 루프(별도 스레드)
_pub_thread = None
_pub_ws = None            # 허브로의 클라이언트 연결
_pub_send_q = None        # 송신 큐(asyncio.Queue, 루프 스레드 소유)

# replay-on-connect 캐시: 마지막 시나리오 런타임/이벤트(JSON 문자열). 새 클라 접속 시 즉시 전송한다.
# 허브 모드에서는 _handler(허브가 publisher 로부터 수신) 가, in-process 모드에서는 publish_frame 이 채운다.
_last_runtime = None
_last_event = None


def _cache_scenario_state(msg):
    """시나리오 상태(scenario_runtime/scenario_event)를 replay-on-connect 용으로 캐시.

    started/event 는 보관, stopped 는 캐시를 비운다(종료 후 접속자에 stale started 안 보냄).
    """
    global _last_runtime, _last_event
    if not isinstance(msg, dict):
        return
    t = msg.get("type")
    if t == "scenario_runtime":
        if msg.get("status") == "stopped":
            _last_runtime = None
            _last_event = None
        else:
            try:
                _last_runtime = json.dumps(msg, ensure_ascii=False)
            except (TypeError, ValueError):
                pass
    elif t == "scenario_event":
        try:
            _last_event = json.dumps(msg, ensure_ascii=False)
        except (TypeError, ValueError):
            pass


def _probe_port(port):
    """port 가 이미 사용 중(상설 허브 등)이면 True.

    TCP connect 가 아니라 bind 시도로 확인한다 → 허브 서버에 비-WS 연결을 만들지 않아
    허브 쪽 핸드셰이크 오류 로그를 남기지 않는다. bind 성공=비어 있음, 실패(EADDRINUSE)=사용 중.
    서버가 wildcard("0.0.0.0")로 serve 하므로 probe 도 wildcard 로 bind 해야 충돌이 잡힌다
    (Windows 에서 127.0.0.1 bind 는 0.0.0.0 점유와 안 부딪혀 오탐). SO_REUSEADDR 미설정.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("0.0.0.0", port))
        return False
    except OSError:
        return True
    finally:
        s.close()


def _now_bus():
    """단조 증가 권위 시계(초). 서버 시작을 0으로 둔다."""
    return (time.monotonic() - _t0) if _t0 is not None else time.monotonic()


def _open_log(log_path):
    """세션 로그 파일 열기. None→자동(ws_session_<epoch>.jsonl / $WS_LOG), False→비활성."""
    global _log_fh
    if log_path is False:
        _log_fh = None
        return
    if log_path is None:
        log_path = os.environ.get("WS_LOG") or f"ws_session_{int(time.time())}.jsonl"
    try:
        _log_fh = open(log_path, "a", encoding="utf-8")
        print(f"[WS] 세션 로그 → {os.path.abspath(log_path)} (센서 ∧ 실험 트래킹 JSONL)")
    except OSError as e:
        print(f"[WS] 세션 로그 파일 열기 실패({e}) → 로깅 비활성")
        _log_fh = None


def _rotate_log():
    """런별 JSONL 분리: 상설 허브가 새 시나리오 started 를 받을 때 새 세션 파일을 연다.

    상설 허브는 여러 런에 걸쳐 살아 있으므로, started 마다 로그를 갈아끼워 런마다
    독립 ws_session 파일을 유지한다(scenarioQA 가 런별로 읽도록). $WS_LOG 가 고정 파일을
    지정한 경우엔 회전하지 않고 그 파일에 계속 append(사용자 의도 존중).
    """
    global _log_fh, _t0
    if os.environ.get("WS_LOG"):
        return                       # 고정 경로 지정 시 회전 안 함
    with _log_lock:
        if _log_fh is not None:
            try:
                _log_fh.flush()
                _log_fh.close()
            except OSError:
                pass
            _log_fh = None
    _t0 = time.monotonic()           # 새 런 → t_bus 0점 재설정
    _open_log(None)                  # ws_session_<epoch>.jsonl 새로 생성


def _log_jsonl(obj):
    """t_bus 스탬프된 메시지 1건을 JSONL 한 줄로 기록(스레드 안전)."""
    if _log_fh is None:
        return
    try:
        line = json.dumps(obj, ensure_ascii=False)
    except (TypeError, ValueError):
        return
    with _log_lock:
        try:
            _log_fh.write(line + "\n")
            _log_fh.flush()
        except OSError:
            pass


def _broadcast(text):
    """연결된 모든 클라로 텍스트 1건 브로드캐스트(이벤트 루프 스레드 안전)."""
    if _loop is None or not _clients:
        return
    try:
        _loop.call_soon_threadsafe(websockets.broadcast, list(_clients), text)
    except RuntimeError:
        pass  # 루프가 닫히는 중


async def _handler(conn):
    _clients.add(conn)
    # replay-on-connect: 늦게/재접속한 클라(HMI 새로고침 등)가 현재 시나리오 상태를
    # 놓치지 않도록, 캐시된 마지막 scenario_runtime(started)·scenario_event 를 즉시 보낸다.
    # 상설 허브는 HMI 가 시나리오 시작 전에 미리 붙으므로 보통 started 를 라이브로 받지만,
    # 도중 재접속/늦은 접속도 항상 catch-up 되도록 보강한다.
    try:
        if _last_runtime:
            await conn.send(_last_runtime)
        if _last_event:
            await conn.send(_last_event)
    except Exception:
        pass
    try:
        # 양방향(2026-06-04): HMI(React A/B)·모니터·시나리오 publisher 가 보낸 메시지를
        # 수신해 t_bus 스탬프 후 세션 로그에 남기고, 모든 클라(HMI/뷰어)에 중계한다.
        async for raw in conn:
            try:
                msg = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if not isinstance(msg, dict):
                msg = {"value": msg}
            # ── WS 지연(latency) 계측 핑/퐁 (2026-06-29) ────────────────────────
            # HMI(브라우저)가 보낸 ping 에 즉시 pong 으로 에코한다(요청한 conn 에만 응답,
            # 브로드캐스트·로깅 안 함). HMI 는 pong 수신시각으로 RTT 를 산출해 ws_latency
            # 레코드로 되돌려 보내고, 그건 아래 정상 경로로 t_bus 스탬프·JSONL 로깅된다.
            # 비-ping 메시지엔 영향 0(하위호환): ping/pong 키를 모르는 클라는 그대로 동작.
            if msg.get("type") == "ping":
                try:
                    await conn.send(json.dumps({
                        "type": "pong",
                        "t_client_send": msg.get("t_client_send"),  # HMI 송신시각 원값 에코
                        "t_server": time.time() * 1000.0,            # 서버 wall-clock(epoch ms)
                    }, ensure_ascii=False))
                except Exception:
                    pass
                continue
            # publisher(시나리오) 가 보낸 scenario_*/world_* 는 type/source 가 이미 있어
            # setdefault 가 덮어쓰지 않는다. HMI 상호작용만 기본 hmi_interaction 으로 처리.
            msg.setdefault("type", "hmi_interaction")   # HMI 반응/입력 기본 타입
            msg.setdefault("source", "hmi")
            msg.setdefault("session_id", _SESSION_ID)    # 세션키 중앙 스탬프(스펙 §2.3)
            # 상설 허브: 새 시나리오 started 마다 런별 로그 회전(scenarioQA 런 분리).
            if msg.get("type") == "scenario_runtime" and msg.get("status") == "started":
                _rotate_log()
            msg["t_bus"] = _now_bus()                    # 단일 권위 시계(허브가 권위)
            _cache_scenario_state(msg)                   # replay-on-connect 캐시
            _log_jsonl(msg)                              # 센서 ∧ 실험 트래킹 로그
            _broadcast(json.dumps(msg, ensure_ascii=False))  # 모든 클라로 중계
    except Exception:
        # ConnectionClosed 등은 정상 종료로 간주
        pass
    finally:
        _clients.discard(conn)


async def _serve(host, port):
    global _stop_evt
    _stop_evt = asyncio.Event()
    async with websockets.serve(_handler, host, port):
        print(f"[WS] 텔레메트리 ws://127.0.0.1:{port} (in-process, 양방향+t_bus+JSONL 로깅)")
        _started.set()
        await _stop_evt.wait()


# ── publisher 모드: 외부 상설 허브로 프레임 전달 ───────────────────────────────
async def _pub_main(port, ready_evt, ok):
    """허브(ws://127.0.0.1:port)에 클라이언트로 붙어, 송신 큐의 메시지를 전달한다."""
    global _pub_ws, _pub_send_q
    try:
        _pub_ws = await websockets.connect(f"ws://127.0.0.1:{port}", max_size=None)
    except Exception as e:
        ok["v"] = False
        ready_evt.set()
        print(f"[WS] 허브 연결 실패({e})")
        return
    _pub_send_q = asyncio.Queue()
    ok["v"] = True
    ready_evt.set()

    async def _drain_incoming():
        # 허브가 되돌려보내는 중계 메시지는 무시(시나리오 측은 송신 전용). 연결 종료 감지용.
        try:
            async for _ in _pub_ws:
                pass
        except Exception:
            pass

    reader = asyncio.ensure_future(_drain_incoming())
    try:
        while True:
            text = await _pub_send_q.get()
            if text is None:                 # 종료 sentinel
                break
            try:
                await _pub_ws.send(text)
            except Exception:
                break
    finally:
        reader.cancel()
        try:
            await _pub_ws.close()
        except Exception:
            pass


def _start_publisher(port):
    """외부 허브로의 publisher 연결을 백그라운드 스레드에서 시작. 성공 시 True, 실패 시 False."""
    global _pub_loop, _pub_thread, _pub_mode, _t0
    _pub_loop = asyncio.new_event_loop()
    ready_evt = threading.Event()
    ok = {"v": False}

    def _run():
        asyncio.set_event_loop(_pub_loop)
        try:
            _pub_loop.run_until_complete(_pub_main(port, ready_evt, ok))
        except Exception as e:
            print(f"[WS] publisher 루프 오류: {e}")
        finally:
            _pub_loop.close()

    _pub_thread = threading.Thread(target=_run, name="ws-publisher", daemon=True)
    _pub_thread.start()
    if not ready_evt.wait(timeout=5.0) or not ok["v"]:
        return False
    _pub_mode = True
    _t0 = time.monotonic()
    print(f"[WS] 외부 상설 허브(:{port}) 감지 → publisher 모드(프레임 전달, 서버 미호스팅)")
    return True


def _forward_to_hub(text):
    """publisher 송신 큐로 메시지를 비차단 enqueue(이벤트 루프 스레드 안전)."""
    if _pub_loop is None:
        return
    try:
        _pub_loop.call_soon_threadsafe(_pub_send_q.put_nowait, text)
    except (RuntimeError, AttributeError):
        pass


def start_ws_server(host="0.0.0.0", port=DEFAULT_WS_PORT, log_path=None):
    """백그라운드 스레드에서 WebSocket 서버 시작. 성공 시 True.

    log_path=None → 자동 파일명(또는 환경변수 $WS_LOG), False → 세션 로깅 끔.

    8766 이 이미 떠 있으면(별도 ws_hub.py 상설 허브) 서버를 호스팅하지 않고 그 허브로
    프레임을 전달하는 publisher 모드로 전환한다. 허브가 없으면 기존처럼 in-process 호스팅.
    """
    global _loop, _thread, _t0
    if not _WS_AVAILABLE:
        print("[WS] websockets 미설치 → 텔레메트리/로깅 비활성 "
              "(py -3.10 -m pip install \"websockets>=12\")")
        return False
    if (_thread is not None and _thread.is_alive()) or _pub_mode:
        return True

    # 외부 상설 허브 감지 → publisher 모드(서버 미호스팅, 로깅은 허브가 담당).
    if _probe_port(port):
        if _start_publisher(port):
            return True
        print(f"[WS] :{port} 점유 감지했으나 허브 연결 실패 → in-process 호스팅 시도")

    _t0 = time.monotonic()
    _open_log(log_path)
    _started.clear()
    _loop = asyncio.new_event_loop()

    def _run():
        asyncio.set_event_loop(_loop)
        try:
            _loop.run_until_complete(_serve(host, port))
        except Exception as e:
            print(f"[WS] 서버 종료/오류: {e}")
        finally:
            _loop.close()

    _thread = threading.Thread(target=_run, name="ws-telemetry", daemon=True)
    _thread.start()
    if not _started.wait(timeout=5.0):
        print(f"[WS] 서버 시작 확인 실패 (포트 충돌? {port} 이미 사용 중일 수 있음)")
        return False
    return True


def publish_frame(frame):
    """ego/센서 한 프레임(dict)을 연결된 모든 뷰어로 브로드캐스트 + 세션 로그 기록. 비차단.

    하위호환: 기존 HDMap 뷰어 프레임({map,id,x,y,z,yaw,speed,t})은 그대로 전달.
    추가: source/type/t_bus 스탬프 + JSONL 기록(센서 스트림). 클라가 없어도 로그는 남긴다.
    """
    if not _WS_AVAILABLE:
        return
    if not _pub_mode and _loop is None:
        return                                          # 서버도 publisher 도 없음 → no-op(하위호환)
    if isinstance(frame, dict):
        frame.setdefault("source", "carla")
        frame.setdefault("type", "world_frame")
        frame.setdefault("session_id", _SESSION_ID)   # 세션키 중앙 스탬프(스펙 §2.1·§5)
        # sim-clock(t_sim) 중앙 스탬프: world_metric 은 자체 t_sim 을 싣고 그 값으로 _LAST_SIM_T 를
        #   갱신한다. scenario_event 처럼 t_sim 이 없는 메시지엔 직전 world_metric 의 t_sim 을 찍어
        #   scenarioQA 가 이벤트를 metric 과 같은 sim 축에서 읽도록 한다(t_bus 폴백 축 혼선 방지).
        global _LAST_SIM_T
        _fst = frame.get("t_sim")
        if _fst is not None:
            _LAST_SIM_T = _fst
        elif _LAST_SIM_T is not None:
            frame["t_sim"] = _LAST_SIM_T
        frame["t_bus"] = _now_bus()
    try:
        msg = json.dumps(frame, ensure_ascii=False)
    except (TypeError, ValueError):
        return
    # publisher 모드: 허브로 전달(로깅·브로드캐스트·t_bus 권위는 허브가 담당).
    if _pub_mode:
        _forward_to_hub(msg)
        return
    # in-process 모드: replay 캐시 + 세션 로그 + 모든 클라 브로드캐스트(기존 동작).
    _cache_scenario_state(frame)
    _log_jsonl(frame)
    if not _clients:
        return
    try:
        _loop.call_soon_threadsafe(websockets.broadcast, list(_clients), msg)
    except RuntimeError:
        pass  # 루프가 닫히는 중


def publish_event(event_type, fields=None, source="carla"):
    """scenario_event/world_metric 등 비프레임 이벤트 발행 헬퍼.

    fields 의 키를 **top-level 로 병합**한다(스펙 §2.1: scenario/event 는 top-level,
    동적 수치는 fields['payload'] 안에). scenarioQA._get 도 scenario/event 를 top-level 로 읽음.
    예) publish_event('scenario_event', {
            'scenario':'roundabout', 'event':'junction_deadlock_start', 't_sim':209.0,
            'payload': {'Nsec_to_recover':5, 'recommended_kmh':18, 'current_kmh':17}})
    publish_frame 경로를 타므로 source/session_id/t_bus 스탬프·브로드캐스트·로깅된다.
    """
    msg = {"type": event_type, "source": source}
    if isinstance(fields, dict):
        msg.update(fields)
    publish_frame(msg)


def stop_ws_server():
    global _thread, _log_fh, _pub_mode, _pub_thread
    # publisher 모드: 외부 허브는 그대로 두고(상설), 우리 쪽 클라이언트 연결만 닫는다.
    if _pub_mode:
        if _pub_loop is not None:
            try:
                _pub_loop.call_soon_threadsafe(_pub_send_q.put_nowait, None)  # 종료 sentinel
            except (RuntimeError, AttributeError):
                pass
        if _pub_thread is not None:
            _pub_thread.join(timeout=2.0)
            _pub_thread = None
        _pub_mode = False
        return
    if _loop is not None and _stop_evt is not None:
        try:
            _loop.call_soon_threadsafe(_stop_evt.set)
        except RuntimeError:
            pass
    if _thread is not None:
        _thread.join(timeout=2.0)
        _thread = None
    if _log_fh is not None:
        with _log_lock:
            try:
                _log_fh.flush()
                _log_fh.close()
            except OSError:
                pass
        _log_fh = None
