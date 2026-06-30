"""C2(불안/수막) 위험지표 — 첫-충돌 truncate 재계산기 (post-hoc).

배경(2026-06-30 결정)
---------------------
무인 C2 는 수막 후 운전자 보정이 없어 후반에 통제상실→크래시하는 런이 일부 있다.
런 전체로 scenarioQA 를 돌리면 그 크래시(130km/h 충돌)가 min_TTC·yaw·recovery 를
오염시켜 CV 가 부풀려진다. → **런별 '첫 충돌 시점 이전'으로 잘라** 위험-반응만 본다.

규칙
- 첫 충돌 t_sim 을 찾는다(collision 이벤트).
- 첫 충돌 < 90s(마지막 수막이벤트=90s): **제외**(이벤트 자체가 크래시로 오염).
- 첫 충돌 ≥ 90s: 첫 충돌 t_sim 미만 프레임/이벤트만 남겨 **truncate** 후 재계산.
- 충돌 없음: 전체 그대로(clean).
포함(clean+truncated) 런으로 6지표 mean±SD·CV 산출 + 크래시발생률 별도 보고.

⚠️ 시간축=t_sim(일관). scenarioQA.compute_metrics 를 직접 import 해 truncate 한 rows 로 호출.

사용
  py -3.10 scenarios\\tools\\c2_truncated_metrics.py            # marathon_jsonl 의 *C2*.gz 전부
  py -3.10 scenarios\\tools\\c2_truncated_metrics.py --early-thr 90 --out <csv>
  py -3.10 scenarios\\tools\\c2_truncated_metrics.py --self-test
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
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import scenarioQA  # 같은 폴더

DEFAULT_JSONL_DIR = os.path.join(_HERE, "marathon_jsonl")
DEFAULT_OUT = os.path.join(_HERE, "c2_truncated_metrics.csv")
EARLY_CRASH_THR = 90.0   # 마지막 수막 이벤트(90s) 전 크래시 = 제외

# (scenarioQA 결과 key, CSV/요약 라벨)
METRICS = [
    ("min_ttc_s", "min_ttc"),
    ("max_jerk_m_s3", "max_jerk"),
    ("max_yaw_rate_rad_s", "max_yaw"),
    ("max_lat_accel_m_s2", "max_lat_accel"),
    ("brake_response_delay_s", "brake_delay"),
    ("recovery_time_s", "recovery"),
    ("lane_departure_m", "lane_dev"),
    ("overshoot_kmh", "overshoot"),
    ("real_time_factor", "rtf"),
]


def _isnum(v):
    return isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v))


def load_rows(path):
    opener = gzip.open if path.endswith(".gz") else open
    rows = []
    with opener(path, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                pass
    return rows


def first_collision_tsim(rows):
    fc = None
    for m in rows:
        if m.get("type") == "scenario_event" and m.get("event") == "collision":
            t = m.get("t_sim")
            if t is not None and (fc is None or t < fc):
                fc = t
    return fc


def truncate_rows(rows, cutoff):
    """cutoff(t_sim) 미만 레코드만. t_sim 없는 레코드(메타)는 보존. cutoff=None → 전체."""
    if cutoff is None:
        return rows
    out = []
    for m in rows:
        t = m.get("t_sim")
        if t is None or t < cutoff:
            out.append(m)
    return out


def analyze_run(path, early_thr):
    rows = load_rows(path)
    fc = first_collision_tsim(rows)
    name = os.path.basename(path)
    if fc is not None and fc < early_thr:
        return {"run": name, "status": "excluded_early_crash", "first_collision_s": round(fc, 2)}
    cutoff = fc  # None(무충돌) 또는 ≥thr
    trows = truncate_rows(rows, cutoff)
    scenarioQA.WARN.clear()                      # 누적 경고 리셋
    result, _ = scenarioQA.compute_metrics(trows, "C2")
    row = {
        "run": name,
        "status": "truncated" if fc is not None else "clean",
        "first_collision_s": (round(fc, 2) if fc is not None else ""),
        "n_metric_frames": result.get("n_metric_frames"),
    }
    for k, lab in METRICS:
        v = result.get(k)
        row[lab] = (round(v, 4) if _isnum(v) else "")
    return row


def summarize(rows):
    incl = [r for r in rows if r["status"] in ("clean", "truncated")]
    excl = [r for r in rows if r["status"] == "excluded_early_crash"]
    n = len(rows)
    print(f"\nC2 런 {n}개  →  포함 {len(incl)} (clean {sum(1 for r in incl if r['status']=='clean')} "
          f"+ truncated {sum(1 for r in incl if r['status']=='truncated')})  ·  제외(조기크래시<{int(EARLY_CRASH_THR)}s) {len(excl)}")
    coll = sum(1 for r in rows if r.get("first_collision_s") not in ("", None))
    print(f"크래시 발생률: {coll}/{n} ({100.0*coll/n:.0f}%)  (truncate로 위험구간만 분석)")
    print("-" * 64)
    print(f"{'지표':<14} {'n':>4}  {'mean':>10}  {'SD':>9}  {'CV%':>7}")
    for k, lab in METRICS:
        vals = [r[lab] for r in incl if _isnum(r.get(lab))]
        if not vals:
            print(f"{lab:<14} {'0':>4}  {'(전부 결측)':>10}")
            continue
        mean = statistics.mean(vals)
        sd = statistics.pstdev(vals) if len(vals) > 1 else 0.0
        cv = (sd / mean * 100.0) if mean else float("nan")
        print(f"{lab:<14} {len(vals):>4}  {mean:>10.4g}  {sd:>9.4g}  {cv:>7.1f}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="C2 첫-충돌 truncate 위험지표 재계산")
    ap.add_argument("--jsonl-dir", default=DEFAULT_JSONL_DIR)
    ap.add_argument("--glob", default="*C2*.jsonl*")
    ap.add_argument("--out", default=DEFAULT_OUT, help="런별 CSV('' 면 미출력)")
    ap.add_argument("--early-thr", type=float, default=EARLY_CRASH_THR,
                    help=f"이 t_sim 전 크래시는 제외(기본 {EARLY_CRASH_THR})")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return _self_test()

    paths = sorted(glob.glob(os.path.join(args.jsonl_dir, args.glob)))
    if not paths:
        print(f"매칭 JSONL 없음: {os.path.join(args.jsonl_dir, args.glob)}")
        return 1

    rows = []
    for p in paths:
        try:
            rows.append(analyze_run(p, args.early_thr))
        except Exception as e:
            rows.append({"run": os.path.basename(p), "status": f"error:{e}"})

    fields = ["run", "status", "first_collision_s", "n_metric_frames"] + [lab for _, lab in METRICS]
    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for r in rows:
                w.writerow({k: r.get(k, "") for k in fields})
    summarize(rows)
    if args.out:
        print(f"\n런별 CSV → {args.out}")
    return 0


def _self_test():
    print("=== SELF-TEST: truncate/첫충돌 로직 (compute_metrics 미호출) ===")
    rows = [
        {"type": "world_metric", "t_sim": 10.0, "speed_kmh": 80},
        {"type": "scenario_event", "event": "puddle_enter", "t_sim": 30.0},
        {"type": "world_metric", "t_sim": 100.0, "speed_kmh": 120},
        {"type": "scenario_event", "event": "collision", "t_sim": 122.0},
        {"type": "world_metric", "t_sim": 123.0, "speed_kmh": 60},
        {"type": "meta", "t_sim": None},
    ]
    fc = first_collision_tsim(rows)
    tr = truncate_rows(rows, fc)
    ok1 = abs(fc - 122.0) < 1e-9
    # 잘린 뒤: 123.0 프레임·collision 제외, 10/30/100 + meta 보존 = 4개
    ok2 = len(tr) == 4 and all((m.get("t_sim") is None or m["t_sim"] < 122.0) for m in tr)
    # 조기크래시 분류
    early = [{"type": "scenario_event", "event": "collision", "t_sim": 52.0}]
    fc_e = first_collision_tsim(early)
    ok3 = fc_e is not None and fc_e < EARLY_CRASH_THR
    print(f"  첫충돌={fc} (기대 122.0)  truncate후 {len(tr)}개(기대 4)  조기크래시판정={ok3}")
    print("SELF-TEST:", "ALL PASS" if (ok1 and ok2 and ok3) else "FAIL")
    return 0 if (ok1 and ok2 and ok3) else 1


if __name__ == "__main__":
    sys.exit(main())
