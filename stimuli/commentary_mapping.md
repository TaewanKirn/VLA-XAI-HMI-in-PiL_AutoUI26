# VLA Commentary → HMI SA-Level 매핑 정본

> 🔝 **정본 위치(2026-06-25)**: 시나리오 단계 × VLA 매핑의 **단일 진실 공급원 = Figma 프레임 `1157:2010` "시나리오 단계 × VLA 매핑 (정리판 v5 260625)"** (텍스트 미러 = `VLA_mapping_v5_260623.md`). **이 문서(commentarymapping.md)는 그 매핑의 SA-Level 어휘 출처·faithfulness(Lingo-Judge≥.80) 게이트 보조**다. 단계별 확정 발화·event→화면 정본은 v5 매핑/`ScenarioSetting.md`를 따른다.
>
> ✅ **2026-06-23: 단계별 확정 음성 발화 표 신설** — Figma 매핑(node `1157:2010`)의 음성 발화 열을 반영. C1/C2 각 섹션 상단 **★ 단계별 확정 음성 발화** 표가 음성 TTS 단계별 정본(= `ScenarioSetting.md` 음성 열과 동일). 아래 SA-Level 풀은 어휘 출처·faithfulness 게이트용 보조로 강등.
>
> ⚠️ **2026-06-22 ScenarioSetting 정본 개정 반영 — C1=9단계 Gap-Acceptance 과보수, C2=3이벤트 지형차별(flat/uphill/downhill), FI=물웅덩이 미감지. 비트별 문장 정본은 `ScenarioSetting.md` 표가 최신. 이 문서의 구판(06-04) 비트매핑은 보조(어휘 출처·faithfulness 게이트용).**
> - **모달리티 격리 = 안 A(260622)**: 시각/음성/No-HMI 동일 주행 베이스 — 시각=텍스트, 음성=동일 SA 문장 TTS(화면 텍스트·자막 숨김, wake 인디케이터만), No-HMI=둘 다 플래그 off. 모달리티만 단일 변인·정보량 동치. SRT IV=모달리티, Zoom 조작은 TR-F.
> - **공감문구 슬롯 2건(260622)** — 각 시나리오 1회·동일 시점, 시각=음성 글자단위 동일:
>   - **C1-5**(FI 역추론, 답답함 절정 직후): "계속 같은 자리를 도느라 답답하셨죠. 곧 빠져나가겠습니다."
>   - **C2-4**(E1 해결, 첫 요동 직후): "갑작스러운 흔들림에 놀라셨죠. 지금부터 더 천천히 가겠습니다."
> - **SA 글자크기(260622)**: 윗줄 40–46px·아랫줄 28–32px·상태칩 30–36px(구 70/60pt 본문 폐기, 70pt는 칩/키워드 강조용).
>
> ──────────
>
> 🔒 **2026-06-04 2차 PM 결정 반영(`feedback_260604_decisions.md`):**
> - **이 문서 = 시각(A안)·음성(B안) 양 모달리티의 시나리오 발화 공통 정본.** SRT 핵심 IV는 **모달리티(시각 vs 음성)**이고 SA 구조(지각→이해→예측)는 *양 모달리티에 동일 내용으로 고정*한다 → "시각 vs 음성"이 "정보량 차이"로 교란되지 않도록 **두 모달리티가 본 문서의 동일 SA1/2/3 문장을 사용**(정보량 동치화, 결정 ③).
> - **음성(B안) 운용 = 하이브리드(결정 ⑥):** *시나리오 관련 commentary는 본 문서를 고정 참조*(시행 간 동일성·재현성), *평소 일반 대화(잡담)는 Gemini API 실시간 생성*. 즉 자유생성 전면 동결이 아니라 **실험 자극이 되는 발화만 고정**.
> - **SRT 범위 확대(결정 ⑤):** SRT = **C1·C2 둘 다 × 시각/음성**(구 "C1·시각 단독" 폐기). 따라서 **아래 C2(수막) 11문장도 SRT 자극 정본**(구 TR-F 이연 아님). 단 C2 시뮬 물리(`tire_friction`)·6DOF 떨림 복구가 SRT 임계 선결.
> - 정보구조 **Zoom-In/Out 조작은 TR-F**(SRT에선 풀 SA 통합 탑재·고정). 용어 '의자'→'시뮬레이터'.
>
> ──────────
>
> ⚠️ **프레이밍 (2026-06-04 사용자 확정 — 혼동 금지):** SimLingo는 **설계 참조 소스**이지 **런타임 구성요소가 아니다.** 본 연구는 SimLingo를 실행해 commentary를 live로 띄우는 것이 아니라, SimLingo commentary/VQA(+multi-source)를 **참고해 SA-Level HMI 구조로 저작한 고정 copy**를 표시한다. → **ego perception 센서(camera/lidar/radar) 불요**, live VLA 추론 없음. 다리(bridge) 충실성은 *런타임 파이프라인이 아니라* **report 추적성 + Lingo-Judge≥.80 게이트**로 보증 = **번역·구조화 기여**. Methods엔 "SimLingo live 생성"이 아니라 "참조·구조화·faithfulness-gated·WoZ 고정 제시"로 기술.
>
> 목적: VLA(SimLingo) reasoning을 **SA-Level 정보구조(IV1)**로 구조화해 실험 HMI에 표시하기 위한 **문장 정본**.
> 프레임(연구 정본 `00_planning/research_plan.md` · `research-framing`):
> **Zoom-In = SA1(지각/상태 선언) + SA2(이해/판단 설명)** · **Zoom-Out = SA3(예측/진행 전망)**.
> 두 시나리오: C1=답답함(회전교차로 교착) · C2=불안함(수막현상). **SRT = C1·C2 둘 다 × 시각(A안)/음성(B안)**(2026-06-04 확대; 구 "C1·시각 단독" 폐기).
> 산출 출처: 사용자 제공 매핑 자료(2026-06-04). 이식 대상: A안 `06_stimuli/HCI-prototype-interface/src/App.jsx` `getAlertConfig()`.
> **N초·권장속도 등 동적 수치는 (0) WS `scenario_event.payload`(`Nsec_to_recover`·`recommended_kmh`)에서 주입**(설계 `hmi_carla_sync_logging_260531.md` §2.1).

---

## 시나리오 1. 답답함 — 회전교차로 교착 (C1)

### ★ 단계별 확정 음성 발화 (정리판 v4 · 2026-06-23 정본 — TTS 풀 SA)
> 시각(`ScenarioSetting.md` 윗+아랫줄)과 동일 SA를 음성 TTS로(정보량 글자단위 동치). 정상(🟢)은 발화 없음(기본 멘트 "목적지까지 안전하게 주행 중입니다"만). **이 표가 음성 단계별 정본**; 아래 SA-Level 풀은 어휘 후보·faithfulness 게이트 보조.

| 단계 | 상태 | 음성 발화 (TTS·풀 SA) |
|---|---|---|
| C1-2 | 🔴 감지 | 교차로 진입 간격 확보에 어려움을 겪고 있습니다. 안전 간격을 만들면 진입합니다. |
| C1-4 | 🔴 감지 | 비정상적인 반복 회전이 감지되었습니다. 2차로 진출에 실패해 같은 구간을 다시 주행합니다. |
| C1-5 | 🟠 원인 | 차선 변경에 필요한 간격 기준이 너무 보수적입니다. 간격이 확보되면 차선 변경을 시도합니다. **(+공감문구 1회: 계속 같은 자리를 도느라 답답하셨죠. 곧 빠져나가겠습니다.)** |
| C1-6 | 🟡 해결 | 2차로 차선 변경을 시도합니다. 잠시 정차 후 진입하겠습니다. |
| C1-8 | 🔴 감지(재발) | 출구를 빠져나가지 못해 한 바퀴 더 회전합니다. 다음 바퀴에 진출합니다. |

> (보조) 아래는 SA-Level 어휘 후보 풀(06-04판) — 어휘 출처·Lingo-Judge 게이트용. **단계별 확정 발화는 위 표.**

### Zoom-In · SA Lv.1 (지각) — 상태 선언
- 회전교차로에 진입했습니다.
- 앞 차량이 멈춰 있어 정차 중입니다.
- 전방 차량 속도에 맞춰 감속 중입니다.
- 앞 차량과의 간격 유지를 위해 감속 중입니다.

### Zoom-In · SA Lv.2 (이해) — 판단 설명
- 안전한 합류 간격을 기다리는 중입니다.
- 회전 차량 사이로 진입할 안전 공간을 탐색 중입니다.
- 안전 공간이 확보될 때까지 대기합니다.
- 회전 중인 차량에 우선권을 양보하고 있습니다.
- 회전교차로가 비워질 때까지 대기 중입니다.

### Zoom-Out · SA Lv.3 (예측) — 진행 전망
- 예상 진입까지 약 N초.
- 약 N초 후 진입을 시도할 예정입니다.
- 전방이 비워지면 회전교차로를 통과할 예정입니다.
- 감속 상태를 유지하며 진입 타이밍을 탐색합니다.
- 회전교차로 내에서는 차선 변경이 제한됩니다.

### VQA (자극물 외 보조용 — Lingo-Judge 검증·사실성 게이트 소스)
| 구분 | Q | A |
|---|---|---|
| 진입 직전 — 인식 보고 | Is the ego vehicle at a junction? | The ego vehicle is right before a junction. |
| 정차 직후 — 사유 설명 | Does the ego vehicle need to brake? Why? | The ego vehicle should adjust its speed to the speed of the \<OBJECT\> that is to the front of it. |
| 대기 상태 명시 | What is the ego vehicle waiting for? | A safe gap in traffic before proceeding. |
| 양보 대상 인식 | Which vehicles should the ego car watch when turning left at the intersection? | Traffic coming from the left going straight or turning, and oncoming traffic. |
| 차선 변경 가능성 | In which direction is the ego car allowed to change lanes? | It is not possible to tell since the ego vehicle is in a junction. |

---

## 시나리오 2. 불안함 — 수막현상 (C2)

### ★ 단계별 확정 음성 발화 (정리판 v4 · 2026-06-23 정본 — TTS 풀 SA)
> 시각(`ScenarioSetting.md` 윗+아랫줄)과 동일 SA를 음성 TTS로(정보량 글자단위 동치). 정상(🟢)은 발화 없음. **이 표가 음성 단계별 정본**; 아래 SA-Level 풀·합성문 매트릭스는 어휘 출처·faithfulness 게이트 보조.

| 단계 | 상태 | 음성 발화 (TTS·풀 SA) |
|---|---|---|
| C2-2 | 🔴 감지(E1·평지) | 차량이 순간적으로 크게 요동쳤습니다. 타이어 접지력이 급격히 떨어져 미끄럼이 발생했습니다. |
| C2-3 | 🟠 원인 | 노면의 물웅덩이를 미리 감지하지 못했습니다. 이로 인해 수막현상이 발생했습니다. |
| C2-4 | 🟡 해결 | 재발 방지를 위해 속도를 낮춰 서행합니다. 약 N초 후 정상 마찰 상태로 복귀할 예정입니다. **(+공감문구 1회: 갑작스러운 흔들림에 놀라셨죠. 지금부터 더 천천히 가겠습니다.)** |
| C2-6 | 🔴 감지(E2·오르막) | 다시 차량이 요동쳤습니다. 노면 접지력 저하가 원인입니다. |
| C2-7 | 🟠 원인 | 오르막 중턱 물웅덩이를 파악하지 못했습니다. 수막현상 방지를 위해 보수적으로 주행합니다. |
| C2-8 | 🟡 해결 | 지형 경사까지 고려해 더 일찍 감속합니다. 도착 예정 시간에는 큰 차이가 없습니다. |
| C2-10 | 🔴 감지(E3·내리막) | 내리막 구간에서 차량이 크게 흔들렸습니다. 노면 접지력을 잃었습니다. |
| C2-11 | 🟠 원인 | 센서 시야에 물웅덩이가 파악되지 않았습니다. 내리막 가속이 더해져 요동이 커졌습니다. |
| C2-12 | 🟡 해결 | 더이상 수막현상이 발생하지 않도록 주행 속도를 낮춥니다. 규정속도의 40%인 25km/h로 속도를 유지합니다. |

> (보조) 아래는 SA-Level 합성문 매트릭스(06-04판) — 어휘 출처·CoC slot·Lingo-Judge 게이트용. **단계별 확정 발화는 위 표.**

> **C2 11문장은 `VLA/VLAcommentaryreport.md`에서 추출·대체.** C2는 SimLingo Coverage Gap(보고서 §2.3·§4.1: weather/wet/friction/visibility 어휘 부재)이므로, 아래 문장은 보고서 §4.3.1 multi-source 합성 매트릭스에서 가져왔고 **CoC slot·출처·충실성 상태**를 함께 표기한다.
> 상태 범례: ⚠️ **합성문**(보고서 §4.6 4-stage 게이트[Alpamayo CoC slot·어휘출처·Lingo-Judge≥.80·n=5 Likert] 통과 전까지 미확정) · ⚙️ **동적 수치 주입 대기**(N초·권장속도 = **CARLA 시나리오 스크립트/지오펜스에서 산출** → `scenario_event.payload`, 미구축 — *SimLingo 런타임 실행 아님*). **시뮬 선결**: C2 `tire_friction` 동적저감 구현 전엔 SA1/SA2(마찰·제동거리)가 시뮬 물리와 불일치(부록 A·D).

### Zoom-In · SA Lv.1 (지각) — 상태 선언 (Perception / SCENE EVIDENCE)
| 문장 (보고서 추출) | CoC slot | 출처 (VLAcommentaryreport.md) | 상태 |
|---|---|---|---|
| 노면이 젖어 있고 물웅덩이가 감지되었습니다. | scene evidence | §4.3.1 LMDrive LangAuto notice + CoVLA wet caption + ODD checker | ⚠️ |
| 전방 시야가 강우로 인해 제한되어 있습니다. | scene evidence | §4.3.1 CODA-LM "Visibility reduced…" + Vargas 2023 | ⚠️ |
| 센서 신뢰도가 저하된 상태입니다. | scene evidence | §4.3.1 계획서 HMI 문구 + Vargas 2023 sensor degradation | ⚠️ (VLA 근거 최약·불안 증폭 주의) |

### Zoom-In · SA Lv.2 (이해) — 판단 설명 (Reasoning / DRIVING DECISION)
| 문장 (보고서 추출) | CoC slot | 출처 (VLAcommentaryreport.md) | 상태 |
|---|---|---|---|
| 젖은 노면에서 안전 제동 거리를 확보하기 위해 감속을 권장합니다. *(단축형: "…제동거리 확보를 위해 감속합니다.")* | reasoning trace | §4.3.1 FI("마찰계수 미반영") 변환 + Reason2Drive chain + Wang 2025 friction model | ⚠️ |
| 안전 권장 속도와 현재 속도의 차이가 큽니다. 권장 속도로 낮춥니다. | driving decision | §4.3.1 계획서 HMI 문구 + Forster 2021 information adaptation | ⚠️ (VLA 근거 최약) |
| 조향·제동 응답이 평소보다 느려질 수 있습니다. | reasoning trace | §4.3.1 yaw 불안정 사전고지 + Wang 2025 RL + DriveLM-CARLA brake | ⚠️ |

### Zoom-Out · SA Lv.3 (예측) — 진행 전망 (Trajectory + Planning)
| 문장 (보고서 추출) | CoC slot | 출처 (VLAcommentaryreport.md) | 상태 |
|---|---|---|---|
| 물웅덩이 통과까지 약 N초. 차선 중심을 유지합니다. *(변형: "N초 동안 직진 자세를 유지합니다.")* | trajectory decoding | §4.3.1/§5.2 구조 참조(Alpamayo trajectory) + **N초=CARLA 시나리오/지오펜스 산출**(SimLingo 런타임 아님) + 6DoF 동기화 | ⚙️ |
| 약 N초 후 정상 마찰 상태로 복귀할 예정입니다. | planning | §4.3.1/§4.5#7 Wang 2025 friction recovery + Recovery time 지표 | ⚙️ |
| 다음 회복 지점까지 차선 중심선을 유지합니다. | trajectory decoding | §4.3.1 Wang S. 2025 LKAS rain failure + 차선이탈 지표 | ⚠️/⚙️ |

### ❄ 위험 노출 대조 자극용 (No-HMI/대조 조건)
> 보고서 §4.2·§4.5#10 SimLingo [Maintain Speed] 잔재 — **의도적 위험 대조**(수막 상황에선 권장 안 됨). ✅ native.
- 현재 속도를 유지합니다.  *(SimLingo "Maintain your current speed.")*
- 현재 속도 제한: 60 km/h. 권장 속도와 차이가 있습니다.  *(VQA speed-limit variant)*

### VQA (자극물 외 보조용 — Lingo-Judge 검증·사실성 게이트 소스)
| 구분 | SA | Q | A |
|---|---|---|---|
| 노면 상태 인식 | Zoom-In Lv.1 | What is the current road surface condition? | The road is wet with puddles detected. Friction is reduced. |
| 감속 사유 설명 | Zoom-In Lv.2 | Why did the ego car decelerate? | Because reduced tire friction on the wet surface requires a longer stopping distance. |
| 권장 속도 | Zoom-In Lv.2 | What is the recommended speed under current conditions? | Approximately 40 km/h under wet-road conditions. |
| 정상 복귀 시점 | Zoom-Out Lv.3 | When will normal control be restored? | Approximately N seconds after passing the puddle. |
| 조향 안정성 | Zoom-Out Lv.3 | Is the ego vehicle's steering currently unstable? | Yes — momentary yaw oscillation may occur. Maintain seat posture. |

### 일반 감속 템플릿 (SimLingo VQA 내 있었으나 사용하지 않은 명목들)
> 보고서 §4.2·§4.5#8–9 SimLingo [Decelerate] 변환 — ✅ native(폴백/보조용).
- 권장 속도까지 감속 중입니다.  *(SimLingo "Decelerate to drive with the target speed.")*
- 안전 속도로 낮추는 중입니다.  *(SimLingo "Decelerate to drive with the target speed.")*
- 경로 유지하며 감속합니다.  *(SimLingo "Follow the route. Decelerate.")*

---

## 부록 A. 코드 이식 현황 (2026-06-04 확인 — A안 `HCI-prototype-interface`)

> **결론: 위 매핑은 현재 코드에 미이식.** A안·B안 모두 SA-Level/Zoom 구조 grep 0건. 현 reasoning은 `App.jsx:283–351` `getAlertConfig()`의 simStage별 **단문 라벨 9개**뿐.

| 매핑 차원 | 코드 현황 | 근거 |
|---|---|---|
| SA1 (지각/상태 선언) | **부재** (양 시나리오) | — |
| SA2 (이해/판단 설명) | 단편 라벨만 (`'합류 공간 찾는 중...'`·`'대기 중...'`·`'합류 승인 대기'`) | `App.jsx:287,294,308` |
| SA3 / Zoom-Out (예측/진행 전망) | **완전 부재** (미래전망 "N초" 문구 0) | — |
| C2 수막 카드 | 행동만 (`'안전 확보를 위해 / 80km/h로 감속'` · `'약 3초간 감속 유지'`) | `App.jsx:545–554` |
| Zoom-In/Out 전환 상태(IV1) | **없음** (`disclosure`/`zoomMode`/`saLevel` 미존재) | grep 0건 |

**수치 불일치 주의**: 코드 카드 `80km/h`(`App.jsx:547`) ↔ 본 매핑 **권장 40 km/h / 제한 60 km/h**. 이식 시 정정.

## 부록 B. 이식 지시 (개발셀, SRT 임계)
1. `getAlertConfig()`의 9개 단문 → 본 문서 **SA1/SA2/SA3 다문장 copy로 교체**.
2. **`zoomMode: 'in' | 'out' | 'integrated'` 상태 신설** → Zoom-In(SA1+SA2)·Zoom-Out(SA3)·통합을 **조건으로 전환** = IV1(정보구조) 조작 가능화.
3. C2 수막 카드 수치 **80 → 권장40/제한60** 정정 + SA1 지각 문장 선행 표시.
4. `N초`·`recommended_kmh` 동적값은 WS `scenario_event.payload`에서 주입(CARLA 연동과 맞물림).
5. VQA 표는 HMI에 직접 표시 ✗ — **SimLingo 실출력 ↔ Lingo-Judge≥.80 동치 검증용**으로 보관(XAI 다리 사실성).

*Generated 2026-06-04 · 출처: 사용자 매핑 자료(이미지) 전사 + A안 코드(`HCI-prototype-interface`) 대조 · 페어 문서: `feedback_260604_reviewed.md`(HMI), `04_design/CARLA/hmi_carla_sync_logging_260531.md`(§2 payload)*
