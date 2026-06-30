import { useState, useEffect, useRef } from 'react'
import { useExperiment } from '../context/ExperimentContext'
import { SCENARIOS, getScenarioById } from '../data/scenarios'
import * as sessionLogger from '../services/sessionLogger'

const FONT = "'Pretendard Variable', 'Pretendard', system-ui, sans-serif"

const AGE_RANGES = ['10대 이하', '20대', '30대', '40대', '50대', '60대 이상']
const DRIVING_EXP = ['무경험', '1년 미만', '1-3년', '3-10년', '10년 이상']
const TRIAL_STATUSES = [
  { value: 'completed', label: '완료' },
  { value: 'failed',    label: '실패' },
  { value: 'invalid',   label: '무효' },
  { value: 'aborted',   label: '중단' },
]
const STATUS_LABELS = { completed: '완료', failed: '실패', invalid: '무효', aborted: '중단' }

// ── Helper components ────────────────────────────────────────
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
  const variants = {
    primary:  'bg-[#2d7cf1] text-white hover:bg-[#1f6fe5]',
    accent:   'border border-[#2d7cf1] text-[#2d7cf1] bg-white hover:bg-blue-50',
    outline:  'border border-gray-200 text-gray-600 bg-white hover:bg-gray-50',
    ghost:    'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
    danger:   'bg-red-500 text-white hover:bg-red-600',
  }
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {children}
    </button>
  )
}

function PhaseTag({ phase }) {
  const cfg = {
    setup:        { label: '설정',     cls: 'bg-gray-100 text-gray-600' },
    trial_active: { label: '진행 중',   cls: 'bg-blue-100 text-blue-700' },
    review:       { label: '리뷰',     cls: 'bg-amber-100 text-amber-700' },
    saved:        { label: '저장 완료', cls: 'bg-green-100 text-green-700' },
  }[phase] ?? { label: phase, cls: 'bg-gray-100 text-gray-600' }
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.cls}`}>{cfg.label}</span>
}

function StatusBadge({ saveStatus }) {
  const pill = (on, onCls) =>
    `px-2.5 py-0.5 rounded-full border ${on ? onCls : 'border-gray-200 text-gray-300'}`
  return (
    <div className="flex items-center gap-2 text-xs">
      <span title="진행 중인 데이터가 브라우저에 자동 저장됩니다"
        className={pill(saveStatus.autosaved, 'border-blue-200 bg-blue-50 text-blue-600')}>
        {saveStatus.autosaved ? '자동 백업됨' : '자동 백업'}
      </span>
      <span title="참가자 데이터를 JSON으로 내보냈습니다"
        className={pill(saveStatus.exported, 'border-purple-200 bg-purple-50 text-purple-600')}>
        {saveStatus.exported ? '파일 내보냄 ✓' : '파일 내보내기'}
      </span>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-semibold text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  )
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[#2d7cf1] focus:outline-none'

// ── Main ─────────────────────────────────────────────────────
export default function OperatorConsole() {
  const exp = useExperiment()
  const {
    currentParticipant, currentTrial, liveConversationTurns,
    experimentPhase, activeScenario, saveStatus, nextParticipantId,
    startTrial, endTrial, doFinalSave, addAnotherTrial, startNewParticipant,
    initializeHMI, markExported, setScenario, resetHmi, discardSession,
  } = exp

  // Setup form state
  const [mode, setMode] = useState('experiment') // 'experiment' | 'dev'
  const [ageRange, setAgeRange] = useState(AGE_RANGES[1])
  const [drivingExperience, setDrivingExperience] = useState(DRIVING_EXP[2])
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].scenarioId)

  // Trial-active state
  const [elapsed, setElapsed] = useState(0)
  const [memo, setMemo] = useState('')
  const memoRef = useRef('')

  // End-trial modal state
  const [showEndModal, setShowEndModal] = useState(false)
  const [endStatus, setEndStatus] = useState('completed')
  const [endReason, setEndReason] = useState('')

  // Review form state
  const [reviewForm, setReviewForm] = useState({
    trialStatus: 'completed', valid: true, ageRange: '', drivingExperience: '',
    scenarioId: '', memo: '', failureReason: '',
  })
  const editHistoryRef = useRef([])

  // ── Hotkeys: Alt+Q / Alt+W / Alt+R ─────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'q') { e.preventDefault(); setScenario('frustration_roundabout_loop') }
      else if (k === 'w') { e.preventDefault(); setScenario('anxiety_hydroplaning') }
      else if (k === 'r') { e.preventDefault(); resetHmi() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setScenario, resetHmi])

  // ── Trial-active elapsed timer ─────────────────────────────
  useEffect(() => {
    if (experimentPhase !== 'trial_active' || !currentTrial?.timing?.startTime) return
    const start = new Date(currentTrial.timing.startTime).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [experimentPhase, currentTrial?.timing?.startTime])

  // ── Sync review form when entering review phase ────────────
  useEffect(() => {
    if (experimentPhase === 'review' && currentTrial) {
      setReviewForm({
        trialStatus: currentTrial.status === 'active' ? 'completed' : currentTrial.status,
        valid: currentTrial.operatorReview?.valid ?? true,
        ageRange: currentParticipant?.ageRange ?? '',
        drivingExperience: currentParticipant?.drivingExperience ?? '',
        scenarioId: currentTrial.scenario?.scenarioId ?? '',
        memo: memoRef.current,
        failureReason: currentTrial.operatorReview?.failureReason ?? '',
      })
      editHistoryRef.current = []
    }
  }, [experimentPhase, currentTrial, currentParticipant])

  const updateReview = (field, value, turnId = null) => {
    setReviewForm((prev) => {
      const oldValue = prev[field]
      if (oldValue !== value) {
        editHistoryRef.current.push({ timestamp: new Date().toISOString(), field, turnId, oldValue, newValue: value })
      }
      return { ...prev, [field]: value }
    })
  }

  const handleStartTrial = () => {
    if (mode === 'dev') {
      startTrial({ scenarioId, dev: true })
    } else {
      startTrial({ ageRange, drivingExperience, scenarioId })
    }
    setMemo('')
    memoRef.current = ''
  }

  const handleEndTrial = () => {
    memoRef.current = memo
    endTrial(endStatus, endReason)
    setShowEndModal(false)
  }

  const handleFinalSave = () => {
    const result = doFinalSave(reviewForm, editHistoryRef.current)
    if (!result.success) alert(result.error || '저장 실패')
  }

  const handleExportParticipantJSON = () => {
    if (sessionLogger.exportParticipantJSON(currentParticipant?.participantId)) markExported()
  }
  const handleExportMarkdown = () => {
    const scenario = getScenarioById(currentTrial?.scenario?.scenarioId)
    sessionLogger.exportTrialMarkdown(currentTrial, currentParticipant, scenario)
  }
  const handleExportDebugJSON = () => sessionLogger.exportTrialDebugJSON(currentTrial)

  const fmtElapsed = (s) => {
    const m = Math.floor(s / 60), r = s % 60
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  }

  return (
    <div style={{ fontFamily: FONT }} className="min-h-screen bg-gray-50 text-gray-800">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-base font-semibold text-gray-800">Operator Console</h1>
            <PhaseTag phase={experimentPhase} />
            {currentParticipant?.dev && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-orange-100 text-orange-700">DEV</span>
            )}
            {currentParticipant && (
              <span className="text-xs text-gray-500">참가자 <span className="font-mono font-semibold text-gray-700">{currentParticipant.participantId}</span></span>
            )}
            {currentTrial && (
              <span className="text-xs text-gray-500">시험 <span className="font-mono font-semibold text-gray-700">{currentTrial.trialId}</span></span>
            )}
          </div>
          <StatusBadge saveStatus={saveStatus} />
        </div>

        {/* Scenario hotkey control bar */}
        <div className="max-w-5xl mx-auto px-6 py-2 border-t border-gray-100 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-gray-400 font-semibold uppercase tracking-wide mr-2">HMI 시나리오</span>
          <Btn size="sm" variant={activeScenario?.scenarioId === 'frustration_roundabout_loop' ? 'primary' : 'outline'}
            onClick={() => setScenario('frustration_roundabout_loop')}>
            Alt+Q · 교차로 반복
          </Btn>
          <Btn size="sm" variant={activeScenario?.scenarioId === 'anxiety_hydroplaning' ? 'primary' : 'outline'}
            onClick={() => setScenario('anxiety_hydroplaning')}>
            Alt+W · 수막현상
          </Btn>
          <Btn size="sm" variant="ghost" onClick={resetHmi}>Alt+R · 리셋</Btn>
          <div className="ml-auto">
            <Btn size="sm" variant="ghost" onClick={initializeHMI}>HMI 초기화</Btn>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {/* ── SETUP phase ──────────────────────────────────── */}
        {experimentPhase === 'setup' && (
          <>
            <SectionCard title="모드">
              <div className="flex gap-2">
                <Btn variant={mode === 'experiment' ? 'primary' : 'outline'} onClick={() => setMode('experiment')}>실험 (데이터 저장)</Btn>
                <Btn variant={mode === 'dev' ? 'primary' : 'outline'} onClick={() => setMode('dev')}>프롬프트 개발 (저장 안 함)</Btn>
              </div>
            </SectionCard>

            {mode === 'experiment' && (
              <SectionCard title="참가자 정보">
                <div className="text-xs text-gray-500 mb-3">
                  다음 참가자 ID: <span className="font-mono font-semibold text-gray-700">{currentParticipant?.participantId ?? nextParticipantId}</span>
                </div>
                <Field label="연령대">
                  <select className={inputCls} value={ageRange} onChange={(e) => setAgeRange(e.target.value)}
                    disabled={!!currentParticipant && !currentParticipant.dev}>
                    {AGE_RANGES.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="운전 경력">
                  <select className={inputCls} value={drivingExperience} onChange={(e) => setDrivingExperience(e.target.value)}
                    disabled={!!currentParticipant && !currentParticipant.dev}>
                    {DRIVING_EXP.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              </SectionCard>
            )}

            <SectionCard title="시나리오">
              <Field label="시나리오 선택">
                <select className={inputCls} value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                  {SCENARIOS.map((s) => (
                    <option key={s.scenarioId} value={s.scenarioId}>{s.scenarioName} ({s.targetAffect})</option>
                  ))}
                </select>
              </Field>
              <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3 mt-2 whitespace-pre-line">
                {getScenarioById(scenarioId)?.scenarioContext}
              </div>
            </SectionCard>

            <div className="flex gap-2 justify-end">
              {currentParticipant && (
                <Btn variant="ghost" onClick={discardSession}>참가자 폐기</Btn>
              )}
              <Btn variant="primary" size="lg" onClick={handleStartTrial}>시험 시작 →</Btn>
            </div>
          </>
        )}

        {/* ── TRIAL_ACTIVE phase ──────────────────────────────── */}
        {experimentPhase === 'trial_active' && currentTrial && (
          <>
            <SectionCard>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">진행 중</div>
                  <div className="text-lg font-semibold text-gray-800 mt-1">
                    {currentTrial.scenario?.scenarioName} <span className="text-xs text-gray-400 font-normal">({currentTrial.scenario?.targetAffect})</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400">경과 시간</div>
                  <div className="text-2xl font-mono font-semibold text-[#2d7cf1] tabular-nums">{fmtElapsed(elapsed)}</div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="실시간 메모">
              <textarea
                className={`${inputCls} min-h-[140px] resize-y leading-relaxed`}
                value={memo}
                onChange={(e) => { setMemo(e.target.value); memoRef.current = e.target.value }}
                placeholder="관찰 사항, 특이점, 참가자 반응 등을 자유롭게 메모하세요."
              />
            </SectionCard>

            {liveConversationTurns.length > 0 && (
              <SectionCard title={`대화 (${liveConversationTurns.length})`}>
                <div className="space-y-2">
                  {liveConversationTurns.map((t) => (
                    <div key={t.turnId} className="text-xs text-gray-600 border border-gray-100 rounded p-2 bg-gray-50">
                      <div className="font-mono text-gray-400">{t.turnId} · {t.status}</div>
                      <div>U: {t.userRawTranscript || '—'}</div>
                      {t.aiResponse && <div>A: {t.aiResponse}</div>}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            <div className="flex gap-2 justify-end">
              <Btn variant="danger" onClick={() => { setEndStatus('completed'); setEndReason(''); setShowEndModal(true) }}>
                시험 종료 →
              </Btn>
            </div>
          </>
        )}

        {/* ── REVIEW phase ────────────────────────────────────── */}
        {experimentPhase === 'review' && currentTrial && (
          <>
            <SectionCard title="시험 정보 리뷰">
              <Field label="상태">
                <select className={inputCls} value={reviewForm.trialStatus}
                  onChange={(e) => updateReview('trialStatus', e.target.value)}>
                  {TRIAL_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="시나리오">
                <select className={inputCls} value={reviewForm.scenarioId}
                  onChange={(e) => updateReview('scenarioId', e.target.value)}>
                  {SCENARIOS.map((s) => <option key={s.scenarioId} value={s.scenarioId}>{s.scenarioName}</option>)}
                </select>
              </Field>
              <Field label="연령대">
                <select className={inputCls} value={reviewForm.ageRange}
                  onChange={(e) => updateReview('ageRange', e.target.value)}>
                  {AGE_RANGES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </Field>
              <Field label="운전 경력">
                <select className={inputCls} value={reviewForm.drivingExperience}
                  onChange={(e) => updateReview('drivingExperience', e.target.value)}>
                  {DRIVING_EXP.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-2 mb-3">
                <input type="checkbox" checked={reviewForm.valid}
                  onChange={(e) => updateReview('valid', e.target.checked)} />
                <span className="text-sm">데이터 유효</span>
              </label>
              <Field label="메모">
                <textarea className={`${inputCls} min-h-[100px] resize-y`} value={reviewForm.memo}
                  onChange={(e) => updateReview('memo', e.target.value)} />
              </Field>
              <Field label="실패 사유 (해당 시)">
                <input className={inputCls} value={reviewForm.failureReason}
                  onChange={(e) => updateReview('failureReason', e.target.value)} />
              </Field>
            </SectionCard>

            {editHistoryRef.current.length > 0 && (
              <SectionCard title={`수정 이력 (${editHistoryRef.current.length})`}>
                <div className="space-y-1 max-h-40 overflow-y-auto text-xs text-gray-500">
                  {editHistoryRef.current.map((e, i) => (
                    <div key={i} className="font-mono">
                      {new Date(e.timestamp).toLocaleTimeString('ko-KR')} · {e.field}: {JSON.stringify(e.oldValue)} → {JSON.stringify(e.newValue)}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            <div className="flex gap-2 justify-end flex-wrap">
              <Btn variant="outline" onClick={handleExportMarkdown}>Markdown 내보내기</Btn>
              <Btn variant="outline" onClick={handleExportDebugJSON}>Debug JSON 내보내기</Btn>
              {currentTrial.dev ? (
                <Btn variant="danger" onClick={discardSession}>개발 세션 종료</Btn>
              ) : (
                <Btn variant="primary" size="lg" onClick={handleFinalSave}>최종 저장 ✓</Btn>
              )}
            </div>
          </>
        )}

        {/* ── SAVED phase ─────────────────────────────────────── */}
        {experimentPhase === 'saved' && currentTrial && currentParticipant && (
          <>
            <SectionCard>
              <div className="text-center py-4">
                <div className="text-3xl mb-2">✓</div>
                <h2 className="text-lg font-semibold text-gray-800">저장 완료</h2>
                <div className="text-sm text-gray-500 mt-2 space-y-0.5">
                  <div>참가자 <span className="font-mono font-semibold">{currentParticipant.participantId}</span> · {currentParticipant.ageRange} · {currentParticipant.drivingExperience}</div>
                  <div>시험 <span className="font-mono font-semibold">{currentTrial.trialId}</span> · {currentTrial.scenario?.scenarioName} · {STATUS_LABELS[currentTrial.status] ?? currentTrial.status}</div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="내보내기">
              <div className="flex gap-2 flex-wrap">
                <Btn variant="accent" onClick={handleExportParticipantJSON}>참가자 JSON</Btn>
                <Btn variant="outline" onClick={handleExportMarkdown}>시험 Markdown</Btn>
                <Btn variant="outline" onClick={handleExportDebugJSON}>Debug JSON</Btn>
              </div>
            </SectionCard>

            <div className="flex gap-2 justify-end">
              <Btn variant="outline" onClick={addAnotherTrial}>같은 참가자 · 시험 추가</Btn>
              <Btn variant="primary" onClick={startNewParticipant}>다음 참가자 →</Btn>
            </div>
          </>
        )}
      </div>

      {/* ── End-trial modal ─────────────────────────────────── */}
      {showEndModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setShowEndModal(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-4">시험 종료</h3>
            <Field label="종료 상태">
              <select className={inputCls} value={endStatus} onChange={(e) => setEndStatus(e.target.value)}>
                {TRIAL_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            {endStatus !== 'completed' && (
              <Field label="사유">
                <input className={inputCls} value={endReason} onChange={(e) => setEndReason(e.target.value)}
                  placeholder="간단히 사유를 적어주세요" />
              </Field>
            )}
            <div className="flex gap-2 justify-end mt-4">
              <Btn variant="ghost" onClick={() => setShowEndModal(false)}>취소</Btn>
              <Btn variant="danger" onClick={handleEndTrial}>종료</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
