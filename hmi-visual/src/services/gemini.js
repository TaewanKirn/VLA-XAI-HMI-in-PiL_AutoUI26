// Minimal Gemini 2.5 Flash client for the keyboard-chat variant of this
// prototype. No streaming, no tool use, no action-tag parsing — just send a
// user message + system prompt, get a text reply back.
//
// API keys are read from `VITE_GEMINI_API_KEYS` (comma- or newline-separated
// so multiple keys can round-robin past 429/503 quota errors). See
// .env.example for the format.
//
// Usage:
//   import { getGeminiResponse } from './services/gemini'
//   const reply = await getGeminiResponse('지금 어디까지 왔어?')

const MODEL = 'gemini-2.5-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

const KEYS = (import.meta.env.VITE_GEMINI_API_KEYS ?? '')
  .split(/[\n,]/)
  .map((k) => k.trim())
  .filter(Boolean)

// Round-robin index across the configured keys.
let currentKeyIdx = 0

// Default persona — short, friendly in-car assistant. Override per-call by
// passing a `systemPrompt` argument to getGeminiResponse().
const DEFAULT_SYSTEM_PROMPT = `당신은 차량 어시스턴트 '자인아'입니다. 운전자에게 1~2문장으로 짧고 친근하게 답변하세요. 영어가 섞이지 않은 자연스러운 한국어로 답하세요.`

async function callOnce(text, apiKey, systemInstruction) {
  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      // thinkingBudget: 0 disables 2.5-flash's pre-response reasoning. Short
      // conversational replies don't need it; biggest latency win without
      // changing the model or response quality.
      generationConfig: {
        responseModalities: ['TEXT'],
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  })

  const body = await res.json().catch(() => ({}))

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

export async function getGeminiResponse(text, systemPrompt = DEFAULT_SYSTEM_PROMPT) {
  if (KEYS.length === 0) {
    throw new Error('API 키가 설정되지 않았습니다 (VITE_GEMINI_API_KEYS)')
  }
  let lastStatus = null
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[currentKeyIdx]
    currentKeyIdx = (currentKeyIdx + 1) % KEYS.length
    try {
      return await callOnce(text, key, systemPrompt)
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
