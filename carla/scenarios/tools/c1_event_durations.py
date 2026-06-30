"""C1(답답함) 이벤트-구간 지표 산출 — gzip JSONL post-hoc 계산기.

배경(2026-06-29 사용자 결정)
---------------------------
C1 은 '답답함/교착이 끝까지 지속'되는 시나리오라, 제어공학 정착시간 기반 recovery
(속도가 baseline±10% 로 2s 이상 복귀·유지)가 **원래 안 잡힌다(NaN, 버그 아님)**.
→ C1 은 신호정착 대신 **이벤트-구간 길이**로 정량화한다(C2 recovery=yaw 정착은 그대로):

  · recovery     = junction_deadlock_start(C1-4, 교란 onset) → exit_success(C1-9, 해소)
                   = '교착/답답함이 해소까지 지속된 시간'
  · arc_duration = gap_attempt(C1-2, 첫 답답 신호)            → exit_success(C1-9)
                   = '답답함 에피소드 전체 길이'

이 도구는 **마라톤을 건드리지 않고**(dryrun_marathon.py 가 보존한 `*.jsonl.gz`만 읽음)
모든 C1 런에 batch 적용해 보조 CSV + 요약(mean±SD·CV%)을 낸다.

⚠️ 시간축 = **t_sim 만** 사용한다. scenario_event 의 `t` 필드는 일부 런/이벤트에서
   epoch(wall-clock)·일부에서 elapsed 로 **혼재**해 차감하면 깨진다. t_sim 은 일관(sim-time).
   (실시간 rtf≈1.0 이라 구간 길이로서 sim-time = wall-clock 차이와 사실상 동일.)

사용
----
  py -3.10 scenarios\\tools\\c1_event_durations.py                 # marathon_jsonl 전부 batch
  py -3.10 scenarios\\tools\\c1_event_durations.py --glob "run000*C1*.jsonl*"
  py -3.10 scenarios\\tools\\c1_event_durations.py --jsonl <한_파일>
  py -3.10 scenarios\\tools\\c1_event_durations.py --self-test    # CARLA·파일 불요
출력: --out (기본 scenarios\\tools\\c1_event_durations.csv) + stdout 요약.
"""
import argparse
import csv
import glob
import gzip
import json
import math
import os
import statistics
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_JSONL_DIR = os.path.join(_HERE, "marathon_jsonl")
DEFAULT_OUT = os.path.join(_HERE, "c1_event_durations.csv")

# CSV 컬럼(런당 1행)
FIELDS = [
    "run", "status",
    "t_gap_attempt", "t_deadlock", "t_force_merge", "t_abnormal_loop", "t_exit_success",
    "recovery_s",            # C1-4 → C1-9 (교란지속)
    "arc_duration_s",        # C1-2 → C1-9 (에피소드 전체)
    "c18_after_merge_s",     # abnormal_loop − force_merge (≈5s 기대, 타이밍 QA)
    "exit_after_c18_s",      # exit_success − abnormal_loop (C1-8 후 진출 소요)
]


def _open(path):
    return gzip.open(path, "rt", encoding="utf-8", errors="replace") if path.endswith(".gz") \
        else open(path, "rt", encoding="utf-8", errors="replace")


def parse_events(path):
    """scenario_event 들을 (event, t_sim) 리스트로. t_sim 없는 건 None(차감에서 제외)."""
    evs = []
    with _open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                m = json.loads(line)
            except Exception:
                continue
            if m.get("type") == "scenario_event":
                evs.append((m.get("event"), m.get("t_sim")))
    return evs


def _first(evs, name):
    for e, t in evs:
        if e == name and t is not None:
            return t
    return None


def _last(evs, name):
    got = None
    for e, t in evs:
        if e == name and t is not None:
            got = t
    return got


def _sub(a, b):
    return round(a - b, 2) if (a is not None and b is not None) else None


def compute_run(evs, run_name="(events)"):
    """이벤트 리스트 → 지표 dict. 미완(런 진행 중/이벤트 결손)이면 status='incomplete'."""
    t_gap   = _first(evs, "gap_attempt")             # C1-2 (1회차)
    t_dl    = _first(evs, "junction_deadlock_start") # C1-4 (첫 발화)
    t_merge = _first(evs, "force_merge")             # C1-7
    t_c18   = _first(evs, "abnormal_loop")           # C1-8
    t_exit  = _last(evs, "exit_success")             # C1-9 (해소; 중복 시 마지막=실제 진출)

    recovery = _sub(t_exit, t_dl)
    arc      = _sub(t_exit, t_gap)
    status = "ok" if (recovery is not None and arc is not None) else "incomplete"
    return {
        "run": run_name,
        "status": status,
        "t_gap_attempt": t_gap,
        "t_deadlock": t_dl,
        "t_force_merge": t_merge,
        "t_abnormal_loop": t_c18,
        "t_exit_success": t_exit,
        "recovery_s": recovery,
        "arc_duration_s": arc,
        "c18_after_merge_s": _sub(t_c18, t_merge),
        "exit_after_c18_s": _sub(t_exit, t_c18),
    }


def _summary(rows, key):
    vals = [r[key] for r in rows if r["status"] == "ok" and r[key] is not None]
    if not vals:
        return None
    mean = statistics.mean(vals)
    sd = statistics.pstdev(vals) if len(vals) > 1 else 0.0
    cv = (sd / mean * 100.0) if mean else float("nan")
    return {"n": len(vals), "mean": mean, "sd": sd, "cv": cv}


def run_batch(paths, out_path):
    rows = []
    for p in paths:
        try:
            evs = parse_events(p)
        except Exception as e:
            rows.append({**{k: None for k in FIELDS}, "run": os.path.basename(p),
                         "status": f"read_fail:{e}"})
            continue
        rows.append(compute_run(evs, os.path.basename(p)))

    if out_path:
        with open(out_path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k) for k in FIELDS})

    # ── stdout 요약 ──
    print(f"{'run':40} {'status':>11} {'recovery':>9} {'arc_dur':>8} {'c18Δmerge':>9} {'exitΔc18':>9}")
    for r in rows:
        f = lambda v: f"{v:.1f}" if isinstance(v, (int, float)) else "—"
        print(f"{r['run']:40} {str(r['status']):>11} "
              f"{f(r['recovery_s']):>9} {f(r['arc_duration_s']):>8} "
              f"{f(r['c18_after_merge_s']):>9} {f(r['exit_after_c18_s']):>9}")

    ok = [r for r in rows if r["status"] == "ok"]
    print(f"\nC1 런 {len(rows)}개  (ok {len(ok)} / 미완·실패 {len(rows) - len(ok)})")
    for key, label in (("recovery_s", "recovery(C1-4→C1-9, 교란지속)"),
                       ("arc_duration_s", "arc_duration(C1-2→C1-9, 에피소드)"),
                       ("c18_after_merge_s", "c18_after_merge(타이밍 QA, ≈5s 기대)")):
        s = _summary(ok, key)
        if s:
            print(f"  {label:38} mean={s['mean']:.1f}s  sd={s['sd']:.1f}  CV={s['cv']:.1f}%  n={s['n']}")
    if out_path:
        print(f"\n보조 CSV → {out_path}")
    return rows


def self_test():
    print("=== SELF-TEST (파일·CARLA 불요) ===")
    # 합성 이벤트: C1-2=150, C1-4(첫)=222, force_merge=280, abnormal_loop=285, exit=370
    evs = [
        ("drive_start", 5.0), ("junction_arrive", 147.0),
        ("gap_attempt", 150.0), ("gap_attempt", 160.0),          # 첫 발화 150
        ("enter_success", 182.0), ("to_inner", 192.0),
        ("junction_deadlock_start", 222.0), ("junction_deadlock_start", 248.0),  # 첫 발화 222
        ("stuck_stop", 268.0), ("lane_change", 268.0),
        ("force_merge", 280.0), ("abnormal_loop", 285.0),
        ("exit_success", 370.0), ("cleared", 365.0),
    ]
    r = compute_run(evs, "synthetic")
    exp = {"recovery_s": 148.0, "arc_duration_s": 220.0,
           "c18_after_merge_s": 5.0, "exit_after_c18_s": 85.0, "status": "ok"}
    ok = all(abs(r[k] - v) < 1e-6 if isinstance(v, float) else r[k] == v
             for k, v in exp.items())
    for k, v in exp.items():
        print(f"  {k:20} got={r[k]}  expect={v}")
    # 미완(이벤트 결손) → incomplete
    r2 = compute_run([("gap_attempt", 150.0), ("junction_deadlock_start", 222.0)], "no_exit")
    ok2 = r2["status"] == "incomplete" and r2["recovery_s"] is None
    print(f"  incomplete 처리: status={r2['status']} recovery={r2['recovery_s']}")
    print("SELF-TEST:", "ALL PASS" if (ok and ok2) else "FAIL")
    return 0 if (ok and ok2) else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="C1 이벤트-구간 지표(recovery/arc_duration) post-hoc 산출")
    ap.add_argument("--jsonl", help="단일 JSONL(.jsonl/.jsonl.gz) 파일")
    ap.add_argument("--jsonl-dir", default=DEFAULT_JSONL_DIR, help="JSONL 디렉터리(기본 marathon_jsonl)")
    ap.add_argument("--glob", default="*C1*.jsonl*", help="디렉터리 내 매칭 패턴")
    ap.add_argument("--out", default=DEFAULT_OUT, help="보조 CSV 출력 경로('' 면 미출력)")
    ap.add_argument("--self-test", action="store_true", help="CARLA·파일 불요 로직 검증")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()

    if args.jsonl:
        paths = [args.jsonl]
    else:
        paths = sorted(glob.glob(os.path.join(args.jsonl_dir, args.glob)))
    if not paths:
        print(f"매칭 JSONL 없음: {args.jsonl or os.path.join(args.jsonl_dir, args.glob)}")
        return 1

    run_batch(paths, args.out or None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
