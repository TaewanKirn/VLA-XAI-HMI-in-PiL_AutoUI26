# VLA-XAI-HMI-in-PiL

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21068534.svg)](https://doi.org/10.5281/zenodo.21068534)

Code, stimuli, and testbed for the AutoUI '26 Student Research Track paper on
**explaining vehicle functional-insufficiency (SOTIF FI/OI) to L5 passengers**:
a VLA-grounded situation-awareness (SA) explanation HMI, delivered in two
modalities (visual / voice), evaluated on a **Passenger-in-the-Loop (PiL)**
CARLA + 6-DOF testbed.

> Replication artifact for: *Student Research Track: Letting the Automated Vehicle Explain
> Its Own Errors: A Simulator Testbed for Passenger-Facing Explanation HMIs in SOTIF Error
> Situations*, AutomotiveUI Adjunct '26.
> **Paper DOI: [10.1145/3828158.3834805](https://doi.org/10.1145/3828158.3834805)** (CC BY 4.0).
> Authors: Taewan Kim, Soeun Park, Eunchae Song, Yoonseo Cho, Chaeyeon Kim, Nayoung Kim,
> Jongwon Choe, Yunyoung Choi, Seojin Lee, Minchae Kim, Dokshin Lim (Hongik University).
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
stimuli/               SA explanation stimulus pool — explanation_script.md = full EN+KO table
data/                  Dry-run raw telemetry (210 runs) + QA metrics CSVs
```

## The explanation stimuli

Table 1 of the paper prints only the two FI back-inference rows. The **complete stimulus
pool** — every SA sentence for both scenarios, in English and Korean, with the triggering
CARLA event per phase — is
**[`stimuli/explanation_script.md`](stimuli/explanation_script.md)**, also provided as a
workbook: **[`stimuli/explanation_script.xlsx`](stimuli/explanation_script.xlsx)**.

## Paper → artifact map

| Paper element | Where |
|---------------|-------|
| C1 scenario (frustration) | `carla/scenarios/frustration/` |
| C2 scenario (anxiety) | `carla/scenarios/anxiety/{Cutoff,Puddle}/` |
| 6-DOF motion-cueing tuning | `carla/data-server/processing/transforms_*.py`, `filters_*.py` |
| Scenario QA — 6 metrics | `carla/scenarios/tools/scenarioQA.py` (+ `scenarioQAreport.md`) |
| Visual / voice SA-explanation HMI | `hmi-visual/`, `hmi-voice/` |
| Table 1 — VLA reasoning → SA explanation | `stimuli/explanation_script.md` (full set; the paper shows 2 rows) |
| Stimulus strings as built | `hmi-visual/src/App.jsx` (`SEQUENCES`), `hmi-voice/src/data/drivePhases.js` |
| Dry-run results (§3) | `data/C1/`, `data/C2/` telemetry + `data/*.csv` metrics |

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

All results reported in the paper come from a **human-free dry run** (no human subjects).
The unattended marathon ran 2026-06-29 → 30 and its raw telemetry and derived metrics are
deposited in [`data/`](data/README.md): 210 gzipped JSONL session logs plus the three metrics
CSVs, with the run-selection rule that yields the paper's N = 100 (C1) and N = 89 (C2).

Human-subject data from the planned confirmatory study is **not** part of this release and
is governed by institutional ethics approval.

## License

MIT — see [LICENSE](LICENSE).

## Citation

```bibtex
@inproceedings{kim2026letting,
  title     = {Student Research Track: Letting the Automated Vehicle Explain Its Own Errors: A Simulator Testbed for Passenger-Facing Explanation HMIs in SOTIF Error Situations},
  author    = {Kim, Taewan and Park, Soeun and Song, Eunchae and Cho, Yoonseo and Kim, Chaeyeon and Kim, Nayoung and Choe, Jongwon and Choi, Yunyoung and Lee, Seojin and Kim, Minchae and Lim, Dokshin},
  booktitle = {18th International Conference on Automotive User Interfaces and Interactive Vehicular Applications (AutomotiveUI Adjunct '26)},
  year      = {2026},
  address   = {Gothenburg, Sweden},
  publisher = {ACM},
  doi       = {10.1145/3828158.3834805},
  isbn      = {979-8-4007-2815-0}
}
```
