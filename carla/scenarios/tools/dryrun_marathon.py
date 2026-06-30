#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
dryrun_marathon.py — 무인 24h 연속 드라이런 오케스트레이터 (sim-ops 트랙)

목적
----
단일 *동결(frozen) 빌드*를 사람 미탑승 상태로 N회 반복 실행하여,
자극물 동결 CV / 6지표 분포 / real-time factor / 통신지연(ws_latency)을
다수 반복으로 자동 누적한다. CV(동결)가 유효하려면 같은 빌드를 반복해야
하므로, 이 하네스는 코드를 절대 건드리지 않고 같은 main.py 를 반복 launch 한다.

플러밍(핵심 사실)
------------------
- 각 시나리오 프로세스(main.py)는 그 안에서 WS sender(8765/8766)를 띄우고,
  세션 JSONL 을 `data-server/sender/websocket_sender.py` 의 `_open_log` 가 기록한다.
  로그 경로는 환경변수 **WS_LOG** 로 고정 가능(없으면 ws_session_<epoch>.jsonl).
  → 이 하네스는 런마다 고유 WS_LOG 를 주입해 런↔JSONL 1:1 매핑을 보장한다.
  (WS_LOG 고정 시 sender 는 회전하지 않고 그 파일에 append 하지만, 각 런은
   *새 프로세스*라 매번 새 고유 경로를 받으므로 섞이지 않는다.)
- 런 종료 시 scenarioQA.py --input <run>.jsonl --scenario {C1|C2} 를 호출하면
  마지막 stdout 줄에 기계판독용 JSON dict({"metrics":..,"warnings":..})가 나온다.
  여기서 6지표 + real_time_factor + slowmo_flag 를 회수한다.
- ws_latency / collisions / completed 는 JSONL 을 직접 가볍게 스캔해 산출한다.

운영 원칙 (CLAUDE.md §4 체감게이트 축소 루프의 ② CARLA 드라이런 자동화)
- 사람·6DOF 없음. 순수 무인 누적.
- CARLA 실행은 한 PC의 단일 직렬 자원 → 동시에 한 시나리오만.
- 워치독: 런 hang 시 timeout → 프로세스 트리 kill → (옵션) CarlaUE4 재시작 → 'failed' 기록 후 다음.
- 재개 안전: 마스터 CSV 의 max(run_idx)+1 부터 이어붙임.

Windows 실행 (동결 빌드 전제)
  py -3.10 scenarios\tools\dryrun_marathon.py --hours 24
  py -3.10 scenarios\tools\dryrun_marathon.py --runs 40 --scenarios C1,C2
  py -3.10 scenarios\tools\dryrun_marathon.py --hours 24 ^
      --carla-exe "C:\CARLA_0.9.15\CarlaUE4.exe" --carla-restart-on-timeout

Mac(이 머신)에서는 CARLA 를 못 돌리므로 로직만 검증:
  python3 scenarios/tools/dryrun_marathon.py --self-test

⚠ CARLA 모노레포 코드: 본 파일은 신규 도구이며 commit 은 사용자 확인 후.
"""

import argparse
import csv
import glob
import json
import math
import os
import signal
import statistics
import subprocess
import sys
import time
from datetime import datetime

IS_WIN = os.name == "nt"

# 이 파일: <repo>/scenarios/tools/dryrun_marathon.py  →  repo = 3단계 위
_THIS = os.path.abspath(__file__)
_DEFAULT_REPO = os.path.dirname(os.path.dirname(os.path.dirname(_THIS)))

# 시나리오 → main.py 상대경로 (CLAUDE.md 표준)
SCENARIO_MAIN = {
    "C1": os.path.join("scenarios", "frustration", "main.py"),
    "C2": os.path.join("scenarios", "anxiety", "Puddle", "main.py"),
}
# 런 길이 가늠(워치독 기본 타임아웃 산정 보조). 실제 종료는 main.py 가 결정.
SCENARIO_NOMINAL_S = {"C1": 489, "C2": 240}

# 마스터 CSV 스키마 — 분석에서 바로 읽을 수 있는 평탄 1행/런
CSV_COLS = [
    "run_idx", "ts", "scenario", "status",
    "min_ttc", "max_jerk", "max_yaw", "max_lat_accel",
    "brake_delay", "recovery", "lane_dev", "overshoot",
    "rtf", "slowmo",
    "latency_med", "latency_p95",
    "collisions", "completed",
    "n_metric_frames", "n_events", "duration_s", "jsonl",
]

# scenarioQA metrics dict 키 → 마스터 CSV 컬럼
QA_KEY_MAP = {
    "min_ttc": "min_ttc_s",
    "max_jerk": "max_jerk_m_s3",
    "max_yaw": "max_yaw_rate_rad_s",
    "max_lat_accel": "max_lat_accel_m_s2",
    "brake_delay": "brake_response_delay_s",
    "recovery": "recovery_time_s",
    "lane_dev": "lane_departure_m",
    "overshoot": "overshoot_kmh",
    "rtf": "real_time_factor",
    "n_metric_frames": "n_metric_frames",
    "n_events": "n_events",
}
# CV(동결 판정)에 쓰는 핵심 수치 지표
CV_METRICS = ["min_ttc", "max_jerk", "max_yaw", "max_lat_accel",
              "brake_delay", "recovery", "lane_dev", "rtf",
              "latency_med", "latency_p95"]

COMPLETED_EVENTS = {"exit_success", "cleared", "done", "finished",
                    "complete", "completed", "scenario_done"}


def log(msg):
    print(f"[marathon {datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ────────────────────────────────────────────────────────────────────────────
# JSONL 직접 스캔 — ws_latency / collisions / completed (scenarioQA 미산출분)
# ────────────────────────────────────────────────────────────────────────────
def _percentile(sorted_vals, q):
    if not sorted_vals:
        return ""
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    pos = (len(sorted_vals) - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return sorted_vals[lo]
    frac = pos - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def scan_jsonl_extras(jsonl_path):
    """ws_latency median/p95, collisions, completed 를 JSONL 에서 직접 산출.
    스키마 변동에 관대하게(graceful) 동작: 키가 없으면 0/공란."""
    lat = []
    collisions = 0
    completed = False
    if not (jsonl_path and os.path.exists(jsonl_path)):
        return {"latency_med": "", "latency_p95": "",
                "collisions": "", "completed": False}
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    m = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(m, dict):
                    continue
                # ws_latency 레코드: {"type":"ws_latency","rtt_ms":..,"oneway_ms":..}
                # RTT(왕복)를 1차 통신지연 지표로 통계. 구형/대체 키도 관대 수용.
                if (m.get("type") or "").lower() == "ws_latency":
                    v = m.get("rtt_ms")
                    if v is None:
                        v = m.get("oneway_ms")
                else:
                    v = m.get("ws_latency")
                    if v is None:
                        v = m.get("latency_ms")
                if v is not None:
                    try:
                        lat.append(float(v))
                    except (TypeError, ValueError):
                        pass
                mtype = (m.get("type") or "").lower()
                ev = (m.get("event") or "").lower()
                # 충돌: type/event 에 collision 이 있거나, 프레임에 collision 카운트 필드
                if mtype == "collision" or "collision" in ev:
                    collisions += 1
                cv = m.get("collisions") or m.get("collision")
                if isinstance(cv, (int, float)) and cv and mtype != "collision":
                    # 누적 카운터형이면 최대값을 충돌수로 본다
                    collisions = max(collisions, int(cv))
                if mtype == "scenario_event" and ev in COMPLETED_EVENTS:
                    completed = True
                if str(m.get("status") or "").upper() == "DONE":
                    completed = True
    except OSError:
        pass
    lat.sort()
    med = round(statistics.median(lat), 3) if lat else ""
    p95 = round(_percentile(lat, 0.95), 3) if lat else ""
    return {"latency_med": med, "latency_p95": p95,
            "collisions": collisions, "completed": completed}


# ────────────────────────────────────────────────────────────────────────────
# scenarioQA 호출 → metrics dict
# ────────────────────────────────────────────────────────────────────────────
def run_scenario_qa(qa_path, jsonl_path, scenario, python_cmd):
    """scenarioQA.py 를 호출하고 마지막 stdout 줄(JSON)을 파싱해 metrics dict 반환.
    실패 시 (None, reason)."""
    if not os.path.exists(jsonl_path):
        return None, "jsonl-missing"
    cmd = list(python_cmd) + [qa_path, "--input", jsonl_path,
                              "--scenario", scenario]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return None, "qa-timeout"
    except OSError as e:
        return None, f"qa-oserror:{e}"
    # 마지막 JSON 줄 찾기(scenarioQA 가 보고문 뒤 기계판독 JSON 1줄을 출력)
    metrics = None
    for line in reversed(p.stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{") and '"metrics"' in line:
            try:
                metrics = json.loads(line)["metrics"]
                break
            except (json.JSONDecodeError, KeyError):
                continue
    if metrics is None:
        return None, f"qa-noparse(rc={p.returncode})"
    return metrics, None


def _fmt(v):
    """NaN/None → 공란, 그 외 → 값(분석에서 결측으로 읽히게)."""
    if v is None:
        return ""
    if isinstance(v, float) and math.isnan(v):
        return ""
    return v


def build_csv_row(run_idx, scenario, status, metrics, extras, duration_s,
                  jsonl_name):
    row = {c: "" for c in CSV_COLS}
    row["run_idx"] = run_idx
    row["ts"] = datetime.now().isoformat(timespec="seconds")
    row["scenario"] = scenario
    row["status"] = status
    row["duration_s"] = round(duration_s, 1)
    row["jsonl"] = jsonl_name
    if metrics:
        for col, qk in QA_KEY_MAP.items():
            row[col] = _fmt(metrics.get(qk))
        row["slowmo"] = int(bool(metrics.get("slowmo_flag")))
    if extras:
        row["latency_med"] = _fmt(extras.get("latency_med"))
        row["latency_p95"] = _fmt(extras.get("latency_p95"))
        row["collisions"] = _fmt(extras.get("collisions"))
        row["completed"] = int(bool(extras.get("completed")))
    return row


def append_csv(csv_path, row):
    exists = os.path.exists(csv_path)
    os.makedirs(os.path.dirname(os.path.abspath(csv_path)), exist_ok=True)
    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLS)
        if not exists:
            w.writeheader()
        w.writerow(row)


def next_run_idx(csv_path):
    """재개 안전: 기존 CSV 의 max(run_idx)+1. 없으면 1."""
    if not os.path.exists(csv_path):
        return 1
    last = 0
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    last = max(last, int(r.get("run_idx") or 0))
                except (TypeError, ValueError):
                    continue
    except OSError:
        return 1
    return last + 1


# ────────────────────────────────────────────────────────────────────────────
# 프로세스 관리 (Windows 우선)
# ────────────────────────────────────────────────────────────────────────────
def kill_stray_scenarios(repo_root):
    """잔여 시나리오/뷰어 프로세스 정리(매 런 전, '더블틱'). 하네스 자신은 제외.
    Windows: commandline 에 scenarios/main.py 를 포함한 python 프로세스만 골라 kill
    (image 전체 kill 은 하네스 자살 위험 → 금지)."""
    me = os.getpid()
    if IS_WIN:
        ps = (
            "Get-CimInstance Win32_Process "
            "| Where-Object { $_.Name -match 'python' -and "
            "  ($_.CommandLine -match 'scenarios' -or $_.CommandLine -match 'main.py' "
            "   -or $_.CommandLine -match 'viewer') -and "
            "  $_.CommandLine -notmatch 'dryrun_marathon' } "
            "| Select-Object -ExpandProperty ProcessId"
        )
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                                 capture_output=True, text=True, timeout=30).stdout
        except (OSError, subprocess.TimeoutExpired):
            out = ""
        for tok in out.split():
            try:
                pid = int(tok)
            except ValueError:
                continue
            if pid == me:
                continue
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           capture_output=True)
        # 뷰어(pygame) 잔여 창은 이름으로도 한번 더(있으면) — 없으면 무해
        subprocess.run(["taskkill", "/FI", "WINDOWTITLE eq *viewer*", "/F"],
                       capture_output=True)
    else:
        # Mac/Linux(자가검증·개발용): pkill -f, 자기 자신 제외는 pkill 이 처리 못 하므로
        # commandline 패턴을 좁게.
        for pat in ("frustration/main.py", "anxiety/Puddle/main.py"):
            subprocess.run(["pkill", "-f", pat], capture_output=True)


def kill_proc_tree(proc):
    """런 프로세스 트리 종료(워치독). 항상 정확(우리가 launch 한 PID)."""
    if proc is None or proc.poll() is not None:
        return
    if IS_WIN:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       capture_output=True)
    else:
        try:
            proc.send_signal(signal.SIGTERM)
            time.sleep(2)
            if proc.poll() is None:
                proc.kill()
        except OSError:
            pass


def restart_carla(carla_exe, carla_args, ready_wait):
    """CarlaUE4 hang 복구 훅: 기존 서버 kill → 재launch → ready 대기."""
    log("CARLA 재시작 훅 발동")
    if IS_WIN:
        subprocess.run(["taskkill", "/IM", "CarlaUE4.exe", "/T", "/F"],
                       capture_output=True)
        subprocess.run(["taskkill", "/IM", "CarlaUE4-Win64-Shipping.exe",
                        "/T", "/F"], capture_output=True)
    else:
        subprocess.run(["pkill", "-f", "CarlaUE4"], capture_output=True)
    time.sleep(5)
    try:
        subprocess.Popen([carla_exe] + carla_args)
    except OSError as e:
        log(f"CARLA 재launch 실패: {e}")
        return False
    log(f"CARLA ready 대기 {ready_wait}s …")
    time.sleep(ready_wait)
    return True


# ────────────────────────────────────────────────────────────────────────────
# 단일 런
# ────────────────────────────────────────────────────────────────────────────
def find_run_jsonl(ws_log_path, jsonl_dir, since_ts):
    """WS_LOG 경로 우선. 비었거나 없으면 since_ts 이후 생성된 jsonl 중 최신."""
    if ws_log_path and os.path.exists(ws_log_path) and \
            os.path.getsize(ws_log_path) > 0:
        return ws_log_path
    cands = []
    for d in {jsonl_dir, os.getcwd()}:
        cands += glob.glob(os.path.join(d, "*.jsonl"))
    cands = [c for c in cands if os.path.getmtime(c) >= since_ts - 1
             and os.path.getsize(c) > 0]
    if not cands:
        return ws_log_path  # 그래도 None/빈 경로 반환(상위에서 missing 처리)
    return max(cands, key=os.path.getmtime)


def do_one_run(run_idx, scenario, cfg):
    """한 런 실행 → (csv_row, status)."""
    main_rel = SCENARIO_MAIN[scenario]
    main_path = os.path.join(cfg["repo_root"], main_rel)
    ts_tag = datetime.now().strftime("%Y%m%d_%H%M%S")
    ws_log = os.path.join(cfg["jsonl_dir"],
                          f"run{run_idx:04d}_{scenario}_{ts_tag}.jsonl")
    os.makedirs(cfg["jsonl_dir"], exist_ok=True)

    log(f"=== RUN {run_idx} [{scenario}] 시작 → {os.path.basename(ws_log)}")
    kill_stray_scenarios(cfg["repo_root"])
    time.sleep(1)
    kill_stray_scenarios(cfg["repo_root"])  # 더블틱

    env = dict(os.environ)
    env["WS_LOG"] = ws_log
    env["SCENARIO"] = scenario  # 6DOF 프로파일 자동선택(각 main.py 도 자체 설정하나 명시)

    cmd = list(cfg["python_cmd"]) + [main_path]
    t0 = time.time()
    status = "ok"
    try:
        proc = subprocess.Popen(cmd, cwd=cfg["repo_root"], env=env)
    except OSError as e:
        log(f"launch 실패: {e}")
        row = build_csv_row(run_idx, scenario, "launch_fail", None, None,
                            0.0, os.path.basename(ws_log))
        return row, "launch_fail"

    timeout = cfg["per_run_timeout"]
    while True:
        rc = proc.poll()
        if rc is not None:
            if rc != 0:
                status = f"exit_{rc}"
                log(f"RUN {run_idx} 비정상 종료 rc={rc}")
            break
        if time.time() - t0 > timeout:
            log(f"RUN {run_idx} TIMEOUT(>{timeout}s) → hang 으로 간주, kill")
            kill_proc_tree(proc)
            status = "timeout"
            cfg["_consec_hang"] += 1
            break
        time.sleep(2)
    else:
        pass

    duration = time.time() - t0
    # 종료 후 잔여 정리(다음 런 위생)
    kill_stray_scenarios(cfg["repo_root"])

    # CARLA 재시작 훅: timeout 누적 또는 매 timeout 시
    if status == "timeout" and cfg["carla_exe"] and cfg["carla_restart_on_timeout"]:
        if cfg["_consec_hang"] >= cfg["carla_restart_after"]:
            restart_carla(cfg["carla_exe"], cfg["carla_args"],
                          cfg["carla_ready_wait"])
            cfg["_consec_hang"] = 0
    if status == "ok":
        cfg["_consec_hang"] = 0

    # 집계
    jsonl = find_run_jsonl(ws_log, cfg["jsonl_dir"], t0)
    extras = scan_jsonl_extras(jsonl)
    metrics, qa_err = run_scenario_qa(cfg["qa_path"], jsonl, scenario,
                                      cfg["python_cmd"])
    if metrics is None:
        log(f"RUN {run_idx} scenarioQA 집계 실패: {qa_err}")
        if status == "ok":
            status = f"qa_fail:{qa_err}"
    row = build_csv_row(run_idx, scenario, status, metrics, extras,
                        duration, os.path.basename(jsonl) if jsonl else "")
    append_csv(cfg["csv_path"], row)
    log(f"RUN {run_idx} [{scenario}] status={status} "
        f"rtf={row['rtf']} min_ttc={row['min_ttc']} "
        f"jerk={row['max_jerk']} lat_med={row['latency_med']} "
        f"→ CSV append")

    # 디스크 관리: JSONL 회전/삭제
    if jsonl and os.path.exists(jsonl):
        if cfg["keep_jsonl"]:
            pass
        elif cfg["gzip_jsonl"]:
            _gzip_and_remove(jsonl)
        else:
            try:
                os.remove(jsonl)
            except OSError:
                pass
    return row, status


def _gzip_and_remove(path):
    import gzip
    import shutil
    try:
        with open(path, "rb") as fi, gzip.open(path + ".gz", "wb") as fo:
            shutil.copyfileobj(fi, fo)
        os.remove(path)
    except OSError:
        pass


# ────────────────────────────────────────────────────────────────────────────
# 종료 요약: 평균±SD·CV (동결 판정 보조)
# ────────────────────────────────────────────────────────────────────────────
def summarize(csv_path):
    if not os.path.exists(csv_path):
        log("요약: CSV 없음")
        return
    rows = []
    with open(csv_path, "r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        log("요약: 행 없음")
        return
    print("\n" + "=" * 72)
    print("  무인 드라이런 마라톤 — 종료 요약 (동결 판정 보조)")
    print("=" * 72)
    n = len(rows)
    ok = [r for r in rows if r.get("status") == "ok"]
    print(f"  총 런: {n}   성공(ok): {len(ok)}   "
          f"비ok: {n - len(ok)}")
    by_status = {}
    for r in rows:
        by_status[r.get("status", "?")] = by_status.get(r.get("status", "?"), 0) + 1
    print("  상태 분포: " + ", ".join(f"{k}={v}" for k, v in
                                   sorted(by_status.items())))
    comp = sum(1 for r in ok if str(r.get("completed")) == "1")
    coll = sum(int(r.get("collisions") or 0) for r in ok if (r.get("collisions") or "").strip().isdigit())
    print(f"  완주(ok 중): {comp}/{len(ok)}    충돌 총합(ok): {coll}")

    for scn in ("C1", "C2"):
        sub = [r for r in ok if r.get("scenario") == scn]
        if not sub:
            continue
        print("-" * 72)
        print(f"  [{scn}] n={len(sub)} (성공런 기준)   지표  mean ± SD   (CV%)")
        for mk in CV_METRICS:
            vals = []
            for r in sub:
                v = r.get(mk)
                if v is None or str(v).strip() == "":
                    continue
                try:
                    vals.append(float(v))
                except ValueError:
                    continue
            if len(vals) < 2:
                disp = f"{vals[0]:.4g}" if vals else "—"
                print(f"    {mk:<14}: {disp:<22} (n<2, CV N/A)")
                continue
            mean = statistics.mean(vals)
            sd = statistics.pstdev(vals)
            cv = (sd / mean * 100) if mean not in (0, 0.0) else float("nan")
            cvs = "N/A" if math.isnan(cv) else f"{cv:5.1f}%"
            print(f"    {mk:<14}: {mean:10.4g} ± {sd:9.4g}   ({cvs})  "
                  f"[n={len(vals)}]")
    print("=" * 72)
    print("  CV 해석(동결 판정): 같은 동결 빌드 반복이므로 CV 가 작을수록 자극물이")
    print("  결정론적으로 동결되었다는 증거. 권고 게이트 예: 핵심 6지표 CV < 10~15%.")
    print("  CV 가 큰 지표는 (a)빌드 비동결 (b)런타임 비결정성(트래픽/물리)을 의심.")
    print("=" * 72)


# ────────────────────────────────────────────────────────────────────────────
# 자가검증(Self-test) — CARLA 불필요(Mac), 로직만
# ────────────────────────────────────────────────────────────────────────────
def self_test(cfg):
    import tempfile
    print("=" * 60)
    print("  SELF-TEST (CARLA 불필요) — 인자/JSONL스캔/QA호출/CSV/요약")
    print("=" * 60)
    fails = []
    tmp = tempfile.mkdtemp(prefix="marathon_selftest_")

    # 1) 합성 JSONL (world_metric 프레임 + scenario_event + ws_latency 레코드)
    jp = os.path.join(tmp, "synth.jsonl")
    with open(jp, "w", encoding="utf-8") as f:
        base = 1000.0
        for i in range(40):
            t = base + i * 0.05
            f.write(json.dumps({
                "type": "world_metric", "t_sim": i * 0.05, "t_bus": t,
                "speed": 20 + i * 0.1, "x": i * 0.5, "y": 0.0,
                "yaw": 0.1 * i, "yaw_rate": 0.02, "long_accel": 0.3,
                "lat_accel": 0.2, "brake": 0.0, "lane_offset_m": 0.05,
                "session_id": "SELFTEST",
            }) + "\n")
            # 통신지연 레코드(실제 형식): type=ws_latency, rtt_ms 1차 지표
            f.write(json.dumps({
                "type": "ws_latency", "modality": "visual",
                "rtt_ms": 12 + (i % 5), "oneway_ms": (12 + (i % 5)) / 2.0,
                "t_bus": t, "session_id": "SELFTEST",
            }) + "\n")
        f.write(json.dumps({"type": "scenario_event", "t_bus": base + 1.0,
                            "event": "drive_start", "scenario": "C1"}) + "\n")
        f.write(json.dumps({"type": "scenario_event", "t_bus": base + 2.0,
                            "event": "exit_success", "scenario": "C1"}) + "\n")
    # 2) JSONL 스캔 extras
    ex = scan_jsonl_extras(jp)
    if ex["latency_med"] == "" or ex["latency_p95"] == "":
        fails.append("ws_latency 통계 산출 실패")
    if not ex["completed"]:
        fails.append("completed 감지 실패(exit_success)")
    print(f"  [1] JSONL extras: lat_med={ex['latency_med']} "
          f"p95={ex['latency_p95']} collisions={ex['collisions']} "
          f"completed={ex['completed']}  "
          f"→ {'OK' if 'completed' not in ''.join(fails) else 'FAIL'}")

    # 3) scenarioQA 실호출(순수 python)
    metrics, err = run_scenario_qa(cfg["qa_path"], jp, "C1", cfg["python_cmd"])
    if metrics is None:
        fails.append(f"scenarioQA 호출/파싱 실패: {err}")
        print(f"  [2] scenarioQA: FAIL ({err})")
    else:
        print(f"  [2] scenarioQA: OK  rtf={metrics.get('real_time_factor')} "
              f"min_ttc={metrics.get('min_ttc_s')} "
              f"frames={metrics.get('n_metric_frames')}")

    # 4) CSV append + 재개(run_idx 연속)
    csvp = os.path.join(tmp, "summary.csv")
    r1 = build_csv_row(next_run_idx(csvp), "C1", "ok", metrics, ex, 480.0,
                       "synth.jsonl")
    append_csv(csvp, r1)
    r2 = build_csv_row(next_run_idx(csvp), "C2", "ok", metrics, ex, 240.0,
                       "synth2.jsonl")
    append_csv(csvp, r2)
    ni = next_run_idx(csvp)
    if not (r1["run_idx"] == 1 and r2["run_idx"] == 2 and ni == 3):
        fails.append(f"재개 run_idx 비연속: {r1['run_idx']},{r2['run_idx']},next={ni}")
    print(f"  [3] CSV append+resume: run_idx {r1['run_idx']}→{r2['run_idx']} "
          f"next={ni}  → {'OK' if ni == 3 else 'FAIL'}")

    # 5) missing/empty JSONL graceful
    ex2 = scan_jsonl_extras(os.path.join(tmp, "nope.jsonl"))
    m2, e2 = run_scenario_qa(cfg["qa_path"], os.path.join(tmp, "nope.jsonl"),
                             "C1", cfg["python_cmd"])
    if m2 is not None or e2 != "jsonl-missing":
        fails.append("missing-jsonl graceful 처리 실패")
    print(f"  [4] missing JSONL graceful: extras={ex2['collisions']!r} "
          f"qa={e2}  → {'OK' if e2 == 'jsonl-missing' else 'FAIL'}")

    # 6) 요약(CV) 산출 경로
    print("  [5] summarize():")
    summarize(csvp)

    print("=" * 60)
    if fails:
        print("  SELF-TEST 결과: FAIL")
        for x in fails:
            print("   - " + x)
        return 1
    print("  SELF-TEST 결과: ALL PASS")
    return 0


# ────────────────────────────────────────────────────────────────────────────
def parse_args(argv=None):
    ap = argparse.ArgumentParser(
        description="무인 24h 드라이런 마라톤 오케스트레이터(동결 빌드 반복).")
    stop = ap.add_argument_group("종료 조건(둘 중 먼저 도달 시 종료)")
    stop.add_argument("--hours", type=float, default=None,
                      help="최대 실행 시간(시간). 미지정+--runs 미지정 시 24.")
    stop.add_argument("--runs", type=int, default=None,
                      help="최대 런 수.")
    ap.add_argument("--scenarios", default="C1,C2",
                    help="교대 순서(쉼표). 예: C1,C2 / C1 / C2,C2,C1")
    ap.add_argument("--repo-root", default=_DEFAULT_REPO,
                    help="CARLA-project-2026-main 루트(기본=자동).")
    ap.add_argument("--out", default=None,
                    help="마스터 CSV(기본=<tools>/dryrun_marathon_summary.csv).")
    ap.add_argument("--jsonl-dir", default=None,
                    help="런별 JSONL 디렉터리(기본=<tools>/marathon_jsonl).")
    ap.add_argument("--qa", default=None,
                    help="scenarioQA.py 경로(기본=<tools>/scenarioQA.py).")
    ap.add_argument("--python", default=None,
                    help="시나리오/QA 실행 인터프리터. 기본 Windows='py -3.10', else sys.executable.")
    ap.add_argument("--per-run-timeout", type=int, default=None,
                    help="런 워치독 타임아웃(초). 기본=시나리오 공칭×2.5 또는 1200.")
    ap.add_argument("--cooldown", type=float, default=5.0,
                    help="런 사이 휴지(초).")
    ap.add_argument("--keep-jsonl", action="store_true",
                    help="집계 후 원본 JSONL 보존(기본 삭제).")
    ap.add_argument("--gzip-jsonl", action="store_true",
                    help="집계 후 JSONL 을 .gz 로 보관(삭제 대신).")
    # CARLA 재시작 훅
    ap.add_argument("--carla-exe", default=None,
                    help="CarlaUE4.exe 경로(워치독 재시작 훅용).")
    ap.add_argument("--carla-args", default="-windowed -ResX=1280 -ResY=720 -nosound -prefernvidia",
                    help="CARLA launch 인자(따옴표 문자열).")
    ap.add_argument("--carla-ready-wait", type=int, default=90,
                    help="CARLA 재launch 후 ready 대기(초).")
    ap.add_argument("--carla-restart-on-timeout", action="store_true",
                    help="런 timeout 시 CARLA 재시작 훅 발동.")
    ap.add_argument("--carla-restart-after", type=int, default=1,
                    help="연속 timeout 몇 회 후 CARLA 재시작(기본 1).")
    ap.add_argument("--self-test", action="store_true",
                    help="CARLA 불필요 로직 자가검증만 수행(Mac).")
    return ap.parse_args(argv)


def build_cfg(args):
    tools_dir = os.path.dirname(_THIS)
    repo = os.path.abspath(args.repo_root)
    qa = args.qa or os.path.join(tools_dir, "scenarioQA.py")
    csv_path = args.out or os.path.join(tools_dir, "dryrun_marathon_summary.csv")
    jsonl_dir = args.jsonl_dir or os.path.join(tools_dir, "marathon_jsonl")
    if args.python:
        python_cmd = args.python.split()
    elif IS_WIN:
        python_cmd = ["py", "-3.10"]
    else:
        python_cmd = [sys.executable]
    return {
        "repo_root": repo, "qa_path": qa, "csv_path": csv_path,
        "jsonl_dir": jsonl_dir, "python_cmd": python_cmd,
        "per_run_timeout": args.per_run_timeout,
        "keep_jsonl": args.keep_jsonl, "gzip_jsonl": args.gzip_jsonl,
        "carla_exe": args.carla_exe,
        "carla_args": args.carla_args.split(),
        "carla_ready_wait": args.carla_ready_wait,
        "carla_restart_on_timeout": args.carla_restart_on_timeout,
        "carla_restart_after": args.carla_restart_after,
        "_consec_hang": 0,
    }


def main(argv=None):
    args = parse_args(argv)
    cfg = build_cfg(args)

    if args.self_test:
        return self_test(cfg)

    # 종료 조건 기본값
    hours = args.hours
    runs = args.runs
    if hours is None and runs is None:
        hours = 24.0

    order = [s.strip().upper() for s in args.scenarios.split(",") if s.strip()]
    for s in order:
        if s not in SCENARIO_MAIN:
            log(f"알 수 없는 시나리오 '{s}' (C1/C2만 허용) → 중단")
            return 2
    os.makedirs(cfg["jsonl_dir"], exist_ok=True)

    start = time.time()
    deadline = start + hours * 3600 if hours else None
    run_idx = next_run_idx(cfg["csv_path"])
    log(f"마라톤 시작: repo={cfg['repo_root']}")
    log(f"  python={cfg['python_cmd']}  순서={order}  "
        f"종료={'%.1fh' % hours if hours else ''}{' / ' if hours and runs else ''}"
        f"{'%d runs' % runs if runs else ''}")
    log(f"  CSV={cfg['csv_path']}  JSONL={cfg['jsonl_dir']}  "
        f"keep_jsonl={cfg['keep_jsonl']}  재개 시작 run_idx={run_idx}")

    done = 0
    oi = 0
    try:
        while True:
            if deadline and time.time() >= deadline:
                log("시간 종료 조건 도달")
                break
            if runs and done >= runs:
                log("런 수 종료 조건 도달")
                break
            scn = order[oi % len(order)]
            oi += 1
            # 워치독 타임아웃: 인자(고정) 우선, 없으면 시나리오 공칭×2.5(최소 600)을
            # 매 런 시나리오별로 산정. cfg 를 매 런 갱신(do_one_run 이 읽음).
            cfg["per_run_timeout"] = (
                args.per_run_timeout if args.per_run_timeout
                else max(600, int(SCENARIO_NOMINAL_S.get(scn, 480) * 2.5)))
            do_one_run(run_idx, scn, cfg)
            run_idx += 1
            done += 1
            time.sleep(max(0.0, args.cooldown))
    except KeyboardInterrupt:
        log("KeyboardInterrupt → 안전 종료(부분 CSV 보존). 재실행 시 이어붙임.")
    finally:
        kill_stray_scenarios(cfg["repo_root"])
        summarize(cfg["csv_path"])
    log(f"마라톤 종료: 이번 세션 {done} 런 누적.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
