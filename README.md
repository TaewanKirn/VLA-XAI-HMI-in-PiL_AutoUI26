# VLA-XAI-HMI-in-PiL

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21068534.svg)](https://doi.org/10.5281/zenodo.21068534)

Code, stimuli, and testbed for the AutoUI '26 Student Research Track paper on
**explaining vehicle functional-insufficiency (SOTIF FI/OI) to L5 passengers**:
a VLA-grounded situation-awareness (SA) explanation HMI, delivered in two
modalities (visual / voice), evaluated on a **Passenger-in-the-Loop (PiL)**
CARLA + 6-DOF testbed.

> Replication artifact for: *VLA-Grounded XAI HMI Design: A Passenger-in-the-Loop Testbed for SOTIF Error Situations in L5 Automated Vehicles*, AutoUI '26 (Student
> Research Track). Authors: Taewan Kim, Eunchae Song, Soeun Park, Yoonseo Cho,
> Chae Yeon Kim, Dokshin Lim (Hongik University).
> Archived on Zenodo: [10.5281/zenodo.21068534](https://doi.org/10.5281/zenodo.21068534).

## Repository layout

```
carla/                 CARLA 0.9.15 + 6-DOF simulator (Python)
  scenarios/
    frustration/       C1 — roundabout deadlock (frustration)
    anxiety/
      Cutoff/  Puddle/  C2 — cut-off / puddle-slip (anxiety)
    core/  modules/  traffic.py  perf.py  launch_*.py   shared scenario code
    tools/             scenarioQA.py (6 metrics) + dry-run marathon harness
  data-server/
    processing/        6-DOF motion cueing — transforms_{A,B}.py, filters_{A,B}.py (tuning values)
    collector/  sender/  db/   telemetry capture, WebSocket/UDP, JSONL logging
  map_exports/         HD-map assets (Town03 / Town04) for the live map renderer
  requirements.txt
hmi-visual/            Visual HMI (React + Vite, WebSocket bridge, live map)
hmi-voice/             Voice HMI (React + Vite, Google STT/TTS, Gemini small-talk)
stimuli/               SA explanation stimulus pool (canonical spec)
data/                  Dry-run raw telemetry + QA metrics (pending marathon)
```

## Paper → artifact map

| Paper element | Where |
|---------------|-------|
| C1 scenario (frustration) | `carla/scenarios/frustration/` |
| C2 scenario (anxiety) | `carla/scenarios/anxiety/{Cutoff,Puddle}/` |
| 6-DOF motion-cueing tuning | `carla/data-server/processing/transforms_*.py`, `filters_*.py` |
| Scenario QA — 6 metrics | `carla/scenarios/tools/scenarioQA.py` (+ `scenarioQAreport.md`) |
| Visual / voice SA-explanation HMI | `hmi-visual/`, `hmi-voice/` |
| Stimulus pool (same SA text, both modalities) | `stimuli/` + `*/src/data/scenarios.js` |
| Dry-run results (§3) | `data/` (pending 24-h marathon) |

## Setup

### CARLA + 6-DOF (Windows)

Requires **CARLA 0.9.15** and **Python 3.10**.

```bash
cd carla
pip install -r requirements.txt
# Start CARLA 0.9.15, then launch a scenario, e.g. C1:
python scenarios/frustration/main.py
```

The 6-DOF motion-cueing pipeline (`data-server/processing/`) streams body motion
to a MotionHouse platform over UDP; the A/B variants are selected by the
`SCENARIO` dispatcher. Scenario events are published over WebSocket (port 8766)
and logged to JSONL for QA.

### HMI (visual and voice)

Each HMI is a Vite/React app. **API keys are not included** — copy the example
env file and fill in your own keys:

```bash
cd hmi-visual        # or hmi-voice
cp .env.example .env.local      # then edit .env.local with your keys
npm install
npm run dev -- --host           # serve over LAN http (ws:// requires non-HTTPS)
```

Required keys (voice HMI): Google Cloud Speech-to-Text, Google Gemini. The CARLA
host is injected at runtime via `?carla=<IP>` URL query, `localStorage`, or env —
no rebuild needed when the simulator IP changes. See each HMI's `.env.example`
and `README.md` for details.

> **Never commit real keys.** `.env.local` / `.env` are git-ignored.

### Scenario QA (6 metrics)

```bash
cd carla
python scenarios/tools/scenarioQA.py <session>.jsonl
```

Produces min TTC, max jerk, max yaw-rate / lateral accel, brake-response delay,
overshoot/recovery, and lane deviation.

## Data availability

All results reported in the paper come from a **human-free dry run** (no human
subjects). The underlying raw telemetry and QA metrics will be deposited in
`data/` and archived on Zenodo once the 24-hour marathon is run (see
`data/README.md`). Human-subject data from the confirmatory study (OSF-preregistered)
is **not** part of this release and is governed by institutional ethics approval.

## License

MIT — see [LICENSE](LICENSE).

## Citation

```bibtex
@inproceedings{kim2026vlaxai,
  title     = {VLA-Grounded XAI HMI Design: A Passenger-in-the-Loop Testbed for SOTIF Error Situations in L5 Automated Vehicles},
  author    = {Kim, Taewan and Song, Eunchae and Park, Soeun and Cho, Yoonseo and Kim, Chae Yeon and Lim, Dokshin},
  booktitle = {Adjunct Proceedings of the 18th International Conference on Automotive User Interfaces and Interactive Vehicular Applications (AutomotiveUI '26)},
  year      = {2026},
  note      = {Student Research Track}
}
```
