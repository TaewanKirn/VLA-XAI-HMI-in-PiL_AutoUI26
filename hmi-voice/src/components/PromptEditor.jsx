import { useState, useEffect, useCallback } from 'react'
import { SCENARIOS } from '../data/scenarios'
import { isSupabaseEnabled } from '../services/supabase'
import {
  PROMPT_KEYS,
  DEFAULT_PROMPTS,
  scenarioContextKey,
  fetchPromptConfig,
  savePrompt,
  resetPrompt,
} from '../services/promptConfig'

// Editable prompt fields. The persona prompts come from DEFAULT_PROMPTS; each
// scenario contributes a context field whose default lives in scenarios.js.
const FIELDS = [
  {
    key: PROMPT_KEYS.SYSTEM_BASE,
    label: '기본 페르소나',
    help: '시나리오가 없을 때(일반 대화)의 시스템 프롬프트.',
    def: DEFAULT_PROMPTS[PROMPT_KEYS.SYSTEM_BASE],
  },
  {
    key: PROMPT_KEYS.CONTEXT_WRAPPER,
    label: '시나리오 페르소나',
    help: '시나리오 진행 중 쓰는 차량 시스템 페르소나. 상황 지침과 선택지·속도·카드 태그 로직은 코드에 고정되어 자동으로 덧붙습니다.',
    def: DEFAULT_PROMPTS[PROMPT_KEYS.CONTEXT_WRAPPER],
  },
  ...SCENARIOS.map((s) => ({
    key: scenarioContextKey(s.scenarioId),
    label: `시나리오 컨텍스트 — ${s.scenarioName}`,
    help: '해당 시나리오에서 차량이 처한 상황 설명. 저장 즉시 다음 응답부터 반영됩니다.',
    def: s.scenarioContext,
  })),
]

function EditorBtn({ onClick, disabled, variant = 'outline', children, title }) {
  const base = 'rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-[#2d7cf1] text-white hover:bg-[#1f6fe5] disabled:hover:bg-[#2d7cf1]',
    outline: 'border border-gray-200 text-gray-600 bg-white hover:bg-gray-50',
    ghost: 'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
  }
  return (
    <button onClick={onClick} disabled={disabled} title={title} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  )
}

export default function PromptEditor() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [overrides, setOverrides] = useState({}) // key → DB value (present = 수정됨)
  const [drafts, setDrafts] = useState({})        // key → textarea value
  const [status, setStatus] = useState({})        // key → 'saving' | 'saved' | 'reset' | error string

  const initDrafts = (ov) => {
    const next = {}
    for (const f of FIELDS) next[f.key] = ov[f.key] ?? f.def
    setDrafts(next)
  }

  const load = useCallback(async () => {
    const map = await fetchPromptConfig()
    setOverrides(map)
    initDrafts(map)
    setLoaded(true)
  }, [])

  // Load the current config the first time the panel is opened.
  useEffect(() => {
    if (open && !loaded) load()
  }, [open, loaded, load])

  const setDraft = (key, value) => setDrafts((d) => ({ ...d, [key]: value }))
  const setKeyStatus = (key, value) => setStatus((s) => ({ ...s, [key]: value }))

  const handleSave = async (field) => {
    setKeyStatus(field.key, 'saving')
    const res = await savePrompt(field.key, drafts[field.key] ?? '')
    if (res.success) {
      setOverrides((o) => ({ ...o, [field.key]: drafts[field.key] ?? '' }))
      setKeyStatus(field.key, 'saved')
    } else {
      setKeyStatus(field.key, res.error || '저장 실패')
    }
  }

  const handleReset = async (field) => {
    setKeyStatus(field.key, 'saving')
    const res = await resetPrompt(field.key)
    if (res.success) {
      setOverrides((o) => {
        const next = { ...o }
        delete next[field.key]
        return next
      })
      setDraft(field.key, field.def)
      setKeyStatus(field.key, 'reset')
    } else {
      setKeyStatus(field.key, res.error || '복원 실패')
    }
  }

  const statusLabel = (v) => {
    if (v === 'saving') return { text: '저장 중…', cls: 'text-gray-400' }
    if (v === 'saved') return { text: '저장됨 · 라이브', cls: 'text-green-600' }
    if (v === 'reset') return { text: '기본값으로 복원됨', cls: 'text-gray-500' }
    if (typeof v === 'string') return { text: v, cls: 'text-red-500' }
    return null
  }

  return (
    <div className="border border-gray-200 rounded-lg mb-4 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        title="Gemini가 쓰는 페르소나·시나리오 컨텍스트 프롬프트를 편집합니다."
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          프롬프트 편집 {Object.keys(overrides).length > 0 && (
            <span className="ml-1 text-[#2d7cf1] normal-case">· {Object.keys(overrides).length}개 수정됨</span>
          )}
        </span>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {!isSupabaseEnabled && (
            <p className="text-xs text-gray-400 mb-3">
              Supabase 미연결 — 편집·저장이 비활성화됩니다. 현재는 기본값으로 동작합니다.
            </p>
          )}
          {!loaded && isSupabaseEnabled && (
            <p className="text-xs text-gray-400 mb-3">불러오는 중…</p>
          )}

          <div className="space-y-5">
            {FIELDS.map((f) => {
              const draft = drafts[f.key] ?? f.def
              const isOverridden = overrides[f.key] != null
              const isDirty = draft !== (overrides[f.key] ?? f.def)
              const st = statusLabel(status[f.key])
              return (
                <div key={f.key}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium text-gray-700">
                      {f.label}
                      <span
                        className={`ml-2 text-[10px] font-semibold rounded px-1.5 py-0.5 align-middle ${
                          isOverridden ? 'bg-blue-50 text-[#2d7cf1]' : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {isOverridden ? '수정됨' : '기본값'}
                      </span>
                    </label>
                    {st && <span className={`text-xs ${st.cls}`}>{st.text}</span>}
                  </div>
                  <p className="text-xs text-gray-400 mb-1.5">{f.help}</p>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(f.key, e.target.value)}
                    disabled={!isSupabaseEnabled}
                    rows={Math.min(10, Math.max(3, draft.split('\n').length + 1))}
                    className="w-full text-sm rounded-md border border-gray-200 px-3 py-2 font-mono leading-relaxed text-gray-800 focus:outline-none focus:border-[#2d7cf1] disabled:bg-gray-50 disabled:text-gray-400"
                  />
                  <div className="flex gap-2 mt-1.5">
                    <EditorBtn
                      variant="primary"
                      onClick={() => handleSave(f)}
                      disabled={!isSupabaseEnabled || !isDirty || status[f.key] === 'saving'}
                      title="이 프롬프트를 저장합니다. 다음 Gemini 호출부터 반영됩니다."
                    >
                      저장
                    </EditorBtn>
                    <EditorBtn
                      variant="ghost"
                      onClick={() => handleReset(f)}
                      disabled={!isSupabaseEnabled || !isOverridden || status[f.key] === 'saving'}
                      title="저장된 수정을 지우고 코드 기본값으로 되돌립니다."
                    >
                      기본값 복원
                    </EditorBtn>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
