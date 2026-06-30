# Scenario animations

Drop the two scenario videos into this folder. They're played in the in-chat
"자세히 보기" popup when the AI emits `[SHOW_SITUATION]` (either automatically
on the first response after a scenario activates, or on demand when the user
asks for a briefing).

The video is set to `autoplay muted playsInline` with no `loop`, so it plays
once and the popup closes itself on the `ended` event.

| File | Scenario | Triggered by |
| --- | --- | --- |
| `roundabout.mp4` | `frustration_roundabout_loop` (Alt+Q) | 회전교차로 반복 주행 |
| `hydroplaning.mp4` | `anxiety_hydroplaning` (Alt+W) | 빗길 수막현상 |

Format recommendations: H.264 MP4, 720p, ~5–10 seconds, no audio (the element
is muted anyway). WebM works too if you'd prefer; just rename the file
extension and update `animationForScenario` in `src/App.jsx`.

If the file is missing the popup stays open with a black frame; users can
close it via the X or by swiping right.
