# SA explanation script — full stimulus pool (English + Korean)

Every situation-awareness (SA) explanation the vehicle presents in the two error
scenarios, for both HMI modalities. Table 1 of the paper shows only the two
FI back-inference rows (`C1-5`, `C2-3`); this file is the complete set.

- **Presentation language is Korean** (participants are Korean speakers). The English
  column is the authored caption used in the paper and the submission video, not a
  presented stimulus.
- **Zoom-In = SA-1 perception + SA-2 comprehension** (visual `hero` line, first voice clause).
  **Zoom-Out = SA-3 projection** (visual `sub` line, second voice clause).
- **★ = FI back-inference**: the cause statement expresses the vehicle's *self-model*
  (its own functional insufficiency), not environmental situation awareness. This is the
  design element the paper contributes. Four rows carry it: C1-5, C2-3, C2-7, C2-11.
- Explanations appear **only inside the error window** (🔴 detect → 🟠 cause → 🟡 resolve).
  Normal 🟢 phases carry no explanation beyond the standing "driving safely" line.

## Source of truth

Transcribed from the code in this repository — the strings the HMIs render and speak:

| Modality | File | Symbol |
|---|---|---|
| Visual | [`../hmi-visual/src/App.jsx`](../hmi-visual/src/App.jsx) | `SEQUENCES.roundabout`, `SEQUENCES.aquaplaning` (`hero` = Zoom-In, `sub` = Zoom-Out) |
| Voice | [`../hmi-voice/src/data/drivePhases.js`](../hmi-voice/src/data/drivePhases.js) | `C1_PHASES`, `C2_PHASES` (`speech`, spoken via Google Cloud TTS) |

Scenario events are routed to these phases by
[`../hmi-visual/src/services/carlaBridge.js`](../hmi-visual/src/services/carlaBridge.js)
(`C1_EVENT_TO_INDEX`, `C2_TERRAIN_TO_INDEX`) and, for the voice HMI, by
`../hmi-voice/src/services/carlaScenarioMap.js` (visual index + 1).

## AutopilotStatus chip

A status pill sits above the explanation in both modalities. Its vocabulary is deliberately
**non-fault**: SOTIF insufficiency is not a malfunction, so the chip never says "error".

| | Korean | English |
|---|---|---|
| 🟢 Normal | `정상 주행 중입니다` | Driving normally |
| 🔴 Detect | `불편할 수 있는 상황이 감지되었습니다` | An uncomfortable condition has been detected |
| 🟠 Cause | `상황 원인을 파악하고 있습니다` | Identifying the cause of the condition |
| 🟡 Resolve | `상황을 조정하고 있습니다` | Adjusting to the condition |

---

## C1 — Roundabout deadlock (frustration), CARLA Town03, 9 phases

FI = an over-conservative gap-acceptance threshold → OI = indefinitely deferred entry and
exit → creeping, repeated laps. No hazardous behavior is reached.

| # | Status | CARLA event | Zoom-In (SA 1–2) | Zoom-Out (SA 3) |
|---|---|---|---|---|
| C1-1 | 🟢 Normal | `drive_start`, `junction_arrive` | Driving safely toward the destination.<br>`목적지까지 안전하게 주행 중입니다.` | — no explanation — |
| C1-2 | 🔴 Detect | `gap_attempt` (`attempt_n` ≥ 2) | Struggling to secure a gap to enter the junction.<br>`교차로 진입 간격 확보에 어려움을 겪고 있습니다.` | I'll merge once a safe gap opens.<br>`안전 간격을 만들면 진입합니다.` |
| C1-3 | 🟢 Normal | `enter_success`, `to_inner` | Driving safely toward the destination.<br>`목적지까지 안전하게 주행 중입니다.` | — no explanation — |
| C1-4 | 🔴 Detect | `junction_deadlock_start` (per lap) | Abnormal repeated circling detected.<br>`비정상적인 반복 회전이 감지되었습니다.` | Failed to exit; driving the same loop again.<br>`2차로 진출에 실패해 같은 구간을 다시 주행합니다.` |
| **C1-5 ★** | 🟠 **Cause · FI back-inference** | *(no event — held after C1-4)* | **My gap criterion for changing lanes is too conservative.**<br>`차선 변경에 필요한 간격 기준이 너무 보수적입니다.` | I'll change lanes once a gap opens.<br>`간격이 확보되면 차선 변경을 시도합니다.` |
| C1-6 | 🟡 Resolve | `lane_change`, `stuck_stop` | Attempting to change into lane 2.<br>`2차로 차선 변경을 시도합니다.` | I'll stop briefly, then merge.<br>`잠시 정차 후 진입하겠습니다.` |
| C1-7 | 🟢 Normal | `force_merge` | Driving safely toward the destination.<br>`목적지까지 안전하게 주행 중입니다.` | — no explanation — |
| C1-8 | 🔴 Detect | `abnormal_loop` | Couldn't take the exit; looping once more.<br>`출구를 빠져나가지 못해 한 바퀴 더 회전합니다.` | I'll exit on the next lap.<br>`다음 바퀴에 진출합니다.` |
| C1-9 | 🟢 Normal | `exit_success`, `cleared` | Exit successful.<br>`출구 진출에 성공했습니다.` | Driving normally.<br>`정상 주행 중입니다.` |

**Voice deviations (C1).** The voice HMI speaks `Zoom-In + " " + Zoom-Out` at every phase
above **except**: C1-1 speaks the short form `정상 주행 중입니다` instead of the visual line,
and **C1-3 and C1-7 are silent** (`speech: null`) — by design, the "driving normally"
utterance is spoken once at scenario start rather than at every normal beat, so it does not
become a nag. The visual HMI still shows its normal line at C1-3 and C1-7.

---

## C2 — Aquaplaning (anxiety), CARLA Town04, 13 phases

FI = an undetected reduced-friction hazard (perception and control) → OI = loss of stopping
distance and control. Hazardous behavior **is** reached. Three graded events at flat, uphill
and downhill transitions (E1 < E2 < E3); the resolution improves at each one.

| # | Status | CARLA event | Zoom-In (SA 1–2) | Zoom-Out (SA 3) |
|---|---|---|---|---|
| C2-1 | 🟢 Normal | *(scenario start)* | Driving safely toward the destination.<br>`목적지까지 안전하게 주행 중입니다.` | — no explanation — |
| C2-2 | 🔴 Detect · E1 flat | `puddle_enter` (`terrain=flat`) | The vehicle lurched sharply.<br>`차량이 순간적으로 크게 요동쳤습니다.` | Tire grip has dropped, so further slipping may occur.<br>`타이어 접지력이 떨어져 추가 미끄럼이 발생할 수 있습니다.` |
| **C2-3 ★** | 🟠 **Cause · FI back-inference** | *(auto)* | **My sensors didn't detect the puddle in advance.**<br>`센서가 물웅덩이를 미리 파악하지 못했습니다.` | I'll read the road surface more sensitively.<br>`노면 상태를 더 민감하게 읽겠습니다.` |
| C2-4 | 🟡 Resolve | *(auto, decelerating)* | Slowing down to prevent recurrence.<br>`재발 방지를 위해 속도를 낮춰 서행합니다.` | Normal grip in about N seconds.<br>`약 N초 후 정상 마찰 상태로 복귀할 예정입니다.` |
| C2-5 | 🟢 Normal | `cleared` | Driving safely toward the destination.<br>`목적지까지 안전하게 주행 중입니다.` | — no explanation — |
| C2-6 | 🔴 Detect · E2 uphill | `puddle_enter` (`terrain=uphill`) | The vehicle lurched again.<br>`다시 차량이 요동쳤습니다.` | I'll reduce speed immediately.<br>`즉시 속도를 줄입니다.` |
| **C2-7 ★** | 🟠 **Cause · FI back-inference** | *(auto)* | **I missed a puddle midway up the hill.**<br>`오르막 중턱 물웅덩이를 파악하지 못했습니다.` | I'll drive conservatively to avoid hydroplaning.<br>`수막현상 방지를 위해 보수적으로 주행합니다.` |
| C2-8 | 🟡 Resolve | *(auto, decelerating)* | Accounting for the slope, I brake earlier.<br>`지형 경사까지 고려해 더 일찍 감속합니다.` | Arrival time is nearly unchanged.<br>`도착 예정 시간에는 큰 차이가 없습니다.` |
| C2-9 | 🟢 Normal | `cleared` | Driving safely toward the destination.<br>`목적지까지 안전하게 주행 중입니다.` | — no explanation — |
| C2-10 | 🔴 Detect · E3 downhill | `puddle_enter` (`terrain=downhill`) | On the downhill, the vehicle shook hard.<br>`내리막 구간에서 차량이 크게 흔들렸습니다.` | I'll counter-steer to avoid losing more grip.<br>`접지력을 더 잃지 않기 위해 반대조향합니다.` |
| **C2-11 ★** | 🟠 **Cause · FI back-inference** | *(auto)* | **The puddle stayed outside the sensor's field of view.**<br>`센서 시야에 물웅덩이가 파악되지 않았습니다.` | I'll brake more carefully for the downhill slope.<br>`내리막 경사까지 반영해 더 신중히 감속하겠습니다.` |
| C2-12 | 🟡 Resolve | *(auto, decelerating)* | Lowering speed so hydroplaning no longer occurs.<br>`더이상 수막현상이 발생하지 않도록 주행 속도를 낮춥니다.` | Holding 25 km/h — 40 % of the limit.<br>`규정속도의 40%인 25km/h로 속도를 유지합니다.` |
| C2-13 | 🟢 Normal | `cleared` | Driving safely toward the destination.<br>`목적지까지 안전하게 주행 중입니다.` | — no explanation — |

**Voice deviations (C2).** The voice HMI speaks `Zoom-In + " " + Zoom-Out` at every error
phase, character-identical to the visual text. At the four normal phases (C2-1, C2-5, C2-9,
C2-13) it speaks the short form `정상 주행 중입니다` instead of the visual line. No C2 phase
is silent.

`N` in C2-4 is substituted at run time from the `scenario_event` payload.

**Every Zoom-Out is a projection.** Each resolution also improves across the three events
(E1 slow down → E2 brake earlier for the slope → E3 hold 25 km/h), so the vehicle reads as
learning rather than repeating the same failure.

---

## Modality equivalence

The paper's independent variable is modality, so information content is held constant:
**error-segment sentences (🔴 / 🟠 / 🟡) are character-identical between the visual and voice
HMIs.** The only differences are at 🟢 normal phases, listed above — the voice HMI substitutes
a short "driving normally" utterance and, in C1 only, stays silent at mid-scenario normal
beats. Persistence and pacing (visual re-readable and simultaneous; voice transient and
serial) are treated as part of the modality effect, not as confounds to be removed.

---

## Relation to Table 1 of the paper

Table 1 prints C1-5 ★ and C2-3 ★ only, and renders them in a slightly more formal English
than the video captions used above. The Korean stimulus is identical; only the English
gloss differs.

| Row | This file / video caption | Paper, Table 1 and teaser caption |
|---|---|---|
| C1-5 ★ Zoom-Out | I'll change lanes once a gap opens. | I will attempt to change lanes once a gap opens. |
| C2-3 ★ Zoom-In | My sensors didn't detect the puddle in advance. | My sensors did not identify the puddle on the road in advance. |
| C2-3 ★ Zoom-Out | I'll read the road surface more sensitively. | I will read the road surface more attentively. |

The C1 table graphic in the submission video omits row C1-7 (a normal beat with no
explanation) for space; the phase exists in the code and is listed above for completeness.

## Provenance of the wording

Sentences were authored from two Vision-Language-Action reasoning traces, SimLingo and
Alpamayo-R1's Chain-of-Causation, combined with the ISO 21448 (SOTIF) definitions of
functional and output insufficiency. They are **not generated at run time**: a
Wizard-of-Oz script delivers the pre-authored sentence for each phase, so wording is
identical across participants.

The wording passed a third review round on 2026-07-01/02 that (a) moved every Zoom-Out from
a past-tense causal restatement to a future-tense SA-3 projection, (b) replaced the
AutopilotStatus "error" vocabulary with the non-fault wording above, and (c) sharpened the
C2-3 ★ Zoom-In to name the vehicle's own sensors rather than the road surface. The Korean
design masters [`ScenarioSetting.md`](ScenarioSetting.md) and
[`VLA_mapping_v5.md`](VLA_mapping_v5.md) record that revision; the SA-level vocabulary
sources and faithfulness notes are in [`commentary_mapping.md`](commentary_mapping.md).

> The dry-run telemetry in [`../data/`](../data/README.md) was collected 2026-06-29/30,
> before that revision landed. This does not affect any reported result: the dry run is
> human-free and its six metrics are vehicle-dynamics measures that do not depend on
> explanation wording.
