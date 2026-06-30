import { supabase, isSupabaseEnabled } from './supabase'

// Editable prompt fragments, backed by the Supabase `app_prompts` key-value
// table (see supabase/schema.sql). gemini.js and the operator console both
// import the defaults here, so the baseline text has a single source of truth.
//
// Resolution order for any key:
//   Supabase override  →  hardcoded default below  →  ''
// The table is optional: with Supabase unconfigured (or a key absent) the app
// uses the defaults and behaves exactly as before.

export const PROMPT_KEYS = {
  SYSTEM_BASE: 'system_base',           // persona used when no scenario is active
  CONTEXT_WRAPPER: 'system_context_wrapper', // persona used with a scenario context
}

export const DEFAULT_PROMPTS = {
  [PROMPT_KEYS.SYSTEM_BASE]: `당신은 차량 내비게이션에 탑재된 AI 어시스턴트입니다.
- 사용자가 말한 내용을 반복하지 말고 바로 본론만 답하세요.
- 한 두 문장으로 최대한 짧게 답하세요.
- 밝고 친절한 말투를 사용하세요.
- 운전 중 상황임을 항상 고려하고 안전을 최우선으로 하세요.`,

  [PROMPT_KEYS.CONTEXT_WRAPPER]: `당신은 탑승자를 태우고 운행 중인 완전자율주행(Lv5) 차량의 인공지능 시스템 자체입니다.
탑승자에게 사람처럼 공감하거나 위로하는 말("답답하시죠?", "불편하셨죠?", "어이쿠" 등)을 절대 사용하지 마세요.
오직 차량의 현재 주행 상태와 판단 이유만을 차분하고 명확하게, 시스템이 보고하듯 정중하게 대답해야 합니다.`,
}

// Per-scenario context override key (the default lives in src/data/scenarios.js).
export const scenarioContextKey = (scenarioId) => `scenario_context__${scenarioId}`

const TTL_MS = 60_000
let cache = null // { ts, map }

/**
 * The full key→content override map from Supabase (cached briefly). Returns {}
 * when Supabase isn't configured. On error, falls back to the last good cache.
 */
export async function fetchPromptConfig() {
  if (!isSupabaseEnabled) return {}

  if (cache && Date.now() - cache.ts < TTL_MS) return cache.map

  const { data, error } = await supabase.from('app_prompts').select('key, content')
  if (error) {
    console.warn('[promptConfig] fetch failed:', error.message)
    return cache?.map ?? {}
  }

  const map = {}
  for (const row of data ?? []) map[row.key] = row.content
  cache = { ts: Date.now(), map }
  return map
}

/** Resolved value for a known prompt key (override → default). */
export async function getPrompt(key) {
  const map = await fetchPromptConfig()
  return map[key] ?? DEFAULT_PROMPTS[key] ?? ''
}

/** Resolved scenario context (override → caller-supplied default). */
export async function getScenarioContext(scenarioId, fallback = '') {
  if (!scenarioId) return fallback
  const map = await fetchPromptConfig()
  return map[scenarioContextKey(scenarioId)] ?? fallback
}

/** Upsert a prompt override. Invalidates the cache so it goes live at once. */
export async function savePrompt(key, content) {
  if (!isSupabaseEnabled) return { success: false, skipped: true }

  const { error } = await supabase
    .from('app_prompts')
    .upsert({ key, content, updated_at: new Date().toISOString() }, { onConflict: 'key' })

  if (error) {
    console.error('[promptConfig] save failed:', error.message)
    return { success: false, error: error.message }
  }
  cache = null
  return { success: true }
}

/** Remove an override so the key reverts to its hardcoded default. */
export async function resetPrompt(key) {
  if (!isSupabaseEnabled) return { success: false, skipped: true }

  const { error } = await supabase.from('app_prompts').delete().eq('key', key)
  if (error) {
    console.error('[promptConfig] reset failed:', error.message)
    return { success: false, error: error.message }
  }
  cache = null
  return { success: true }
}
