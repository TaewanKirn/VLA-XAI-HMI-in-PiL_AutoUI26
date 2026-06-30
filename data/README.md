# Dry-run raw data

This folder holds the **machine-generated, human-free** dry-run telemetry that
backs the quantitative results reported in the paper (§3). No human-subject data
is or will be placed here.

## Status

> ⏳ **Pending.** The 24-hour dry-run marathon has not yet been executed at the
> time of release. Once it runs, the raw outputs will be deposited here and the
> archived Zenodo version updated.

## What will be here

- `*.jsonl` — per-session CARLA telemetry logs (frame schema: speed, position,
  accel, yaw-rate, scenario-event markers).
- `*.csv` — per-run scenario QA metrics produced by
  [`../carla/scenarios/tools/scenarioQA.py`](../carla/scenarios/tools/scenarioQA.py):
  min TTC, max jerk, max yaw-rate / lateral accel, brake-response delay,
  overshoot/recovery, lane deviation (the 6 metrics).
- `marathon_summary.csv` — aggregated means and coefficients of variation (CV)
  across runs (the determinism check, fixed seed `SEED = 2026`).

## How it is produced

See [`../carla/scenarios/tools/DRYRUN_MARATHON_WINDOWS.md`](../carla/scenarios/tools/DRYRUN_MARATHON_WINDOWS.md).
Briefly: freeze the build, run `dryrun_marathon.py` on the Windows/CARLA PC, then
re-derive the 6 metrics from the JSONL with `scenarioQA.py`.
