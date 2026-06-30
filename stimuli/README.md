# Stimulus pool

Canonical specification of the in-cabin situation-awareness (SA) explanation
stimuli used in both HMI modalities. The **same SA sentences** are presented in
the visual and voice HMIs (information-content equivalence at the character
level) — modality is the manipulated independent variable, everything else is
held constant.

The actual stimulus strings live in code:

- Visual HMI: [`../hmi-visual/src/data/scenarios.js`](../hmi-visual/src/data/scenarios.js)
- Voice HMI: [`../hmi-voice/src/data/scenarios.js`](../hmi-voice/src/data/scenarios.js),
  [`drivePhases.js`](../hmi-voice/src/data/drivePhases.js)

## Documents here

| File | What it is |
|------|------------|
| `ScenarioSetting.md` | Canonical screen sequence — C1 (frustration, 9 phases) and C2 (anxiety, 13 phases), AutopilotStatus 5-state, SA Zoom-In/Out. Single source of truth for the stimulus timeline. |
| `VLA_mapping_v5.md` | Scenario-phase × VLA mapping — which SA sentence is shown at each error phase (🔴 detect → 🟠 cause → 🟡 resolve). Text mirror of the design master. |
| `commentary_mapping.md` | SA-level vocabulary source and faithfulness notes (the basis for SA1/2/3 wording). |

VLA stimuli are surfaced only in the error window; the normal 🟢 phase shows no
visual explanation (the voice HMI adds a single "driving normally" utterance).
