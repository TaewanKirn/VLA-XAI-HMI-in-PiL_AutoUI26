# Dry-run raw data

This folder holds the **machine-generated, human-free** dry-run telemetry that
backs the quantitative results reported in the paper (§3). No human-subject data
is or will be placed here.

## Status

> ✅ **Released (2026-06-30).** The 24-hour unmanned dry-run marathon was executed
> on the Windows/CARLA + 6-DOF testbed. Raw outputs and per-run QA metrics are
> deposited here; the archived Zenodo version is updated with this release.

## Contents

- `C1/`, `C2/` — per-run CARLA session telemetry, gzipped NDJSON
  (`runNNNN_{C1|C2}_YYYYMMDD_HHMMSS.jsonl.gz`). **C1 = 107, C2 = 103 runs.**
  One record per line: `world_metric`/`motion` frames (speed, position, accel,
  yaw-rate, 6-DOF axes), `scenario_event` markers (incl. `collision`),
  `ws_latency` (HMI RTT, early runs only).
  ⚠️ Use **`t_sim`** (sim-time) for any time-derivative metric — the `t` field
  mixes epoch/elapsed across records.
- `marathon_summary.csv` — collection log, one row per run (537 attempts; status
  column distinguishes `ok` from failed runs). Analysis uses `status == ok`
  (C1 100 / C2 100).
- `c1_event_durations.csv` — C1 event-interval metrics
  (`recovery` = deadlock→exit duration, `arc_duration` = first-gap→exit).
- `c2_truncated_metrics.csv` — C2 hazard metrics recomputed with each run
  **truncated at its first collision** (early-crash <90 s runs excluded).

## Key results

- **C1 (frustration, Town03) — deterministic.** 100 runs, 0 collisions, all
  completed. The 6 metrics have **CV ≈ 0 %** (fixed seed `SEED = 2026`):
  e.g. min-TTC 1.205 s, max-yaw 1.965 rad/s, max-jerk 49.9 m/s³.
  recovery 150.7 s / arc 223.6 s (CV < 2 %). A controlled, repeatable stimulus.
- **C2 (anxiety / aquaplaning, Town04) — stochastic.** Events fire at 30/60/90 s.
  100 runs; ~19 % end in an uncontrolled crash (truncated at first collision:
  92/103 analysable, 11 excluded for an early <90 s crash). Even after truncation
  the hazard metrics (yaw-rate, TTC, recovery) keep a high CV — this is the
  **intrinsic non-determinism of the PhysX water-friction (aquaplaning) solver**,
  not noise; C2 is characterised by a distribution (mean ± SD over 100 runs).

## How it is produced

Build frozen, `SEED = 2026`, run `dryrun_marathon.py` on the Windows/CARLA PC
(see [`../carla/scenarios/tools/DRYRUN_MARATHON_WINDOWS.md`](../carla/scenarios/tools/DRYRUN_MARATHON_WINDOWS.md)).
Metrics re-derived from the JSONL with
[`../carla/scenarios/tools/scenarioQA.py`](../carla/scenarios/tools/scenarioQA.py)
(6 metrics), `c1_event_durations.py` (C1 intervals) and
`c2_truncated_metrics.py` (C2 first-collision truncation).
