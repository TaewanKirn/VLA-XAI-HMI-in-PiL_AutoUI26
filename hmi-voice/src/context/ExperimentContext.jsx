import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import * as sessionLogger from '../services/sessionLogger'
import { getScenarioById } from '../data/scenarios'

const CHANNEL_NAME = 'exp_channel'

// ── BroadcastChannel message types ──────────────────────────
export const BC = {
  START_TRIAL:       'START_TRIAL',
  END_TRIAL:         'END_TRIAL',
  INITIALIZE_HMI:    'INITIALIZE_HMI',
  TURN_CREATED:      'TURN_CREATED',
  TURN_UPDATED:      'TURN_UPDATED',
  SET_SCENARIO:      'SET_SCENARIO',   // operator/HMI set current scenario
  SET_PHASE:         'SET_PHASE',      // operator/HMI advance drive phase (1..10)
  RESET_HMI:         'RESET_HMI',      // wipe HMI chat/popups back to idle
}

const ExperimentContext = createContext(null)

export function ExperimentProvider({ children }) {
  // ── Restore from localStorage on mount ──────────────────
  const [currentParticipant, setCurrentParticipant] = useState(
    () => sessionLogger.getCurrentParticipant()
  )
  const [currentTrial, setCurrentTrial] = useState(
    () => sessionLogger.getCurrentTrial()
  )
  const [liveConversationTurns, setLiveConversationTurns] = useState(
    () => sessionLogger.getCurrentTurns()
  )
  const [experimentPhase, setExperimentPhase] = useState(() => {
    const trial = sessionLogger.getCurrentTrial()
    if (!trial) return 'setup'
    if (trial.status === 'active') return 'trial_active'
    return 'review'
  })
  const [activeScenario, setActiveScenario] = useState(() => {
    const trial = sessionLogger.getCurrentTrial()
    return trial?.scenario?.scenarioId
      ? getScenarioById(trial.scenario.scenarioId)
      : null
  })
  const [saveStatus, setSaveStatus] = useState({
    autosaved: false,
    finalSaved: false,
    exported: false,
  })
  // Preview of the next participant ID (re-derived after commitParticipant)
  const [nextParticipantId, setNextParticipantId] = useState(
    () => sessionLogger.generateNextParticipantId()
  )
  // Bumped to signal the HMI to wipe its chat/popups back to the idle screen.
  const [hmiResetNonce, setHmiResetNonce] = useState(0)
  // Current driving phase (1..10 per drive.md, 0 = none/pre-drive). Synced
  // across windows so the operator console can advance it while the HMI
  // window reads it from the same source for the Gemini call.
  const [currentPhase, setCurrentPhase] = useState(0)

  // ── Refs (stable across renders, not reactive) ───────────
  const channelRef = useRef(null)
  const turnCounterRef = useRef(sessionLogger.getCurrentTurns().length)
  const currentTrialRef = useRef(currentTrial)
  const liveConversationTurnsRef = useRef(liveConversationTurns)

  useEffect(() => { currentTrialRef.current = currentTrial }, [currentTrial])
  useEffect(() => { liveConversationTurnsRef.current = liveConversationTurns }, [liveConversationTurns])

  // ── BroadcastChannel setup ───────────────────────────────
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = channel

    channel.onmessage = ({ data }) => {
      const { type, payload = {} } = data

      switch (type) {
        case BC.START_TRIAL: {
          const scenario = getScenarioById(payload.scenarioId)
          setActiveScenario(scenario)
          setCurrentTrial(payload.trial)
          sessionLogger.saveCurrentTrial(payload.trial)
          setLiveConversationTurns([])
          sessionLogger.saveCurrentTurns([])
          turnCounterRef.current = 0
          setExperimentPhase('trial_active')
          setSaveStatus({ autosaved: false, finalSaved: false, exported: false })
          setCurrentPhase(0)
          break
        }
        case BC.END_TRIAL: {
          setCurrentTrial((prev) => {
            if (!prev) return prev
            const updated = {
              ...prev,
              status: payload.status,
              timing: { ...prev.timing, endTime: payload.endTime },
              operatorReview: {
                ...prev.operatorReview,
                failureReason: payload.failureReason ?? '',
              },
            }
            sessionLogger.saveCurrentTrial(updated)
            return updated
          })
          setExperimentPhase('review')
          // Trial ended → wipe the participant HMI back to the idle screen.
          setHmiResetNonce((n) => n + 1)
          break
        }
        case BC.INITIALIZE_HMI: {
          setLiveConversationTurns([])
          setCurrentTrial(null)
          setActiveScenario(null)
          setExperimentPhase('setup')
          setSaveStatus({ autosaved: false, finalSaved: false, exported: false })
          turnCounterRef.current = 0
          sessionLogger.clearCurrentSession()
          setHmiResetNonce((n) => n + 1)
          setCurrentPhase(0)
          break
        }
        case BC.SET_SCENARIO: {
          setActiveScenario(payload.scenarioId ? getScenarioById(payload.scenarioId) : null)
          setCurrentPhase(0)
          break
        }
        case BC.SET_PHASE: {
          const next = Number.isInteger(payload.phase)
            ? Math.max(0, Math.min(10, payload.phase))
            : 0
          setCurrentPhase(next)
          break
        }
        case BC.RESET_HMI: {
          setActiveScenario(null)
          setHmiResetNonce((n) => n + 1)
          setCurrentPhase(0)
          break
        }
        case BC.TURN_CREATED: {
          setLiveConversationTurns((prev) => {
            const updated = [...prev, payload.turn]
            liveConversationTurnsRef.current = updated
            return updated
          })
          setSaveStatus((prev) => ({ ...prev, autosaved: true }))
          break
        }
        case BC.TURN_UPDATED: {
          setLiveConversationTurns((prev) => {
            const updated = prev.map((t) =>
              t.turnId === payload.turnId ? { ...t, ...payload.updates } : t
            )
            liveConversationTurnsRef.current = updated
            return updated
          })
          break
        }
        default:
          break
      }
    }

    return () => channel.close()
  }, [])

  const broadcast = useCallback((type, payload = {}) => {
    channelRef.current?.postMessage({ type, payload })
  }, [])

  // ── Operator: start trial ────────────────────────────────
  // dev=true → prompt-development session: no real participant, no counters,
  // never persisted to the participant store. Only used to drive the HMI and
  // contribute corrected examples to the Supabase prompt pool.
  const startTrial = useCallback(
    ({ ageRange, drivingExperience, scenarioId, dev = false }) => {
      const scenario = getScenarioById(scenarioId)
      const now = new Date().toISOString()

      if (dev) {
        const participant = { participantId: 'DEV', ageRange: null, drivingExperience: null, dev: true }
        setCurrentParticipant(participant)
        sessionLogger.saveCurrentParticipant(participant)

        const trial = {
          trialId: `DEV_T${Date.now().toString().slice(-6)}`,
          sessionId: `DEV_${now}`,
          dev: true,
          scenario: {
            scenarioId: scenario.scenarioId,
            scenarioName: scenario.scenarioName,
            scenarioGroup: scenario.scenarioGroup,
            targetAffect: scenario.targetAffect,
          },
          status: 'active',
          timing: { startTime: now, endTime: null },
          conversationTurns: [],
          operatorReview: { valid: false, memo: '', failureReason: '', editHistory: [] },
        }
        setCurrentTrial(trial)
        setActiveScenario(scenario)
        setLiveConversationTurns([])
        turnCounterRef.current = 0
        setExperimentPhase('trial_active')
        setSaveStatus({ autosaved: false, finalSaved: false, exported: false })
        sessionLogger.saveCurrentTrial(trial)
        sessionLogger.saveCurrentTurns([])
        broadcast(BC.START_TRIAL, { trial, scenarioId, scenarioContext: scenario.scenarioContext })
        return
      }

      const participantId = currentParticipant?.participantId ?? nextParticipantId

      // Resolve or create participant
      let participant = currentParticipant
      if (!participant) {
        participant = { participantId, ageRange, drivingExperience }
        setCurrentParticipant(participant)
        sessionLogger.saveCurrentParticipant(participant)
      }

      // Generate trial ID before committing
      const trialId = sessionLogger.generateNextTrialId(participantId)
      sessionLogger.commitTrial(participantId)

      const sessionId = sessionLogger.generateSessionId(participantId, trialId)

      const trial = {
        trialId,
        sessionId,
        scenario: {
          scenarioId: scenario.scenarioId,
          scenarioName: scenario.scenarioName,
          scenarioGroup: scenario.scenarioGroup,
          targetAffect: scenario.targetAffect,
        },
        status: 'active',
        timing: { startTime: now, endTime: null },
        conversationTurns: [],
        operatorReview: {
          valid: true,
          memo: '',
          failureReason: '',
          editHistory: [],
        },
      }

      setCurrentTrial(trial)
      setActiveScenario(scenario)
      setLiveConversationTurns([])
      turnCounterRef.current = 0
      setExperimentPhase('trial_active')
      setSaveStatus({ autosaved: false, finalSaved: false, exported: false })

      sessionLogger.saveCurrentTrial(trial)
      sessionLogger.saveCurrentTurns([])

      broadcast(BC.START_TRIAL, {
        trial,
        scenarioId,
        scenarioContext: scenario.scenarioContext,
      })
    },
    [currentParticipant, nextParticipantId, broadcast]
  )

  // ── Operator: end trial with status ─────────────────────
  // status: 'completed' | 'failed' | 'invalid' | 'aborted'
  // valid defaults to true only for completed; all other statuses default false
  const endTrial = useCallback(
    (status = 'completed', failureReason = '') => {
      const endTime = new Date().toISOString()
      const defaultValid = status === 'completed'
      setCurrentTrial((prev) => {
        if (!prev) return prev
        const updated = {
          ...prev,
          status,
          timing: { ...prev.timing, endTime },
          operatorReview: { ...prev.operatorReview, failureReason, valid: defaultValid },
        }
        sessionLogger.saveCurrentTrial(updated)
        return updated
      })
      setExperimentPhase('review')
      broadcast(BC.END_TRIAL, { status, endTime, failureReason })
    },
    [broadcast]
  )

  // ── Operator: final save (idempotent) ────────────────────
  const doFinalSave = useCallback(
    (reviewForm, editHistory) => {
      const participant = currentParticipant
      const trial = currentTrialRef.current
      if (!participant || !trial) return { success: false, error: 'No active session' }
      // Dev sessions are never persisted to the participant store.
      if (trial.dev) return { success: false, error: '개발 세션은 저장하지 않습니다. 프롬프트 풀에 기여만 가능합니다.' }

      const turns = liveConversationTurnsRef.current.map((t) => ({
        ...t,
        userCorrectedTranscript: reviewForm.correctedTranscripts?.[t.turnId] ?? null,
        aiIdealResponse: reviewForm.correctedResponses?.[t.turnId] ?? null,
      }))

      const resolvedScenario = getScenarioById(reviewForm.scenarioId)

      const savedTrial = {
        ...trial,
        scenario: resolvedScenario
          ? {
              scenarioId: resolvedScenario.scenarioId,
              scenarioName: resolvedScenario.scenarioName,
              scenarioGroup: resolvedScenario.scenarioGroup,
              targetAffect: resolvedScenario.targetAffect,
            }
          : trial.scenario,
        status:
          trial.status === 'active'
            ? reviewForm.trialStatus ?? 'completed'
            : trial.status,
        conversationTurns: turns,
        operatorReview: {
          valid: reviewForm.valid,
          memo: reviewForm.memo,
          failureReason: reviewForm.failureReason,
          editHistory,
        },
      }

      const participantData = {
        participantId: participant.participantId,
        participant: {
          ageRange: reviewForm.ageRange ?? participant.ageRange,
          drivingExperience:
            reviewForm.drivingExperience ?? participant.drivingExperience,
        },
        trials: [savedTrial],
      }

      const result = sessionLogger.saveParticipantSession(participantData)

      if (result.success) {
        setSaveStatus((prev) => ({ ...prev, finalSaved: true }))
        setExperimentPhase('saved')
        // Update currentParticipant to reflect any edits
        setCurrentParticipant((prev) => ({
          ...prev,
          ageRange: participantData.participant.ageRange,
          drivingExperience: participantData.participant.drivingExperience,
        }))
      }

      return result
    },
    [currentParticipant]
  )

  // ── Operator: add another trial (same participant) ───────
  const addAnotherTrial = useCallback(() => {
    setCurrentTrial(null)
    setLiveConversationTurns([])
    turnCounterRef.current = 0
    setExperimentPhase('setup')
    setSaveStatus({ autosaved: false, finalSaved: false, exported: false })
    sessionLogger.clearCurrentSession()
  }, [])

  // ── Operator: start new participant ─────────────────────
  const startNewParticipant = useCallback(() => {
    sessionLogger.commitParticipant()
    const newId = sessionLogger.generateNextParticipantId()
    setNextParticipantId(newId)
    setCurrentParticipant(null)
    setCurrentTrial(null)
    setLiveConversationTurns([])
    setActiveScenario(null)
    turnCounterRef.current = 0
    setExperimentPhase('setup')
    setSaveStatus({ autosaved: false, finalSaved: false, exported: false })
    sessionLogger.clearCurrentSession()
    localStorage.removeItem('exp_current_participant')
  }, [])

  // ── Operator: initialize HMI display ────────────────────
  const initializeHMI = useCallback(() => {
    setActiveScenario(null)
    setCurrentPhase(0)
    setHmiResetNonce((n) => n + 1)
    broadcast(BC.INITIALIZE_HMI)
  }, [broadcast])

  // ── Discard current session (dev session end / abort) ───
  // Clears everything back to a clean setup without saving. Counters untouched.
  const discardSession = useCallback(() => {
    setCurrentTrial(null)
    setCurrentParticipant(null)
    setLiveConversationTurns([])
    setActiveScenario(null)
    setCurrentPhase(0)
    turnCounterRef.current = 0
    setExperimentPhase('setup')
    setSaveStatus({ autosaved: false, finalSaved: false, exported: false })
    sessionLogger.clearCurrentSession()
    localStorage.removeItem('exp_current_participant')
    setHmiResetNonce((n) => n + 1)
    broadcast(BC.RESET_HMI)
  }, [broadcast])

  // ── Scenario control (mirrors HMI Alt+Q / Alt+W) ─────────
  // Works from either window; both stay in sync via BroadcastChannel.
  const setScenario = useCallback(
    (scenarioId) => {
      setActiveScenario(scenarioId ? getScenarioById(scenarioId) : null)
      setCurrentPhase(0)
      broadcast(BC.SET_SCENARIO, { scenarioId: scenarioId ?? null })
    },
    [broadcast]
  )

  // ── Driving-phase control (1..13 per sequence.md; 0 = none) ─
  // Operator advances this via Ctrl+→ / Ctrl+← on the HMI, or the Operator
  // Console phase panel. Synced across windows. Upper bound covers the longest
  // sequence (C2 수막현상 = 13 phases).
  const setPhase = useCallback(
    (phase) => {
      const next = Number.isInteger(phase) ? Math.max(0, Math.min(13, phase)) : 0
      setCurrentPhase(next)
      broadcast(BC.SET_PHASE, { phase: next })
    },
    [broadcast]
  )

  // ── Reset HMI to idle (mirrors HMI Alt+R) ────────────────
  const resetHmi = useCallback(() => {
    setActiveScenario(null)
    setCurrentPhase(0)
    setHmiResetNonce((n) => n + 1)
    broadcast(BC.RESET_HMI)
  }, [broadcast])

  // ── Operator: mark exported ──────────────────────────────
  const markExported = useCallback(() => {
    setSaveStatus((prev) => ({ ...prev, exported: true }))
  }, [])

  // ── HMI: add pending turn (returns turnId synchronously) ─
  const addPendingTurn = useCallback(
    ({ userRawTranscript, userTimestamp, inputMethod }) => {
      if (currentTrialRef.current?.status !== 'active') return null

      turnCounterRef.current += 1
      const turnId = `turn-${String(turnCounterRef.current).padStart(3, '0')}`

      const turn = {
        turnId,
        status: 'pending',
        userRawTranscript,
        userCorrectedTranscript: null,
        userTimestamp,
        inputMethod,
        aiResponse: null,
        aiTimestamp: null,
        responseLatencyMs: null,
        ttsPlayed: false,
        ttsError: null,
        error: null,
      }

      setLiveConversationTurns((prev) => {
        const updated = [...prev, turn]
        sessionLogger.saveCurrentTurns(updated)
        liveConversationTurnsRef.current = updated
        return updated
      })
      setSaveStatus((prev) => ({ ...prev, autosaved: true }))
      broadcast(BC.TURN_CREATED, { turn })

      return turnId
    },
    [broadcast]
  )

  // ── HMI: complete turn with AI response ─────────────────
  const completeTurn = useCallback(
    (turnId, { aiResponse, aiTimestamp, responseLatencyMs }) => {
      const updates = { aiResponse, aiTimestamp, responseLatencyMs, status: 'completed' }
      setLiveConversationTurns((prev) => {
        const updated = prev.map((t) =>
          t.turnId === turnId ? { ...t, ...updates } : t
        )
        sessionLogger.saveCurrentTurns(updated)
        liveConversationTurnsRef.current = updated
        return updated
      })
      setSaveStatus((prev) => ({ ...prev, autosaved: true }))
      broadcast(BC.TURN_UPDATED, { turnId, updates })
    },
    [broadcast]
  )

  // ── HMI: fail turn (Gemini error) ───────────────────────
  const failTurn = useCallback(
    (turnId, error) => {
      const updates = { error, status: 'failed' }
      setLiveConversationTurns((prev) => {
        const updated = prev.map((t) =>
          t.turnId === turnId ? { ...t, ...updates } : t
        )
        sessionLogger.saveCurrentTurns(updated)
        liveConversationTurnsRef.current = updated
        return updated
      })
      broadcast(BC.TURN_UPDATED, { turnId, updates })
    },
    [broadcast]
  )

  // ── HMI: mark TTS played ─────────────────────────────────
  const markTtsPlayed = useCallback(
    (turnId) => {
      const updates = { ttsPlayed: true }
      setLiveConversationTurns((prev) => {
        const updated = prev.map((t) =>
          t.turnId === turnId ? { ...t, ...updates } : t
        )
        sessionLogger.saveCurrentTurns(updated)
        liveConversationTurnsRef.current = updated
        return updated
      })
      broadcast(BC.TURN_UPDATED, { turnId, updates })
    },
    [broadcast]
  )

  // ── HMI: mark TTS error ──────────────────────────────────
  const markTtsError = useCallback(
    (turnId, ttsError) => {
      const updates = { ttsError }
      setLiveConversationTurns((prev) => {
        const updated = prev.map((t) =>
          t.turnId === turnId ? { ...t, ...updates } : t
        )
        sessionLogger.saveCurrentTurns(updated)
        liveConversationTurnsRef.current = updated
        return updated
      })
      broadcast(BC.TURN_UPDATED, { turnId, updates })
    },
    [broadcast]
  )

  const value = {
    // State
    currentParticipant,
    currentTrial,
    liveConversationTurns,
    experimentPhase,
    activeScenario,
    saveStatus,
    nextParticipantId,
    hmiResetNonce,
    currentPhase,
    // Operator functions
    startTrial,
    endTrial,
    doFinalSave,
    addAnotherTrial,
    startNewParticipant,
    initializeHMI,
    markExported,
    setScenario,
    setPhase,
    resetHmi,
    discardSession,
    // HMI logging functions
    addPendingTurn,
    completeTurn,
    failTurn,
    markTtsPlayed,
    markTtsError,
  }

  return (
    <ExperimentContext.Provider value={value}>
      {children}
    </ExperimentContext.Provider>
  )
}

export const useExperiment = () => {
  const ctx = useContext(ExperimentContext)
  if (!ctx) throw new Error('useExperiment must be used inside ExperimentProvider')
  return ctx
}
