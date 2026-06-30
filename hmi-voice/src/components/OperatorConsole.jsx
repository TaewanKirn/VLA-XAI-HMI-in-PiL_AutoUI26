import { useState, useEffect, useRef } from 'react'
import { useExperiment } from '../context/ExperimentContext'
import { SCENARIOS, getScenarioById } from '../data/scenarios'
import * as sessionLogger from '../services/sessionLogger'
import { contributeExamples } from '../services/promptExamples'
import { isSupabaseEnabled } from '../services/supabase'
import PromptEditor from './PromptEditor'
import { getPhases } from '../data/drivePhases'

const FONT = "'Pretendard Variable', 'Pretendard', system-ui, sans-serif"

// ── Option data ───────────────────────────────────────────────
const AGE_RANGES = ['10대 이하', '20대', '30대', '40대', '50대', '60대 이상']
const DRIVING_EXP = ['무경험', '1년 미만', '1-3년', '3-10년', '10년 이상']
const TRIAL_STATUSES = [
  { value: 'completed', label: '완료', color: 'text-gray-700' },
  { value: 'failed',    label: '실패', color: 'text-red-600' },
  { value: 'invalid',   label: '무효', color: 'text-gray-500' },
  { value: 'aborted',   label: '중단', color: 'text-gray-500' },
]

const STATUS_LABELS = { completed: '완료', failed: '실패', invalid: '무효', aborted: '중단' }

// ── Helper components ─────────────────────────────────────────

// Data-safety indicators. Workflow stage (incl. final-save) is shown by the
// PhaseTag, so this badge only carries the two signals the phase doesn't:
//   • 자동 백업 — live session is mirrored to localStorage (survives refresh)
//   • 내보냄   — a participant JSON file was downloaded to disk
function StatusBadge({ saveStatus }) {
  const pill = (on, onText, offText, onCls) =>
    `px-2.5 py-0.5 rounded-full border ${on ? onCls : 'border-gray-200 text-gray-300'}`
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        title="진행 중인 대화가 브라우저에 자동 저장됩니다. 새로고침해도 복구돼요."
        className={pill(saveStatus.autosaved, null, null, 'border-blue-200 bg-blue-50 text-blue-600')}
      >
        {saveStatus.autosaved ? '자동 백업됨' : '자동 백업'}
      </span>
      <span
        title="참가자 데이터를 JSON 파일로 내보냈습니다."
        className={pill(saveStatus.exported, null, null, 'border-purple-200 bg-purple-50 text-purple-600')}
      >
        {saveStatus.exported ? '파일 내보냄 ✓' : '파일 내보내기'}
      </span>
    </div>
  )
}

function SectionCard({ title, children }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 mb-4 bg-white">
      {title && <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{title}</h3>}
      {children}
    </div>
  )
}

function Btn({ onClick, disabled, variant = 'primary', size = 'md', title, children }) {
  const base = 'rounded-lg font-medium transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed'
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' }
  // Hierarchy via the HMI key color (#2d7cf1):
  //   primary  — filled key   → THE main action of a screen / selected toggle
  //   accent   — key outline  → notable secondary / forward navigation
  //   outline  — neutral      → supporting actions
  //   ghost    — text only    → minor / utility
  //   danger   — red          → destructive
  const variants = {
    primary:  'bg-[#2d7cf1] text-white hover:bg-[#1f6fe5] disabled:hover:bg-[#2d7cf1]',
    accent:   'border border-[#2d7cf1] text-[#2d7cf1] bg-white hover:bg-blue-50',
    outline:  'border border-gray-200 text-gray-600 bg-white hover:bg-gray-50',
    ghost:    'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
    danger:   'bg-red-500 text-white hover:bg-red-600 disabled:hover:bg-red-500',
    // legacy aliases (kept so older call sites don't break)
    success:  'bg-[#2d7cf1] text-white hover:bg-[#1f6fe5] disabled:hover:bg-[#2d7cf1]',
    warning:  'border border-gray-200 text-gray-600 bg-white hover:bg-gray-50',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${sizes[size]} ${variants[variant]}`}
    >
      {children}
    </button>
  )
}

function TurnStatusDot({ status }) {
  const colors = {
    pending:   'bg-yellow-400',
    completed: 'bg-green-500',
    failed:    'bg-red-500',
  }
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? 'bg-gray-300'} mr-1.5 flex-shrink-0`}
    />
  )
}

function ElapsedTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startTime) return
    const update = () => {
      setElapsed(Math.floor((Date.now() - new Date(startTime).getTime()) / 1000))
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startTime])

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return <span className="font-mono text-sm text-gray-600">{mm}:{ss}</span>
}

// ── Main Component ────────────────────────────────────────────

export default function OperatorConsole() {
  const {
    currentParticipant,
    currentTrial,
    liveConversationTurns,
    experimentPhase,
    saveStatus,
    nextParticipantId,
    activeScenario,
    currentPhase,
    startTrial,
    endTrial,
    doFinalSave,
    addAnotherTrial,
    startNewParticipant,
    markExported,
    setScenario,
    setPhase,
    resetHmi,
    discardSession,
  } = useExperiment()

  // Prompt-development mode: no real participant, contributions go to the
  // prompt pool only (nothing saved to the participant dataset).
  const [mode, setMode] = useState('experiment') // 'experiment' | 'dev'
  const isDev = currentTrial?.dev || currentParticipant?.dev

  // ── Setup form ────────────────────────────────────────────
  const [setupForm, setSetupForm] = useState({
    ageRange: '',
    drivingExperience: '',
    scenarioId: '',
  })

  // Pre-fill ageRange/drivingExp when returning to setup for same participant
  useEffect(() => {
    if (experimentPhase === 'setup' && currentParticipant) {
      setSetupForm((prev) => ({
        ...prev,
        ageRange: currentParticipant.ageRange ?? '',
        drivingExperience: currentParticipant.drivingExperience ?? '',
        scenarioId: prev.scenarioId, // keep last selected scenario
      }))
    }
    if (experimentPhase === 'setup' && !currentParticipant) {
      setSetupForm({ ageRange: '', drivingExperience: '', scenarioId: '' })
    }
  }, [experimentPhase, currentParticipant])

  // ── End trial modal ───────────────────────────────────────
  const [endModal, setEndModal] = useState({ open: false, status: 'completed', failureReason: '' })

  // ── Mid-experiment memo (editable during the active trial) ──
  const [liveMemo, setLiveMemo] = useState('')
  useEffect(() => {
    // Reset the running memo when starting a fresh participant/trial setup.
    if (experimentPhase === 'setup') setLiveMemo('')
  }, [experimentPhase])

  // ── Review form ───────────────────────────────────────────
  const [reviewForm, setReviewForm] = useState({
    ageRange: '',
    drivingExperience: '',
    scenarioId: '',
    trialStatus: 'completed',
    memo: '',
    valid: true,
    failureReason: '',
    correctedTranscripts: {},
    correctedResponses: {},
  })
  const [editHistory, setEditHistory] = useState([])
  const prevReviewRef = useRef({})

  // Init review form when entering review phase
  useEffect(() => {
    if (experimentPhase !== 'review') return
    const resolvedStatus = currentTrial?.status === 'active'
      ? 'completed'
      : (currentTrial?.status ?? 'completed')
    // valid mirrors status: only completed → true; failed/invalid/aborted → false
    const derivedValid = resolvedStatus === 'completed'
    const form = {
      ageRange: currentParticipant?.ageRange ?? '',
      drivingExperience: currentParticipant?.drivingExperience ?? '',
      scenarioId: currentTrial?.scenario?.scenarioId ?? '',
      trialStatus: resolvedStatus,
      // Carry the mid-experiment memo into the review memo.
      memo: currentTrial?.operatorReview?.memo || liveMemo,
      valid: derivedValid,
      failureReason: currentTrial?.operatorReview?.failureReason ?? '',
      correctedTranscripts: {},
      correctedResponses: {},
    }
    setReviewForm(form)
    prevReviewRef.current = form
    setEditHistory([])
  }, [experimentPhase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Record an edit, coalescing a continuous typing burst on the same
  // field/turn into a single history entry (keep the original oldValue,
  // update newValue) instead of one entry per keystroke.
  const recordEdit = (field, turnId, oldValue, newValue) => {
    setEditHistory((prev) => {
      const ts = new Date().toISOString()
      const last = prev[prev.length - 1]
      if (last && last.field === field && last.turnId === turnId) {
        const updated = prev.slice()
        updated[updated.length - 1] = { ...last, newValue, timestamp: ts }
        return updated
      }
      const entry = { timestamp: ts, field, oldValue, newValue }
      if (turnId) entry.turnId = turnId
      return [...prev, entry]
    })
  }

  const updateReviewField = (field, newValue) => {
    const oldValue = reviewForm[field]
    if (oldValue === newValue) return
    setReviewForm((prev) => ({ ...prev, [field]: newValue }))
    recordEdit(field, undefined, oldValue, newValue)
  }

  const updateCorrectedTranscript = (turnId, newValue) => {
    const oldValue = reviewForm.correctedTranscripts[turnId] ?? null
    if (oldValue === newValue) return
    setReviewForm((prev) => ({
      ...prev,
      correctedTranscripts: { ...prev.correctedTranscripts, [turnId]: newValue },
    }))
    recordEdit('userCorrectedTranscript', turnId, oldValue, newValue)
  }

  const updateCorrectedResponse = (turnId, newValue) => {
    const oldValue = reviewForm.correctedResponses[turnId] ?? null
    if (oldValue === newValue) return
    setReviewForm((prev) => ({
      ...prev,
      correctedResponses: { ...prev.correctedResponses, [turnId]: newValue },
    }))
    recordEdit('aiIdealResponse', turnId, oldValue, newValue)
  }

  // Build conversation turns enriched with operator corrections.
  const buildEnrichedTurns = () =>
    liveConversationTurns.map((t) => ({
      ...t,
      userCorrectedTranscript: reviewForm.correctedTranscripts?.[t.turnId] ?? null,
      aiIdealResponse: reviewForm.correctedResponses?.[t.turnId] ?? null,
    }))

  const buildEnrichedTrial = () => ({
    ...currentTrial,
    status: reviewForm.trialStatus ?? currentTrial?.status,
    conversationTurns: buildEnrichedTurns(),
    operatorReview: {
      ...(currentTrial?.operatorReview ?? {}),
      valid: reviewForm.valid,
      memo: reviewForm.memo,
      failureReason: reviewForm.failureReason,
      editHistory,
    },
  })

  const reviewParticipant = {
    participantId: currentParticipant?.participantId,
    ageRange: reviewForm.ageRange || currentParticipant?.ageRange,
    drivingExperience: reviewForm.drivingExperience || currentParticipant?.drivingExperience,
  }

  // ── Derived display info ──────────────────────────────────
  const displayParticipantId = currentParticipant?.participantId ?? nextParticipantId
  const displayTrialId = currentTrial
    ? currentTrial.trialId
    : currentParticipant
    ? sessionLogger.generateNextTrialId(currentParticipant.participantId)
    : `${nextParticipantId}_T001`

  // ── Handlers ──────────────────────────────────────────────

  const handleStartTrial = () => {
    const { ageRange, drivingExperience, scenarioId } = setupForm
    if (mode === 'dev') {
      if (!scenarioId) {
        alert('시나리오를 선택해주세요.')
        return
      }
      startTrial({ scenarioId, dev: true })
      return
    }
    if (!ageRange || !drivingExperience || !scenarioId) {
      alert('나이대, 운전경험, 시나리오를 모두 선택해주세요.')
      return
    }
    startTrial({ ageRange, drivingExperience, scenarioId })
  }

  const handleEndTrialConfirm = () => {
    endTrial(endModal.status, endModal.failureReason)
    setEndModal({ open: false, status: 'completed', failureReason: '' })
  }

  const handleFinalSave = () => {
    const result = doFinalSave(reviewForm, editHistory)
    if (!result.success) {
      alert(`저장 실패: ${result.error}`)
    }
  }

  const handleExport = () => {
    const pid = currentParticipant?.participantId
    if (!pid) return
    const ok = sessionLogger.exportParticipantJSON(pid)
    if (ok) markExported()
    else alert('저장된 데이터가 없습니다. Final Save를 먼저 완료하세요.')
  }

  const handleDebugExport = () => {
    if (!currentTrial) return
    sessionLogger.exportTrialDebugJSON(buildEnrichedTrial())
  }

  const handleExportMarkdown = () => {
    if (!currentTrial) return
    const scenario = getScenarioById(reviewForm.scenarioId) ?? getScenarioById(currentTrial?.scenario?.scenarioId)
    sessionLogger.exportTrialMarkdown(buildEnrichedTrial(), reviewParticipant, scenario)
  }

  const handleExportPrompt = () => {
    if (!currentTrial) return
    const scenario = getScenarioById(reviewForm.scenarioId) ?? getScenarioById(currentTrial?.scenario?.scenarioId)
    sessionLogger.exportPromptJSON(buildEnrichedTrial(), reviewParticipant, scenario)
  }

  // Push operator-corrected (user → ideal AI) pairs to Supabase so they feed
  // the dynamic few-shot loop for future Gemini responses.
  const [contributeMsg, setContributeMsg] = useState('')
  const handleContribute = async () => {
    const scenario = getScenarioById(reviewForm.scenarioId) ?? getScenarioById(currentTrial?.scenario?.scenarioId)
    const rows = buildEnrichedTurns()
      .filter((t) => t.aiIdealResponse && (t.userCorrectedTranscript || t.userRawTranscript))
      .map((t) => ({
        scenario_id: scenario?.scenarioId ?? null,
        target_affect: scenario?.targetAffect ?? null,
        user_input: t.userCorrectedTranscript || t.userRawTranscript,
        ideal_response: t.aiIdealResponse,
        actual_response: t.aiResponse ?? null,
      }))

    if (rows.length === 0) {
      setContributeMsg('기여할 항목이 없습니다 — 턴별 "AI 응답 보정"을 먼저 입력하세요.')
      return
    }
    setContributeMsg('업로드 중…')
    const result = await contributeExamples(rows)
    if (result.success) setContributeMsg(`✓ ${result.count}개 예시를 프롬프트 풀에 반영했습니다.`)
    else if (result.skipped) setContributeMsg('Supabase 미설정 — .env에 URL/KEY를 추가하세요.')
    else setContributeMsg(`실패: ${result.error}`)
  }

  const handleAddAnotherTrial = () => {
    if (!saveStatus.finalSaved) {
      alert('Add Another Trial은 Final Save 완료 후에만 사용할 수 있습니다.')
      return
    }
    addAnotherTrial()
  }

  const handleStartNewParticipant = () => {
    if (!saveStatus.finalSaved && currentTrial) {
      const ok = window.confirm(
        '현재 Trial이 아직 저장되지 않았습니다.\n저장하지 않고 새 참가자로 넘어가면 데이터가 유실됩니다.\n계속하시겠습니까?'
      )
      if (!ok) return
    }
    startNewParticipant()
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ fontFamily: FONT }}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-y-2 sticky top-0 z-10">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-base font-bold text-gray-800 tracking-tight">오퍼레이터 콘솔</h1>
          <span className="text-xs text-gray-400 font-mono border border-gray-200 rounded px-2 py-0.5">
            {displayParticipantId}
            {currentTrial ? ` / ${currentTrial.trialId}` : ''}
          </span>
          <PhaseTag phase={experimentPhase} />
          {isDev && (
            <span
              title="프롬프트 개발 세션 — 참가자 데이터로 저장되지 않습니다."
              className="text-xs font-semibold rounded px-2 py-0.5 bg-purple-100 text-purple-700"
            >
              개발 모드
            </span>
          )}
        </div>
        <StatusBadge saveStatus={saveStatus} />
      </header>

      <main className="flex-1 w-full max-w-3xl xl:max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

        {/* ── HMI scenario control (mirrors Alt+Q / Alt+W / Alt+R) ── */}
        <SectionCard title="HMI 상황 제어">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 mr-2">
              <span className="text-xs text-gray-500">현재 상황</span>
              <span
                className={`text-sm font-semibold px-2.5 py-1 rounded ${
                  activeScenario
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {activeScenario ? activeScenario.scenarioName : '없음 (대기)'}
              </span>
            </div>
            <Btn
              size="sm"
              variant={activeScenario?.scenarioId === 'frustration_roundabout_loop' ? 'primary' : 'outline'}
              onClick={() => setScenario('frustration_roundabout_loop')}
            >
              회전교차로 (Alt+Q)
            </Btn>
            <Btn
              size="sm"
              variant={activeScenario?.scenarioId === 'anxiety_hydroplaning' ? 'primary' : 'outline'}
              onClick={() => setScenario('anxiety_hydroplaning')}
            >
              수막현상 (Alt+W)
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              onClick={resetHmi}
              title="참가자 화면(HMI)을 대기 화면으로 되돌리고 시나리오를 해제합니다. 저장된 기록에는 영향 없음."
            >
              상황 초기화 (Alt+R)
            </Btn>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            HMI 화면과 실시간 동기화됩니다. 초기화 시 참가자 화면의 대화가 비워집니다.
          </p>
        </SectionCard>

        {/* ── Drive phase panel ─────────────────────────────────── */}
        {/* sequence.md 시퀀스 — 시나리오마다 페이즈 개수가 다름 (C1=9, C2=13). */}
        {/* 페이즈별 음성 발화는 HMI에서 TTS로 재생됨 (채팅 미게시). */}
        {/* HMI 단축키: Ctrl+→ 다음 페이즈, Ctrl+← 이전 페이즈. */}
        {(() => {
          const phases = getPhases(activeScenario?.scenarioId)
          const total = phases.length
          const cur = phases[currentPhase - 1]
          return (
            <SectionCard title={`주행 시퀀스 (drive.md${activeScenario ? ` · ${activeScenario.scenarioName}` : ''})`}>
              {/* Current-position banner — large, sequential read */}
              <div
                className={`mb-3 p-3 rounded-lg border ${
                  cur
                    ? cur.status?.tone === 'warning'
                      ? 'bg-orange-50 border-orange-200'
                      : 'bg-blue-50 border-blue-200'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-xs uppercase tracking-wider text-gray-500">현재 시퀀스</span>
                  <span
                    className={`text-lg font-bold tabular-nums ${
                      cur ? 'text-gray-900' : 'text-gray-400'
                    }`}
                  >
                    {total
                      ? `${currentPhase || 0} / ${total}`
                      : '시나리오 미선택'}
                  </span>
                  {cur?.status && (
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        cur.status.tone === 'warning'
                          ? 'bg-orange-200 text-orange-800'
                          : 'bg-green-200 text-green-800'
                      }`}
                    >
                      {cur.status.tone === 'warning' ? '경고' : '정상'} · {cur.status.text}
                    </span>
                  )}
                </div>
                {cur && (
                  <div className="mt-2 text-sm leading-snug">
                    {cur.speech
                      ? <div className="text-gray-700">🔊 {cur.speech}</div>
                      : <div className="text-gray-400">음성 안내 없음 (무음 페이즈)</div>}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Btn size="sm" variant="ghost" onClick={() => setPhase(0)} disabled={!total}>해제</Btn>
                <Btn
                  size="sm" variant="outline"
                  onClick={() => setPhase(Math.max(0, currentPhase - 1))}
                  disabled={!total || currentPhase <= 0}
                  title="이전 페이즈로 (Ctrl+←)"
                >← 이전</Btn>
                <Btn
                  size="sm" variant="accent"
                  onClick={() => setPhase(Math.min(total, (currentPhase || 0) + 1))}
                  disabled={!total || currentPhase >= total}
                  title="다음 페이즈로 (Ctrl+→)"
                >다음 →</Btn>
              </div>

              {/* Per-phase list — vertical so each judgment is fully readable.
                  Active row gets a colored ring; warning phases tint the row. */}
              <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                {total === 0 && (
                  <div className="px-3 py-4 text-xs text-gray-400">
                    시나리오를 선택하면 페이즈 시퀀스가 표시됩니다.
                  </div>
                )}
                {phases.map((p) => {
                  const active = currentPhase === p.phase
                  const warn   = p.status?.tone === 'warning'
                  return (
                    <button
                      key={p.phase}
                      onClick={() => setPhase(p.phase)}
                      className={`w-full text-left px-3 py-2 transition-colors flex items-start gap-3 ${
                        active
                          ? warn
                            ? 'bg-orange-100'
                            : 'bg-blue-100'
                          : warn
                            ? 'bg-orange-50/40 hover:bg-orange-50'
                            : 'bg-white hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className={`shrink-0 w-7 text-xs font-bold tabular-nums pt-0.5 ${
                          active ? 'text-gray-900' : 'text-gray-400'
                        }`}
                      >
                        {p.phase}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              warn
                                ? 'bg-orange-200 text-orange-800'
                                : 'bg-green-200 text-green-800'
                            }`}
                          >
                            {p.status?.text}
                          </span>
                        </div>
                        {p.speech
                          ? <div className="text-xs text-gray-700 leading-snug mt-1">🔊 {p.speech}</div>
                          : <div className="text-xs text-gray-400 leading-snug mt-1">— 음성 안내 없음</div>}
                      </div>
                    </button>
                  )
                })}
              </div>

              <p className="text-xs text-gray-400 mt-2">
                HMI 단축키: <code className="bg-gray-100 px-1 rounded">Ctrl+→</code> 다음 · <code className="bg-gray-100 px-1 rounded">Ctrl+←</code> 이전. 현재 페이즈가 화면 메인 텍스트(타이핑) + 좌상단 알림 + Gemini 프롬프트에 동시에 반영됩니다.
              </p>
            </SectionCard>
          )
        })()}

        {/* ── Prompt editor (persona + scenario context → Supabase, live) ── */}
        <PromptEditor />

        {/* ── SETUP phase ────────────────────────────────── */}
        {experimentPhase === 'setup' && (
          <>
            <SectionCard title="모드">
              <div className="flex bg-gray-100 rounded-lg p-1 max-w-xs">
                {[
                  { k: 'experiment', label: '실험' },
                  { k: 'dev', label: '프롬프트 개발' },
                ].map((m) => (
                  <button
                    key={m.k}
                    onClick={() => setMode(m.k)}
                    className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      mode === m.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {mode === 'dev' && (
                <p className="text-xs text-gray-400 mt-2">
                  참가자 정보 없이 시나리오만으로 진행합니다. 데이터는 저장되지 않고,
                  보정한 답변을 <b>프롬프트 풀(Supabase)</b>에만 기여합니다.
                </p>
              )}
            </SectionCard>

            {mode === 'experiment' && (
              <SectionCard title="참가자 정보">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">참가자 번호</label>
                    <div className="text-sm font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2 inline-block">
                      {displayParticipantId}
                      <span className="ml-2 text-xs font-normal text-blue-400">
                        (다음 시험: {displayTrialId})
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">나이대</label>
                      <select
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                        value={setupForm.ageRange}
                        disabled={!!currentParticipant}
                        onChange={(e) => setSetupForm((p) => ({ ...p, ageRange: e.target.value }))}
                      >
                        <option value="">선택</option>
                        {AGE_RANGES.map((v) => <option key={v}>{v}</option>)}
                      </select>
                      {currentParticipant && (
                        <p className="text-xs text-gray-400 mt-1">동일 참가자 — 수정 불가</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">운전경험</label>
                      <select
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                        value={setupForm.drivingExperience}
                        disabled={!!currentParticipant}
                        onChange={(e) => setSetupForm((p) => ({ ...p, drivingExperience: e.target.value }))}
                      >
                        <option value="">선택</option>
                        {DRIVING_EXP.map((v) => <option key={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </SectionCard>
            )}

            <SectionCard title="시나리오">
              <select
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                value={setupForm.scenarioId}
                onChange={(e) => setSetupForm((p) => ({ ...p, scenarioId: e.target.value }))}
              >
                <option value="">선택</option>
                {SCENARIOS.map((s) => (
                  <option key={s.scenarioId} value={s.scenarioId}>
                    {s.scenarioName} ({s.targetAffect})
                  </option>
                ))}
              </select>
            </SectionCard>

            <div className="flex gap-2">
              <Btn
                onClick={handleStartTrial}
                variant="primary"
                size="lg"
                title={mode === 'dev'
                  ? '참가자 없이 시나리오만으로 개발 세션을 시작합니다.'
                  : '입력한 참가자 정보와 시나리오로 새 시험을 시작하고 대화 기록을 켭니다.'}
              >
                {mode === 'dev' ? '개발 세션 시작' : '시험 시작'}
              </Btn>
            </div>
          </>
        )}

        {/* ── TRIAL_ACTIVE phase ──────────────────────────── */}
        {experimentPhase === 'trial_active' && (
          <>
            <SectionCard title="진행 중">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-gray-800">
                    {currentTrial?.trialId}
                    <span className="ml-3 text-xs font-normal text-gray-400">
                      {currentTrial?.scenario?.scenarioName} · {currentTrial?.scenario?.targetAffect}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {currentParticipant?.ageRange} · {currentParticipant?.drivingExperience}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400 mb-0.5">경과 시간</div>
                  <ElapsedTimer startTime={currentTrial?.timing?.startTime} />
                </div>
              </div>
            </SectionCard>

            <SectionCard title={`대화 로그 (${liveConversationTurns.length}턴)`}>
              {liveConversationTurns.length === 0 ? (
                <p className="text-xs text-gray-400">아직 대화가 없습니다.</p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {liveConversationTurns.map((t) => (
                    <TurnRow key={t.turnId} turn={t} />
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="실시간 메모">
              <textarea
                rows={3}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
                placeholder="실험 진행 중 관찰 내용을 메모하세요. 종료 후 Review 메모로 이어집니다."
                value={liveMemo}
                onChange={(e) => setLiveMemo(e.target.value)}
              />
            </SectionCard>

            <div className="flex gap-2">
              <Btn
                onClick={() => setEndModal({ open: true, status: 'completed', failureReason: '' })}
                variant="danger"
                size="lg"
                title="진행 중인 시험을 끝내고 검토 단계로 넘어갑니다. 참가자 화면은 초기화됩니다."
              >
                시험 종료
              </Btn>
            </div>

            {/* End Trial modal */}
            {endModal.open && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl shadow-xl p-6 w-80">
                  <h2 className="text-base font-bold text-gray-800 mb-4">Trial 종료 — 상태 선택</h2>
                  <div className="space-y-2 mb-4">
                    {TRIAL_STATUSES.map((s) => (
                      <label key={s.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="trialStatus"
                          value={s.value}
                          checked={endModal.status === s.value}
                          onChange={() => setEndModal((p) => ({ ...p, status: s.value }))}
                        />
                        <span className={`text-sm font-medium ${s.color}`}>{s.label}</span>
                      </label>
                    ))}
                  </div>
                  {endModal.status !== 'completed' && (
                    <div className="mb-4">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        사유 (선택)
                      </label>
                      <textarea
                        rows={2}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
                        placeholder="실패/중단 사유를 입력하세요"
                        value={endModal.failureReason}
                        onChange={(e) => setEndModal((p) => ({ ...p, failureReason: e.target.value }))}
                      />
                    </div>
                  )}
                  <div className="flex gap-2 justify-end">
                    <Btn
                      onClick={() => setEndModal({ open: false, status: 'completed', failureReason: '' })}
                      variant="ghost"
                    >
                      취소
                    </Btn>
                    <Btn onClick={handleEndTrialConfirm} variant="danger">
                      종료 확정
                    </Btn>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── REVIEW phase ────────────────────────────────── */}
        {experimentPhase === 'review' && (
          <>
            <SectionCard title="Review / Edit">
              <div className="space-y-3">
                {/* Trial status (editable if was active) */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Trial 상태</label>
                  <select
                    className="border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                    value={reviewForm.trialStatus}
                    onChange={(e) => updateReviewField('trialStatus', e.target.value)}
                  >
                    {TRIAL_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">나이대</label>
                    <select
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                      value={reviewForm.ageRange}
                      onChange={(e) => updateReviewField('ageRange', e.target.value)}
                    >
                      {AGE_RANGES.map((v) => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">운전경험</label>
                    <select
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                      value={reviewForm.drivingExperience}
                      onChange={(e) => updateReviewField('drivingExperience', e.target.value)}
                    >
                      {DRIVING_EXP.map((v) => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">시나리오</label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                    value={reviewForm.scenarioId}
                    onChange={(e) => updateReviewField('scenarioId', e.target.value)}
                  >
                    {SCENARIOS.map((s) => (
                      <option key={s.scenarioId} value={s.scenarioId}>
                        {s.scenarioName} ({s.targetAffect})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="valid"
                    checked={reviewForm.valid}
                    onChange={(e) => updateReviewField('valid', e.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <label htmlFor="valid" className="text-sm text-gray-700">
                    유효한 Trial (분석에 포함)
                  </label>
                </div>

                {reviewForm.trialStatus !== 'completed' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      실패/중단 사유
                    </label>
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                      placeholder="사유를 입력하세요 (선택)"
                      value={reviewForm.failureReason}
                      onChange={(e) => updateReviewField('failureReason', e.target.value)}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">메모</label>
                  <textarea
                    rows={3}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none"
                    placeholder="관찰 내용, 특이사항 등"
                    value={reviewForm.memo}
                    onChange={(e) => updateReviewField('memo', e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            {/* Conversation Turns Review */}
            <SectionCard title={`대화 로그 검토 (${liveConversationTurns.length}턴)`}>
              {liveConversationTurns.length === 0 ? (
                <p className="text-xs text-gray-400">기록된 대화가 없습니다.</p>
              ) : (
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                  {liveConversationTurns.map((turn) => (
                    <div key={turn.turnId} className="border border-gray-100 rounded-lg p-3 bg-gray-50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <TurnStatusDot status={turn.status} />
                          <span className="text-xs font-mono text-gray-400">{turn.turnId}</span>
                          <span className="text-xs text-gray-400">· {turn.inputMethod}</span>
                          {turn.responseLatencyMs != null && (
                            <span className="text-xs text-gray-400">· {turn.responseLatencyMs}ms</span>
                          )}
                          {turn.ttsPlayed && <span className="text-xs text-green-500 ml-1">TTS ✓</span>}
                          {turn.ttsError && (
                            <span className="text-xs text-red-500 ml-1">TTS ✗</span>
                          )}
                        </div>
                        <span className="text-xs text-gray-300 font-mono">
                          {turn.userTimestamp ? new Date(turn.userTimestamp).toLocaleTimeString('ko-KR') : ''}
                        </span>
                      </div>

                      {/* User utterance (read-only) */}
                      <div className="mb-2">
                        <div className="text-xs text-gray-400 mb-0.5">User (원본 — 수정불가)</div>
                        <div className="text-sm text-gray-800 bg-white border border-gray-200 rounded px-3 py-2">
                          {turn.userRawTranscript || <em className="text-gray-300">없음</em>}
                        </div>
                      </div>

                      {/* STT correction */}
                      <div className="mb-2">
                        <div className="text-xs text-gray-400 mb-0.5">STT 보정 (correctedTranscript)</div>
                        <input
                          type="text"
                          className="w-full border border-dashed border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
                          placeholder="STT 오류가 있으면 여기에 보정된 텍스트를 입력"
                          value={reviewForm.correctedTranscripts[turn.turnId] ?? ''}
                          onChange={(e) => updateCorrectedTranscript(turn.turnId, e.target.value)}
                        />
                      </div>

                      {/* AI response (read-only original) */}
                      {turn.aiResponse && (
                        <div className="mb-2">
                          <div className="text-xs text-gray-400 mb-0.5">AI 응답 (원본 — 수정불가)</div>
                          <div className="text-sm text-gray-700 bg-blue-50 border border-blue-100 rounded px-3 py-2">
                            {turn.aiResponse}
                          </div>
                        </div>
                      )}

                      {/* Ideal AI response (editable — feeds prompt engineering) */}
                      <div>
                        <div className="text-xs text-gray-400 mb-0.5">AI 응답 보정 (이상적 답변 — 프롬프트 엔지니어링용)</div>
                        <textarea
                          rows={2}
                          className="w-full border border-dashed border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white resize-none"
                          placeholder="이 상황에서 이상적인 AI 답변을 입력하면 프롬프트 개선 데이터로 내보내집니다"
                          value={reviewForm.correctedResponses[turn.turnId] ?? ''}
                          onChange={(e) => updateCorrectedResponse(turn.turnId, e.target.value)}
                        />
                      </div>

                      {/* Error info */}
                      {turn.status === 'failed' && turn.error && (
                        <div className="mt-2 text-xs text-red-500 bg-red-50 rounded px-2 py-1">
                          오류: {turn.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Edit history summary */}
            {editHistory.length > 0 && (
              <SectionCard title={`수정 이력 (${editHistory.length}건)`}>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {editHistory.map((entry, i) => (
                    <div key={i} className="text-xs text-gray-500 font-mono">
                      [{new Date(entry.timestamp).toLocaleTimeString('ko-KR')}] {entry.field}
                      {entry.turnId ? ` (${entry.turnId})` : ''}: {JSON.stringify(entry.oldValue)} → {JSON.stringify(entry.newValue)}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {isDev && (
              <p className="text-xs text-purple-600 bg-purple-50 border border-purple-100 rounded-lg px-3 py-2 mb-3">
                개발 세션입니다. 참가자 데이터로 저장되지 않습니다. 턴별 “AI 응답 보정”을 입력하고
                <b> 프롬프트 풀에 기여</b>로 반영하세요.
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              {!isDev && (
                <Btn
                  onClick={handleFinalSave}
                  variant="primary"
                  size="lg"
                  disabled={saveStatus.finalSaved}
                  title="검토·보정한 내용을 이 참가자 기록에 확정 저장합니다."
                >
                  {saveStatus.finalSaved ? '저장됨' : '최종 저장'}
                </Btn>
              )}
              <Btn
                onClick={handleContribute}
                variant={isDev ? 'primary' : 'accent'}
                size={isDev ? 'lg' : 'md'}
                disabled={!isSupabaseEnabled}
                title="보정한 예시를 Supabase 프롬프트 풀에 올립니다. 이후 같은 시나리오 답변에 자동 반영됩니다."
              >
                프롬프트 풀에 기여
              </Btn>
              <Btn
                onClick={handleExportMarkdown}
                variant="outline"
                size="md"
                title="이번 시험의 전체 내용(메모·대화·보정·수정 이력)을 읽기 좋은 Markdown 문서로 내려받습니다."
              >
                시험 로그 (.md)
              </Btn>
              <Btn
                onClick={handleExportPrompt}
                variant="outline"
                size="md"
                title="보정한 사용자 발화와 이상적 AI 답변을 Gemini 프롬프트 개선용 예시 JSON으로 내려받습니다."
              >
                프롬프트 예시 (.json)
              </Btn>
              <Btn
                onClick={handleDebugExport}
                variant="ghost"
                size="md"
                title="현재 데이터 원본(JSON)을 개발·디버깅용으로 내려받습니다."
              >
                디버그 JSON
              </Btn>
              {isDev && (
                <Btn
                  onClick={discardSession}
                  variant="ghost"
                  size="md"
                  title="개발 세션을 종료하고 설정 화면으로 돌아갑니다. (저장 안 함)"
                >
                  개발 세션 종료
                </Btn>
              )}
            </div>
            {contributeMsg && (
              <p className="text-xs text-gray-500 mt-2">{contributeMsg}</p>
            )}
            {!isSupabaseEnabled && (
              <p className="text-xs text-gray-400 mt-1">
                Supabase 연결 시 보정 예시가 누적되어 이후 AI 응답에 자동 반영됩니다.
              </p>
            )}
          </>
        )}

        {/* ── SAVED phase ─────────────────────────────────── */}
        {experimentPhase === 'saved' && (
          <>
            <SectionCard title="저장 완료">
              <div className="mb-3">
                <div className="text-sm font-semibold text-gray-800">
                  {currentTrial?.trialId} 시험이 저장되었습니다
                </div>
                <div className="text-xs text-gray-400 font-mono mt-0.5">{currentTrial?.sessionId}</div>
              </div>
              <StatusBadge saveStatus={saveStatus} />
            </SectionCard>

            {/* Summary */}
            <SectionCard title="시험 요약">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-gray-400 text-xs">참가자</span><br />{currentParticipant?.participantId}</div>
                <div><span className="text-gray-400 text-xs">시험 번호</span><br />{currentTrial?.trialId}</div>
                <div><span className="text-gray-400 text-xs">시나리오</span><br />{currentTrial?.scenario?.scenarioName}</div>
                <div><span className="text-gray-400 text-xs">상태</span><br />
                  <span className="text-gray-700">
                    {STATUS_LABELS[currentTrial?.status] ?? currentTrial?.status}
                  </span>
                </div>
                <div><span className="text-gray-400 text-xs">대화 턴</span><br />{liveConversationTurns.length}턴</div>
                <div>
                  <span className="text-gray-400 text-xs">나이대 / 경험</span><br />
                  {currentParticipant?.ageRange} / {currentParticipant?.drivingExperience}
                </div>
              </div>
            </SectionCard>

            <div className="flex gap-2 flex-wrap mb-6">
              <Btn
                onClick={handleExport}
                variant="primary"
                size="lg"
                title="이 참가자의 전체 기록을 JSON 파일로 내려받습니다."
              >
                참가자 데이터 (.json)
              </Btn>
              <Btn
                onClick={handleExportMarkdown}
                variant="outline"
                size="md"
                title="이번 시험 내용을 읽기 좋은 Markdown 문서로 내려받습니다."
              >
                시험 로그 (.md)
              </Btn>
              <Btn
                onClick={handleExportPrompt}
                variant="outline"
                size="md"
                title="보정한 발화·이상적 답변을 프롬프트 개선용 예시 JSON으로 내려받습니다."
              >
                프롬프트 예시 (.json)
              </Btn>
              <Btn
                onClick={handleDebugExport}
                variant="ghost"
                size="md"
                title="시험 데이터 원본(JSON)을 개발·디버깅용으로 내려받습니다."
              >
                디버그 JSON
              </Btn>
            </div>

            <div className="border-t border-gray-200 pt-4 flex gap-2 flex-wrap">
              <Btn
                onClick={handleStartNewParticipant}
                variant="primary"
                size="md"
                title="현재 참가자를 마치고 다음 참가자 설정 화면으로 넘어갑니다."
              >
                다음 참가자
              </Btn>
              <Btn
                onClick={handleAddAnotherTrial}
                variant="accent"
                size="md"
                disabled={!saveStatus.finalSaved}
                title="같은 참가자로 다음 시험을 이어서 진행합니다."
              >
                같은 참가자 · 시험 추가
              </Btn>
            </div>
          </>
        )}

      </main>

      {/* Footer info */}
      <footer className="border-t border-gray-200 bg-white px-6 py-2 text-xs text-gray-400 flex gap-4">
        <span>저장된 참가자 {sessionLogger.getAllSessions().length}명</span>
        <span>·</span>
        <span>
          이번 시험 {liveConversationTurns.length}턴
          {liveConversationTurns.filter(t => t.status === 'pending').length > 0 &&
            ` (대기 ${liveConversationTurns.filter(t => t.status === 'pending').length})`}
        </span>
      </footer>
    </div>
  )
}

// ── TurnRow (used in ACTIVE view) ─────────────────────────────
function TurnRow({ turn }) {
  return (
    <div className="text-xs border-l-2 pl-2 border-gray-200">
      <div className="flex items-center gap-1.5 mb-0.5">
        <TurnStatusDot status={turn.status} />
        <span className="font-mono text-gray-400">{turn.turnId}</span>
        {turn.responseLatencyMs != null && (
          <span className="text-gray-300">· {turn.responseLatencyMs}ms</span>
        )}
        {turn.ttsPlayed && <span className="text-green-400 ml-1">TTS✓</span>}
      </div>
      <div className="text-gray-700 mb-0.5">
        <span className="text-gray-400">U: </span>{turn.userRawTranscript}
      </div>
      {turn.aiResponse && (
        <div className="text-blue-600">
          <span className="text-gray-400">A: </span>{turn.aiResponse}
        </div>
      )}
      {turn.status === 'failed' && turn.error && (
        <div className="text-red-500">오류: {turn.error}</div>
      )}
    </div>
  )
}

// ── PhaseTag ─────────────────────────────────────────────────
// Workflow stage of the current trial.
function PhaseTag({ phase }) {
  const map = {
    setup:        { label: '준비',      bg: 'bg-gray-100 text-gray-600',  tip: '참가자 정보·시나리오를 설정하고 Trial을 시작하세요.' },
    trial_active: { label: '진행 중',   bg: 'bg-green-100 text-green-700', tip: '실험 진행 중 — 대화가 실시간으로 기록됩니다.' },
    review:       { label: '검토',      bg: 'bg-amber-100 text-amber-700', tip: 'STT/AI 응답 보정·메모를 입력하고 Final Save 하세요.' },
    saved:        { label: '저장 완료', bg: 'bg-blue-100 text-blue-700',  tip: '이 Trial이 저장소에 확정 저장되었습니다.' },
  }
  const { label = phase, bg = 'bg-gray-100 text-gray-600', tip = '' } = map[phase] ?? {}
  return (
    <span title={tip} className={`text-xs font-semibold rounded px-2 py-0.5 ${bg}`}>{label}</span>
  )
}
