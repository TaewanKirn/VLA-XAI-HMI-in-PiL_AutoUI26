import { supabase, isSupabaseEnabled } from './supabase'

// Prompt-example store backed by Supabase.
// Table `prompt_examples` (see supabase/schema.sql):
//   id, scenario_id, target_affect, user_input, ideal_response,
//   actual_response, approved, quality, created_at
//
// The dynamic few-shot loop:
//   • Operator contributes corrected (user_input → ideal_response) pairs.
//   • Before each Gemini call, the approved examples for the active scenario
//     are fetched and injected into the system prompt as few-shot guidance.
//   • Every contribution immediately improves future responses.

const TTL_MS = 60_000
const cache = new Map() // scenarioId -> { ts, examples }

/**
 * Approved examples for a scenario, newest first. Cached briefly so we don't
 * hit the DB on every turn. Returns [] when Supabase isn't configured.
 */
export async function fetchApprovedExamples(scenarioId, limit = 6) {
  if (!isSupabaseEnabled || !scenarioId) return []

  const cached = cache.get(scenarioId)
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.examples

  const { data, error } = await supabase
    .from('prompt_examples')
    .select('user_input, ideal_response')
    .eq('scenario_id', scenarioId)
    .eq('approved', true)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.warn('[promptExamples] fetch failed:', error.message)
    return []
  }

  const examples = data ?? []
  cache.set(scenarioId, { ts: Date.now(), examples })
  return examples
}

/**
 * Insert operator-corrected examples. `rows` come from a reviewed trial:
 * { scenario_id, target_affect, user_input, ideal_response, actual_response }.
 * Inserted as approved by default (operator-curated).
 */
export async function contributeExamples(rows) {
  if (!isSupabaseEnabled) return { success: false, skipped: true }
  if (!rows?.length) return { success: false, error: '기여할 보정 예시가 없습니다.' }

  const payload = rows.map((r) => ({ approved: true, ...r }))
  const { error } = await supabase.from('prompt_examples').insert(payload)

  if (error) {
    console.error('[promptExamples] contribute failed:', error.message)
    return { success: false, error: error.message }
  }

  // Invalidate cache for affected scenarios so new examples take effect at once.
  rows.forEach((r) => cache.delete(r.scenario_id))
  return { success: true, count: rows.length }
}
