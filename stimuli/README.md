# Stimulus pool

Canonical specification of the in-cabin situation-awareness (SA) explanation
stimuli used in both HMI modalities. The **same SA sentences** are presented in
the visual and voice HMIs (information-content equivalence at the character
level) — modality is the manipulated independent variable, everything else is
held constant.

## Start here

**[`explanation_script.md`](explanation_script.md) — the complete stimulus pool in English
and Korean.** Every SA sentence for both scenarios (C1, 9 phases; C2, 13 phases), with the
CARLA event that triggers each phase, the FI back-inference rows marked ★, the voice/visual
deviations, and the two rows where the paper's Table 1 differs from the as-built code.

Table 1 of the paper prints only the two ★ rows for space; this file is the full set.

## Documents here

| File | What it is | Language |
|------|------------|----------|
| `explanation_script.md` | **Full stimulus pool** — all SA sentences, per phase, both modalities. Start here. | EN + KO |
| `ScenarioSetting.md` | Canonical screen sequence — C1 (frustration, 9 phases) and C2 (anxiety, 13 phases), AutopilotStatus 5-state, SA Zoom-In/Out. Single source of truth for the stimulus timeline. | KO |
| `VLA_mapping_v5.md` | Scenario-phase × VLA mapping — which SA sentence is shown at each error phase (🔴 detect → 🟠 cause → 🟡 resolve). Text mirror of the design master. | KO |
| `commentary_mapping.md` | SA-level vocabulary source and faithfulness notes (the basis for SA1/2/3 wording). | KO |

The three Korean files are the working design masters, kept as-is for provenance.
`explanation_script.md` is the English-readable extract and supersedes them where they
disagree with the shipped code.

## The strings in code

The presented strings live in the HMI sources, not in a data file:

| Modality | File | Symbol |
|---|---|---|
| Visual | [`../hmi-visual/src/App.jsx`](../hmi-visual/src/App.jsx) | `SEQUENCES.roundabout`, `SEQUENCES.aquaplaning` (`hero` = Zoom-In, `sub` = Zoom-Out) |
| Voice | [`../hmi-voice/src/data/drivePhases.js`](../hmi-voice/src/data/drivePhases.js) | `C1_PHASES`, `C2_PHASES` (`speech`) |

Event → phase routing: [`../hmi-visual/src/services/carlaBridge.js`](../hmi-visual/src/services/carlaBridge.js)
(`C1_EVENT_TO_INDEX`, `C2_TERRAIN_TO_INDEX`) and `../hmi-voice/src/services/carlaScenarioMap.js`.

> `*/src/data/scenarios.js` holds the **Gemini small-talk context** for free conversation
> outside the scripted explanations — not the SA stimuli.

VLA stimuli are surfaced only in the error window; the normal 🟢 phase shows no
visual explanation (the voice HMI adds a single "driving normally" utterance).
