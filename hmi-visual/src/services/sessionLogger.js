// ── localStorage key constants ──────────────────────────────
const KEYS = {
  PARTICIPANT_COUNTER: 'exp_participant_counter',
  TRIAL_COUNTER_PREFIX: 'exp_trial_counter_',
  CURRENT_PARTICIPANT: 'exp_current_participant',
  CURRENT_TRIAL: 'exp_current_trial',
  CURRENT_TURNS: 'exp_current_turns',
  SAVED_SESSIONS: 'exp_saved_sessions',
}

// ── localStorage helpers ─────────────────────────────────────
const lsGet = (key) => {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : null
  } catch {
    return null
  }
}

const lsSet = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('[sessionLogger] localStorage write failed:', key, e)
  }
}

// ── ID generation (read-only, no side effects) ───────────────

export const generateNextParticipantId = () => {
  const counter = lsGet(KEYS.PARTICIPANT_COUNTER) ?? 0
  return 'P' + String(counter + 1).padStart(3, '0')
}

export const generateNextTrialId = (participantId) => {
  const counter = lsGet(KEYS.TRIAL_COUNTER_PREFIX + participantId) ?? 0
  return `${participantId}_T${String(counter + 1).padStart(3, '0')}`
}

// trialId already contains participantId (e.g. P001_T001), so we omit participantId here
export const generateSessionId = (_participantId, trialId) => {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `S_${trialId}_${date}_${time}`
}

// ── Counter commits ──────────────────────────────────────────
// Call commitParticipant() only on "Start New Participant"
export const commitParticipant = () => {
  const counter = lsGet(KEYS.PARTICIPANT_COUNTER) ?? 0
  lsSet(KEYS.PARTICIPANT_COUNTER, counter + 1)
}

// Call commitTrial() once per "Start Trial"
export const commitTrial = (participantId) => {
  const key = KEYS.TRIAL_COUNTER_PREFIX + participantId
  const counter = lsGet(key) ?? 0
  lsSet(key, counter + 1)
}

// ── Current session r/w (autosave during experiment) ─────────
export const saveCurrentParticipant = (participant) =>
  lsSet(KEYS.CURRENT_PARTICIPANT, participant)

export const getCurrentParticipant = () => lsGet(KEYS.CURRENT_PARTICIPANT)

export const saveCurrentTrial = (trial) =>
  lsSet(KEYS.CURRENT_TRIAL, trial)

export const getCurrentTrial = () => lsGet(KEYS.CURRENT_TRIAL)

export const saveCurrentTurns = (turns) =>
  lsSet(KEYS.CURRENT_TURNS, turns)

export const getCurrentTurns = () => lsGet(KEYS.CURRENT_TURNS) ?? []

export const clearCurrentSession = () => {
  localStorage.removeItem(KEYS.CURRENT_TRIAL)
  localStorage.removeItem(KEYS.CURRENT_TURNS)
}

// ── Final save (idempotent upsert by participantId/trialId) ──
export const saveParticipantSession = (participantData) => {
  try {
    const sessions = lsGet(KEYS.SAVED_SESSIONS) ?? []
    const pIdx = sessions.findIndex((s) => s.participantId === participantData.participantId)

    if (pIdx === -1) {
      sessions.push(participantData)
    } else {
      const existing = sessions[pIdx]
      const updatedTrials = [...(existing.trials ?? [])]
      for (const incomingTrial of participantData.trials) {
        const tIdx = updatedTrials.findIndex((t) => t.trialId === incomingTrial.trialId)
        if (tIdx === -1) {
          updatedTrials.push(incomingTrial)
        } else {
          updatedTrials[tIdx] = incomingTrial
        }
      }
      sessions[pIdx] = {
        ...existing,
        participant: participantData.participant,
        trials: updatedTrials,
      }
    }

    lsSet(KEYS.SAVED_SESSIONS, sessions)
    return { success: true }
  } catch (err) {
    console.error('[sessionLogger] saveParticipantSession failed:', err)
    return { success: false, error: err.message }
  }
}

export const getAllSessions = () => lsGet(KEYS.SAVED_SESSIONS) ?? []

export const getParticipantSession = (participantId) => {
  const sessions = getAllSessions()
  return sessions.find((s) => s.participantId === participantId) ?? null
}

// ── Export helpers ────────────────────────────────────────────
const getDateStr = () => {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

const downloadBlob = (content, mime, filename) => {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const downloadJSON = (data, filename) =>
  downloadBlob(JSON.stringify(data, null, 2), 'application/json', filename)

export const exportParticipantJSON = (participantId) => {
  const session = getParticipantSession(participantId)
  if (!session) return false
  downloadJSON(session, `participant_${participantId}_${getDateStr()}.json`)
  return true
}

export const exportTrialDebugJSON = (trial) => {
  downloadJSON(trial, `debug_${trial.trialId}_${getDateStr()}.json`)
}

// ── Markdown export (full human-readable trial log, incl. memo) ──
// `trial.conversationTurns` are expected to be enriched with
// userCorrectedTranscript / aiIdealResponse before calling.
export const exportTrialMarkdown = (trial, participant, scenario) => {
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR') : '—')
  const turns = trial.conversationTurns ?? []
  const review = trial.operatorReview ?? {}
  const lines = []

  lines.push(`# Trial Log — ${trial.trialId}`)
  lines.push('')
  lines.push(`- **Session:** \`${trial.sessionId ?? '—'}\``)
  lines.push(`- **Participant:** ${participant?.participantId ?? '—'} (${participant?.ageRange ?? '—'} / ${participant?.drivingExperience ?? '—'})`)
  lines.push(`- **Scenario:** ${scenario?.scenarioName ?? trial.scenario?.scenarioName ?? '—'} (${scenario?.targetAffect ?? trial.scenario?.targetAffect ?? '—'} · \`${scenario?.scenarioId ?? trial.scenario?.scenarioId ?? '—'}\`)`)
  lines.push(`- **Status:** ${trial.status ?? '—'}${review.valid === false ? ' · ⚠️ invalid' : ''}`)
  lines.push(`- **Start:** ${fmt(trial.timing?.startTime)}`)
  lines.push(`- **End:** ${fmt(trial.timing?.endTime)}`)
  lines.push(`- **Turns:** ${turns.length}`)
  if (review.failureReason) lines.push(`- **Failure reason:** ${review.failureReason}`)
  lines.push('')

  lines.push('## Memo')
  lines.push('')
  lines.push(review.memo ? review.memo : '_(없음)_')
  lines.push('')

  if (scenario?.scenarioContext) {
    lines.push('## Scenario Context (prompt)')
    lines.push('')
    lines.push('> ' + scenario.scenarioContext.replace(/\n/g, '\n> '))
    lines.push('')
  }

  lines.push('## Conversation')
  lines.push('')
  if (turns.length === 0) {
    lines.push('_(기록된 대화 없음)_')
  } else {
    turns.forEach((t, i) => {
      const meta = [t.inputMethod, t.responseLatencyMs != null ? `${t.responseLatencyMs}ms` : null, t.status]
        .filter(Boolean)
        .join(' · ')
      lines.push(`### Turn ${i + 1} \`${t.turnId}\`${meta ? ` — ${meta}` : ''}`)
      lines.push(`- **User (raw):** ${t.userRawTranscript || '—'}`)
      if (t.userCorrectedTranscript) lines.push(`- **User (corrected):** ${t.userCorrectedTranscript}`)
      if (t.aiResponse) lines.push(`- **AI (actual):** ${t.aiResponse}`)
      if (t.aiIdealResponse) lines.push(`- **AI (ideal):** ${t.aiIdealResponse}`)
      if (t.ttsError) lines.push(`- **TTS error:** ${t.ttsError}`)
      if (t.error) lines.push(`- **Error:** ${t.error}`)
      lines.push('')
    })
  }

  if ((review.editHistory ?? []).length > 0) {
    lines.push('## Edit History')
    lines.push('')
    review.editHistory.forEach((e) => {
      lines.push(`- \`${new Date(e.timestamp).toLocaleTimeString('ko-KR')}\` **${e.field}**${e.turnId ? ` (${e.turnId})` : ''}: ${JSON.stringify(e.oldValue)} → ${JSON.stringify(e.newValue)}`)
    })
    lines.push('')
  }

  downloadBlob(lines.join('\n'), 'text/markdown', `trial_${trial.trialId}_${getDateStr()}.md`)
}

// ── Prompt-engineering dataset (corrected STT + ideal AI responses) ──
// Produces few-shot-ready examples to refine the Gemini system prompt.
export const exportPromptJSON = (trial, participant, scenario) => {
  const turns = trial.conversationTurns ?? []
  const examples = turns
    .filter((t) => t.userRawTranscript)
    .map((t) => {
      const user = t.userCorrectedTranscript || t.userRawTranscript
      const assistantIdeal = t.aiIdealResponse || t.aiResponse || ''
      return {
        turnId: t.turnId,
        inputMethod: t.inputMethod,
        user,
        userRaw: t.userRawTranscript,
        sttCorrected: Boolean(t.userCorrectedTranscript),
        assistantActual: t.aiResponse ?? '',
        assistantIdeal,
        responseEdited: Boolean(t.aiIdealResponse && t.aiIdealResponse !== t.aiResponse),
      }
    })

  const dataset = {
    exportedAt: new Date().toISOString(),
    purpose: 'gemini-prompt-engineering',
    scenario: {
      scenarioId: scenario?.scenarioId ?? trial.scenario?.scenarioId ?? null,
      scenarioName: scenario?.scenarioName ?? trial.scenario?.scenarioName ?? null,
      scenarioGroup: scenario?.scenarioGroup ?? trial.scenario?.scenarioGroup ?? null,
      targetAffect: scenario?.targetAffect ?? trial.scenario?.targetAffect ?? null,
      scenarioContext: scenario?.scenarioContext ?? null,
    },
    participant: {
      ageRange: participant?.ageRange ?? null,
      drivingExperience: participant?.drivingExperience ?? null,
    },
    trialId: trial.trialId,
    memo: trial.operatorReview?.memo ?? '',
    exampleCount: examples.length,
    examples,
  }

  downloadJSON(dataset, `prompt_${trial.trialId}_${getDateStr()}.json`)
}
