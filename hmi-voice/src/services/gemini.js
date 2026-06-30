import { fetchApprovedExamples } from './promptExamples'
import { getPrompt, getScenarioContext, PROMPT_KEYS } from './promptConfig'
import { getPhasePrompt } from '../data/drivePhases'

const MODEL = 'gemini-2.5-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

// Build a few-shot block from operator-curated examples (Supabase).
function buildFewShotBlock(examples) {
  if (!examples?.length) return ''
  const body = examples
    .map(
      (e, i) =>
        `예시 ${i + 1})\n[사용자] ${e.user_input}\n[이상적 답변] ${e.ideal_response}`
    )
    .join('\n\n')
  return `\n\n[참고 예시 — 아래 답변들의 톤·길이·표현 방식을 최대한 따르세요]\n${body}`
}

// Fixed tag-logic the app parses (OPTIONS / SELECTED_OPTION). Kept in code —
// not operator-editable — because the response parser depends on these exact
// tags; a typo here would silently break the detour UI.
const OPTIONS_LOGIC = `
[선택지 제공 및 사용자 의도 파악 로직]
1. 탑승자가 "어떻게 할 거야?", "우회해", "언제 가?" 등 상황 타개책을 묻거나 불만을 표출하면, "다른 경로로 우회할까요?" 라는 질문과 함께 선택지를 제공하세요.
이때, 답변 맨 마지막 줄에 반드시 "[OPTIONS:우회하기|기존 경로 유지]" 태그를 덧붙이세요.
2. 만약 선택지가 제공된 상태에서, 탑승자가 음성이나 타이핑으로 "우회해줘", "우회", "우회하기", "돌아가자" 등 우회를 긍정하는 변용 발언을 하면, 이를 우회로 수락한 것으로 파악하고 "우회 경로로 안내하겠습니다"라고 답변하세요. 이 때 답변 맨 마지막 줄에 반드시 "[SELECTED_OPTION:우회하기]" 태그를 덧붙이세요.
3. 반대로 "기존 경로 유지", "기존대로", "그대로 가자", "유지해" 등 기존 경로를 유지하겠다는 발언을 하면, "기존 경로를 유지합니다"라고 답변하고, 맨 마지막 줄에 반드시 "[SELECTED_OPTION:기존 경로 유지]" 태그를 덧붙이세요.`

const SCENARIO_CARD_DIRECTIVE = `\n\n[시스템 제어 명령]\n이번 답변의 맨 마지막에는 화면에 상황 안내 카드를 띄우기 위해 반드시 "[SHOW_SITUATION]" 라는 텍스트를 정확히 포함해야 합니다.`

// Per-scenario behavior guides for the four suggestion-chip intents and
// their natural-language variants. App.jsx counts how many times the
// passenger has asked for current location / situation briefing so we can
// step the hydroplaning location through five fixed points and acknowledge
// prior briefings.
const SCENARIO_GUIDE_ROUNDABOUT = `

[회전교차로 시나리오 — 의도별 행동]
1. 상황 브리핑 ("지금 상황 어때?", "왜 이래?", "무슨 일이야?", "현재 상황 브리핑", "설명해줘") → 1~2문장으로 회전교차로 정체와 차량의 대처를 짧게 브리핑하고, 응답 맨 마지막 줄에 [SHOW_SITUATION] 태그를 덧붙이세요(상황 애니메이션 팝업이 뜸).
2. 경로 변경 / 우회 요청 ("경로 변경", "다른 길로", "우회 가능?", "다른 경로 추천") → 절대 [SHOW_SITUATION] 태그를 출력하지 마세요. 대신 응답 맨 마지막 줄에 [OPEN_APP:Navigation] 태그를 덧붙여 경로 화면을 띄우고, 본문에는 "현재 기존 경로 우측에 이상 차량이 멈춰 있어 빠져나가지 못하고 있습니다. 다른 출구로 한남대로(또는 강변북로)로 우회하는 건 어떨까요?"처럼 상황 설명과 부드러운 우회 권유로 답하세요. 응답 맨 마지막 줄에 [OPTIONS:우회하기|기존 경로 유지] 태그를 함께 덧붙여 사용자가 고를 수 있게 하세요.
2-a. 위 [OPTIONS] 카드 또는 자유 발화로 "우회하기" / "우회해" / "바꿔줘" / "응 바꿔" 등 우회 긍정 응답이 오면, 절대 [SHOW_SITUATION]은 출력하지 말고 짧게 "우회 경로로 변경했습니다" 같은 확인과 함께 응답 맨 마지막 줄에 [ROUTE_ALTERNATIVE] + [SELECTED_OPTION:우회하기] + [OPEN_APP:Navigation] 태그들을 모두 덧붙이세요. 앱은 다른 색깔의 대안 경로를 지도에 표시하고 추가 시간을 도착 예정 옆에 작게 표시합니다.
2-b. "기존 경로 유지" / "그냥 가" / "아니" 같은 부정 응답이 오면 "기존 경로를 유지합니다" 답변과 함께 [SELECTED_OPTION:기존 경로 유지] 태그만 덧붙이세요(다른 태그 없음).
3. 현재 경로 확인 / 도착 시간 ("어디까지 왔어?", "현재 경로 확인", "얼마나 남았어?", "도착 언제?") → '현재 안내' 정보의 시나리오 지체(5분)를 반영해 "절반쯤 왔는데 회전교차로 정체로 N분 지연되어 [시각]쯤 도착 예정"이라는 식으로 답하고, 응답 맨 마지막 줄에 [OPEN_APP:Navigation] 태그를 덧붙이세요. (절대 [SHOW_SITUATION]은 출력하지 마세요)
4. 추천 옵션 ("추천 옵션", "추천해줘", "어떻게 할까", "뭐 하지") → 본문에서 상황을 짧게 설명하고("현재 기존 경로 우측에 이상 차량이 멈춰 있어 빠져나가지 못하고 있습니다") 부드럽게 권유하세요("다른 출구로 한남대로(또는 강변북로)로 우회하는 건 어떨까요?"). 응답 맨 마지막 줄에 [OPTIONS:우회하기|기존 경로 유지] 태그를 덧붙여 사용자가 선택할 수 있게 하세요. 사용자가 우회하기를 선택하면 2-a 규칙에 따라 처리됩니다.`

// Hydroplaning is more dynamic: location advances across five fixed points
// as the passenger keeps asking, and repeat briefings should acknowledge
// previous ones. The destination is locked to 강남역 2호선 from scenario
// activation onwards, so anything that hints the trip isn't underway is
// explicitly forbidden.
function scenarioGuideHydroplaning(state) {
  const locStep = Math.max(0, Math.min(5, state?.locationCount ?? 0))
  const briefCount = state?.briefingCount ?? 0
  const LOCATION_BY_STEP = {
    1: '녹사평역 부근입니다.',
    2: '이태원역 부근입니다.',
    3: '한남대로 폴바셋 근처입니다.',
    4: '신사역 근처 정체 구간입니다.',
    5: '신분당역 부근으로 정체 중이지만 곧 강남역 2호선 목적지에 도착합니다.',
  }
  const locText = LOCATION_BY_STEP[locStep] || LOCATION_BY_STEP[1]
  // Step 3 has a hidden dropoff caveat — only surface it when the passenger
  // is talking about getting out here. Otherwise step 3 answers like steps
  // 1/2/4: a single sentence location.
  const dropoffNote = locStep === 3
    ? '\n   ※ 단계 3 부가 정보(이 부근에서 하차하려는 맥락일 때만 자연스럽게 덧붙이세요): "다만 차량 통행이 많아 그 자리에서 바로 하차는 어렵고, 골목에 정차하려면 10분 정도 더 소요됩니다." 하차 의향은 직전 대화에 "여기서 내릴게", "여기 세워줘", "하차할게", "내려줘" 같은 표현이 있거나 이번 발화에 같은 표현이 있을 때를 말합니다. 하차 언급이 전혀 없으면 위 문장은 절대 덧붙이지 마세요.'
    : ''
  // 3-tier briefing progression. The counter is 1-indexed (it's incremented
  // *before* the Gemini call), so briefCount === 1 IS the first briefing —
  // never assume "앞서 말씀드렸듯이…" at this point, even if the passenger
  // previously toggled the situation animation.
  const briefingDirective = briefCount <= 1
    ? '이번이 이 시나리오의 **첫 번째 상황 브리핑**입니다. "앞서 말씀드렸듯이" 같은 인지 접두는 절대 사용하지 마세요. 1~2문장으로 빗길 수막현상과 차량의 자동 감속 대처를 짧게 처음 설명하고, 응답 맨 마지막 줄에 [SHOW_SITUATION] 태그를 덧붙이세요(자세히 보기 애니메이션 카드 표시).'
    : briefCount === 2
      ? '이번이 같은 상황에 대한 **두 번째 질문**입니다. 정확히 "앞서 말씀드렸듯이, 노면 상황이 개선되어 약 5초 후 다시 가속할 예정입니다." 톤으로 한 문장 답하세요(이미 알려줬다는 인지 접두 + 곧 가속 예정 정보). [SHOW_SITUATION] 태그는 출력하지 마세요.'
      : '이번이 같은 상황에 대한 **세 번째 이상의 연속 질문**입니다. 정확히 "가속 중입니다." 같이 매우 간결한 한 문장으로만 답하세요(이미 충분히 설명했고, 지금 가속 중이라는 사실만). [SHOW_SITUATION] 태그는 출력하지 마세요.'

  return `

[수막현상 시나리오 — 의도별 행동]
※ 매우 중요: 시나리오 활성과 동시에 목적지가 '강남역 2호선'으로 자동 설정되어 안내 중입니다. "목적지가 설정되지 않았습니다", "어디로 안내해드릴까요?", "안내해드릴게요" 등 목적지/안내 부재를 암시하거나 새로 안내를 시작하는 듯한 발화는 절대 금지. 모든 답변은 강남역 2호선 안내 중이라는 전제로 하세요.

1. 현재 경로 확인 / 현재 위치 / 잔여 거리 ("어디까지 왔어?", "현재 위치", "얼마나 남았어?", "현재 경로 확인") → 이번이 ${locStep}번째 위치 안내입니다. 정확히 다음 문구로 답하세요: "${locText}" 응답 맨 마지막 줄에 [OPEN_APP:Navigation] 태그를 덧붙여 경로 화면을 띄우세요. [SHOW_SITUATION]은 출력하지 마세요.${dropoffNote}

2. 추천 옵션 / 다른 경로 ("추천 옵션", "다른 길", "우회 가능?") → 절대 [OPTIONS] 선택지 카드를 출력하지 마세요. 1~2문장으로 "다른 경로도 가능하지만 결과는 비슷합니다. 빗물이 고여 있어 잠시 감속 상태를 유지하는 게 안전합니다." 같은 톤으로 간결히 설명만 하세요.

3. 경로 변경 ("경로 변경", "우회 해줘") → "현재 빗길로 인한 일시적 정체이며 다른 경로도 비슷합니다. 잠시만 기다려 주시면 곧 정상 주행으로 돌아갑니다." 같이 답하고 [OPTIONS] 태그는 절대 출력하지 마세요. 필요시 [OPEN_APP:Navigation] 태그만 덧붙여 경로 화면을 띄울 수 있습니다.

4. 상황 브리핑 / 왜 늦어져? ("지금 상황 어때?", "왜 이래?", "무슨 일이야?", "현재 상황 브리핑", "설명해줘", "왜 늦어져?") → ${briefingDirective}`
}

function buildScenarioGuide(scenarioId, state) {
  if (scenarioId === 'frustration_roundabout_loop') return SCENARIO_GUIDE_ROUNDABOUT
  if (scenarioId === 'anxiety_hydroplaning') return scenarioGuideHydroplaning(state)
  return ''
}

// One-shot length override. The base/scenario prompts default to short answers
// (1–2 sentences); this section lets the passenger override that for a single
// turn without us tracking any state. The next turn snaps back to short.
const LENGTH_OVERRIDE_LOGIC = `

[답변 길이 (일회성 오버라이드)]
평소엔 1~2문장으로 짧게 답하되, 탑승자가 이번 발화에서 "길게 답해줘", "자세히 설명해", "30자 이상으로", "더 자세히", "풀어서 말해줘"처럼 답변 길이를 명시적으로 늘려달라고 요청하면, 이 응답 한 번만 그 요청에 맞춰 더 풍부하게 답하세요(요청한 글자수가 있으면 그 이상, 없으면 3~6문장). 다음 턴부터는 다시 기본 짧은 답변으로 돌아가세요.`

// Phone call by intent. The app parses [CALL:name] to open the Phone app and
// start ringing. The favorites list is named here so the model knows when to
// confirm versus call directly — keep this in sync with src/data/contacts.js.
const CALL_LOGIC = `

[전화 걸기]
즐겨찾기에 등록된 사람: 엄마 / 김민지 / 박사장님 / 집.
1. 탑승자가 즐겨찾기에 있는 사람한테 전화 걸어달라고 하면(예: "엄마한테 전화해줘", "박사장님 전화 걸어줘"), "OOO에게 전화 거는 중입니다" 같은 짧은 확인과 함께 응답 맨 마지막 줄에 [CALL:이름] 태그를 덧붙이세요.
2. 탑승자가 이름을 말하지 않고 "전화해줘", "전화 걸어줘"만 말하면 "누구에게 전화할까요?"라고 되묻고 [CALL] 태그를 출력하지 마세요. 그 다음 턴에 이름만 듣게 되면 1번 규칙으로 처리하세요.
3. 탑승자가 즐겨찾기에 없는 사람 이름을 말하면(예: "박지성한테 전화해", "이수현한테 걸어줘"), 절대 [CALL] 태그를 바로 출력하지 마세요. 대신 "OOO님에게 전화할까요?"라고 한 번 확인하세요. 사용자가 긍정 응답("네", "응", "맞아", "걸어줘", "그래") 하면 그때 다음 턴에 [CALL:이름] 태그를 출력하세요.
전화 의도가 없으면 [CALL] 태그를 절대 출력하지 마세요.
예: "엄마에게 전화 거는 중입니다. [CALL:엄마]"`

// App control via intent (not keyword matching): the model decides when the
// user wants to open/close a screen app and emits a structured tag the app
// parses. Kept in code — the parser depends on these exact tags.
const APP_CONTROL_LOGIC = `

[앱 제어]
탑승자가 화면의 앱을 열거나 켜달라고 하면(예: "네비 켜줘", "지도 보여줘", "음악 틀어줘", "전화 앱 열어", "일정 확인해줘"), 짧게 확인하는 답변과 함께 응답 맨 마지막 줄에 정확히 한 개의 태그를 덧붙이세요: [OPEN_APP:<앱ID>]
사용 가능한 앱ID (왼쪽 영문 ID만 출력): Navigation(내비게이션/지도/길안내), Phone(전화), Music(음악), Mail(메일), Calendar(일정/캘린더)
앱을 닫아달라고 하면(예: "닫아줘", "꺼줘", "화면 닫아") 응답 맨 마지막 줄에 [CLOSE_APP] 태그를 덧붙이세요.
앱 제어 요청이 아닐 때는 이 태그들을 절대 출력하지 마세요.
예: "내비게이션을 켤게요. [OPEN_APP:Navigation]"`

// Per-scenario extra travel-time penalty (minutes) applied to the navigation
// arrival estimate. The scenario context already describes the holdup; this
// lets the model give a concrete ETA shift without having to invent a number.
const SCENARIO_DELAY_MIN = {
  frustration_roundabout_loop: 5,
  // anxiety_hydroplaning intentionally has no fixed delay — speed varies.
}

function formatClockTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Render the current trip into a one-line snapshot the model reads when the
// passenger asks anything time/distance-related. `currentRoute` is the object
// the app sets when the user confirms a destination in the Navigation app.
function formatNavInfo(currentRoute, scenarioId) {
  if (!currentRoute) return '안내 없음 (목적지 미설정).'
  const now = new Date()
  const dep = new Date(currentRoute.departureIso)
  const base = new Date(currentRoute.baseArrivalIso)
  const delayMin = SCENARIO_DELAY_MIN[scenarioId] || 0
  const arr = new Date(base.getTime() + delayMin * 60_000)
  const remainingMin = Math.max(0, Math.round((arr - now) / 60_000))
  const km = (currentRoute.distanceM / 1000).toFixed(1)
  const delayNote = delayMin ? ` (시나리오 지체 ${delayMin}분 반영)` : ''
  return `${currentRoute.destination.name}으로 안내 중. 출발 ${formatClockTime(dep)} · 예상 도착 ${formatClockTime(arr)}${delayNote} · 잔여 약 ${remainingMin}분 · 거리 ${km} km · 현재 시각 ${formatClockTime(now)}.`
}

const NAVIGATION_CONTEXT = `

[현재 네비게이션 정보]
탑승자가 "얼마나 걸려?", "몇 시 도착해?", "남은 거리?", "왜 늦어져?" 같이 운행/시간/거리/지체 관련 질문을 하면, 아래 '현재 안내' 한 줄을 그대로 사실 기반으로 활용해 자연스럽게 답하세요. 도착 예정 시각·잔여 시간·거리는 모두 거기 명시된 값이며, 시나리오 지체가 있으면 이미 반영되어 있습니다. 안내 중이 아니면("안내 없음") 목적지가 설정돼 있지 않다고 정중하게 알려주세요. 별도의 태그는 출력하지 마세요.`

// Climate control by intent. The model reasons about comfort ("추워" → warmer)
// and emits absolute targets the app applies. Tags are parsed in code.
const CLIMATE_CONTROL_LOGIC = `

[공조 제어]
탑승자가 실내 온도나 바람(공조)을 조절하려는 의도를 보이면(예: "추워", "더워", "온도 올려/내려줘", "23도로 맞춰줘", "바람 세게", "바람 약하게", "잠깐 시원하게 해줘"), 짧게 확인하는 답변과 함께 응답 맨 마지막 줄에 해당 태그를 덧붙이세요.
- 온도: [SET_TEMP:<17~29 정수>] — 아래 '현재 실내 온도'를 기준으로 의도에 맞는 목표 온도를 직접 계산해 절대값으로 출력하세요. "춥다/추워"는 온도를 올리고, "덥다/더워"는 내리세요.
- 바람 세기(지속): [FAN:<1~5 정수>] (1 약함 ~ 5 강함)
- 바람을 잠깐만 강하게: [FAN_BOOST] (잠시 세게 틀었다가 자동 복귀)
온도·바람을 함께 조절하면 두 태그를 모두 덧붙여도 됩니다. 공조 조절 의도가 없으면 이 태그들을 절대 출력하지 마세요.
예: "조금 따뜻하게 할게요. [SET_TEMP:24]" · "바람 잠깐 세게 틀게요. [FAN_BOOST]"`

// System volume by intent. 0–10 scale on the prompt side maps cleanly to the
// app's 0–1 internal value (× 10). The model picks an absolute target so the
// app doesn't have to translate vague phrases.
const VOLUME_CONTROL_LOGIC = `

[음량 제어]
탑승자가 시스템 음량(소리 크기)을 조절하려는 의도를 보이면(예: "볼륨 키워줘", "조금 작게", "조용히", "음소거", "다시 켜줘", "최대로"), 짧게 확인하는 답변과 함께 응답 맨 마지막 줄에 해당 태그를 덧붙이세요. 음량 스케일은 0–10 정수입니다.
- 절대값: [VOLUME:<0–10 정수>] — 아래 '현재 음량'을 기준으로 의도에 맞는 목표 값을 계산. 일반적인 "키워/줄여"는 ±2 정도, "조금/살짝"은 ±1, "엄청/최대로/너무 크다"는 9–10 또는 1–2 같은 끝값.
- 음소거: [MUTE]
- 음소거 해제: [UNMUTE]
음량 조절 의도가 없으면 이 태그들을 절대 출력하지 마세요.
예: "볼륨 키울게요. [VOLUME:7]" · "음소거할게요. [MUTE]" · "다시 켤게요. [UNMUTE]"`

const SPEED_INSTRUCTIONS = `

[음성 속도 제어]
음성(TTS) 속도는 4단계입니다: slow(느림) · normal(기본) · fast(빠름) · very_fast(가장 빠름).
탑승자가 말·목소리 속도를 조절하려는 의도를 보이면, 발화 맥락과 아래 현재 레벨을 함께 고려해 의도에 가장 맞는 절대 레벨 하나를 골라 응답 맨 마지막 줄에 정확히 한 개의 태그로 덧붙이세요(예: [SPEED:fast]).
"빠르게/천천히" 같은 절대 표현이든 "더 빠르게/조금 느리게" 같은 상대 표현이든 자연스럽게 해석하세요(slow가 최저, very_fast가 최고). 본문은 짧게 확인만 하고, 속도 조절 의도가 없으면 SPEED 태그를 절대 출력하지 마세요.`

// 콤마 또는 줄바꿈 어느 방식으로 입력해도 파싱
const KEYS = (import.meta.env.VITE_GEMINI_API_KEYS ?? '')
  .split(/[\n,]/)
  .map((k) => k.trim())
  .filter(Boolean)

let currentKeyIdx = 0

async function callOnce(text, apiKey, customPrompt) {
  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: customPrompt }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      // thinkingBudget: 0 disables 2.5-flash's pre-response reasoning — these
      // short conversational replies don't need it, and it's the biggest
      // latency win without changing the model or response quality.
      generationConfig: {
        responseModalities: ['TEXT'],
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  })

  const body = await res.json()

  if (res.status === 429 || res.status === 503) {
    const err = new Error(res.status === 503 ? '503' : '429')
    err.status = res.status
    throw err
  }
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${body.error?.message ?? 'unknown error'}`)
  }

  const parts = body.candidates?.[0]?.content?.parts ?? []
  return parts.find((p) => p.text)?.text ?? ''
}

export async function getGeminiResponse(text, context = '', needsScenarioCard = false, currentSpeedLevel = 'normal', scenarioId = null, currentTemp = 20, currentFan = 2, currentRoute = null, currentVolume = 0.5, currentMuted = false, scenarioState = {}, currentPhase = 0) {
  if (KEYS.length === 0) {
    throw new Error('API 키가 설정되지 않았습니다 (VITE_GEMINI_API_KEYS)')
  }

  // Resolve operator-editable prompts (Supabase override → hardcoded default).
  // Scenario context override falls back to the caller-supplied `context`.
  const scenarioContext = await getScenarioContext(scenarioId, context)

  let finalPrompt
  if (scenarioContext) {
    const wrapper = await getPrompt(PROMPT_KEYS.CONTEXT_WRAPPER)
    finalPrompt = `${wrapper}

[현재 주행 상황 및 시스템 행동 지침]
${scenarioContext}
${OPTIONS_LOGIC}`

    if (needsScenarioCard) {
      finalPrompt += SCENARIO_CARD_DIRECTIVE
    }
  } else {
    finalPrompt = await getPrompt(PROMPT_KEYS.SYSTEM_BASE)
  }

  finalPrompt += APP_CONTROL_LOGIC
  finalPrompt += CALL_LOGIC
  finalPrompt += LENGTH_OVERRIDE_LOGIC
  if (scenarioContext) finalPrompt += buildScenarioGuide(scenarioId, scenarioState)
  finalPrompt += CLIMATE_CONTROL_LOGIC + `\n현재 실내 온도: ${currentTemp}°C · 바람 세기: ${currentFan}/5`
  finalPrompt += VOLUME_CONTROL_LOGIC + `\n현재 음량: ${Math.round((currentMuted ? 0 : currentVolume) * 10)}/10${currentMuted ? ' (음소거)' : ''}`
  finalPrompt += NAVIGATION_CONTEXT + `\n현재 안내: ${formatNavInfo(currentRoute, scenarioId)}`
  finalPrompt += SPEED_INSTRUCTIONS + `\n현재 음성 속도 레벨: ${currentSpeedLevel}`

  // Dynamic few-shot: inject operator-curated examples for this scenario (no-op
  // when Supabase isn't configured or there are no approved examples yet).
  if (scenarioId) {
    try {
      const examples = await fetchApprovedExamples(scenarioId)
      finalPrompt += buildFewShotBlock(examples)
    } catch (e) {
      console.warn('[gemini] few-shot fetch skipped:', e?.message ?? e)
    }
  }

  // Drive-phase context (per drive.md) — appended LAST so the large static
  // prefix above is a stable byte-for-byte match across calls and Gemini's
  // implicit prefix caching can keep it warm. The phase block is the only
  // chunk that flips per call (one short line). Phase sets differ per
  // scenario (C1 = 13 phases, C2 = 6), hence the scenarioId argument.
  const phaseLine = getPhasePrompt(scenarioId, currentPhase)
  if (phaseLine) {
    finalPrompt += `\n\n${phaseLine}`
  }

  let lastStatus = null
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[currentKeyIdx]
    currentKeyIdx = (currentKeyIdx + 1) % KEYS.length
    try {
      return await callOnce(text, key, finalPrompt)
    } catch (err) {
      lastStatus = err.status
      if (err.status === 429 || err.status === 503) {
        console.warn(`Gemini key ${i + 1}/${KEYS.length} 응답 실패 (${err.status}), 다음 키 시도…`)
        continue
      }
      throw err
    }
  }
  if (lastStatus === 429) throw new Error('모든 키의 쿼터가 초과됐습니다. 잠시 후 다시 시도해주세요.')
  if (lastStatus === 503) throw new Error('API 서버가 혼잡합니다. 잠시 후 다시 시도해주세요.')
  throw new Error('응답에 실패했습니다.')
}
