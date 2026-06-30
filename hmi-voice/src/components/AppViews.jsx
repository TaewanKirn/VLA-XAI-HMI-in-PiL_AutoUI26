import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PHONE_FAVORITES } from '../data/contacts'
import {
  ChevronLeft, Search, MapPin, Navigation as NavIcon,
  Phone as PhoneIcon, PhoneOff, Star,
  Play, Pause, SkipBack, SkipForward, Heart,
  Clock, Plus, X, CircleDot, AlertTriangle, Volume2, VolumeX, Map,
  Mic, MicOff, Shuffle, Repeat, Repeat1, UserPlus, Minus,
} from 'lucide-react'

/* ============================================================
   Design tokens — sub-level of the main screen.
   Targets a 16" automotive panel; the host slot is 482×828.
   Main screen uses 34–78px display type; apps use 22–36px.
   ============================================================ */

const T = {
  bg: '#f7f8fa',        // --bg-primary
  card: '#ffffff',      // --bg-white
  // Chip / pill background — main suggestion-chip gradient
  chipGrad: 'linear-gradient(87deg, #ffffff 5%, #edeef2 95%)',
  text: '#131417',      // --text-primary
  sub: '#5c668d',       // brand muted — hero & chip label color
  faint: '#99a1af',     // --text-secondary
  divider: 'rgba(19, 20, 23, 0.08)',
  border: '1.5px solid rgba(0, 0, 0, 0.08)',
  // Active/selected — main confirmation bubble gradient
  keyGrad: 'linear-gradient(-90deg, #77a9e8 0%, #2d7cf1 100%)',
  accent: '#2d7cf1',
  accentHi: '#5ba3d9',
  accentSoft: 'rgba(45, 124, 241, 0.12)',
  accentGlow: 'rgba(45, 124, 241, 0.32)',
  danger: '#d54848',
  radiusCard: 32,       // matches main ai-option-card
  radiusChip: 999,
  shadow: '0px 6px 12px rgba(0, 0, 0, 0.08)', // --shadow-level1
  headerH: 96,
  pad: 28,
}

function Shell({ title, onBack, children }) {
  return (
    <div style={{
      width: '100%', height: '100%', background: T.bg, color: T.text,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
    }}>
      <div style={{
        height: T.headerH, padding: `0 ${T.pad}px`, display: 'flex', alignItems: 'center', gap: 14,
        borderBottom: `1px solid ${T.divider}`, background: T.card, flexShrink: 0,
      }}>
        {onBack && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={onBack}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 6, color: T.text, borderRadius: 16,
              width: 56, height: 56, marginLeft: -8,
            }}
          >
            <ChevronLeft size={40} strokeWidth={2.2} />
          </motion.button>
        )}
        <div style={{
          fontSize: 32, fontWeight: 600, letterSpacing: -1,
          color: T.text, fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
        }}>{title}</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: T.pad }}>{children}</div>
    </div>
  )
}

function ListItem({ leading, title, subtitle, trailing, onClick }) {
  return (
    <motion.button
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      style={{
        width: '100%', padding: '18px 20px', marginBottom: 12,
        background: T.card, border: T.border,
        borderRadius: 22, cursor: onClick ? 'pointer' : 'default',
        display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left',
        boxShadow: T.shadow, fontFamily: 'inherit',
      }}
    >
      {leading && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{leading}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 22, fontWeight: 700, color: T.text, letterSpacing: -0.5,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2,
        }}>{title}</div>
        {subtitle && (
          <div style={{
            fontSize: 15, color: T.sub, marginTop: 4, fontWeight: 500, letterSpacing: -0.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{subtitle}</div>
        )}
      </div>
      {trailing && <div style={{ flexShrink: 0, color: T.sub, fontSize: 14, fontWeight: 600 }}>{trailing}</div>}
    </motion.button>
  )
}

function Avatar({ initials, color, size = 60 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color, color: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 600,
    }}>{initials}</div>
  )
}

function SectionLabel({ children, style }) {
  return (
    <div style={{
      fontSize: 18, color: T.sub, fontWeight: 700, marginBottom: 12,
      paddingLeft: 4, letterSpacing: -0.3,
      ...style,
    }}>{children}</div>
  )
}

function PrimaryButton({ children, onClick, style }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      style={{
        width: '100%', padding: '24px', borderRadius: T.radiusChip,
        background: T.keyGrad, color: 'white', border: 'none', cursor: 'pointer',
        fontSize: 26, fontWeight: 600, letterSpacing: -0.6,
        fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        boxShadow: `0 10px 24px ${T.accentGlow}`,
        ...style,
      }}
    >{children}</motion.button>
  )
}

/* ============================================================
   Navigation
   ============================================================ */

const NAV_PLACES = [
  { id: 1, name: '집', addr: '서울 마포구 합정동', icon: '🏠', eta: 18, km: 9.2, cat: 'home' },
  { id: 2, name: '회사', addr: '서울 강남구 테헤란로 152', icon: '🏢', eta: 24, km: 12.4, cat: 'work' },
  { id: 3, name: '스타벅스 강남점', addr: '서울 강남구 강남대로 390', icon: '☕', eta: 8, km: 3.1, cat: 'cafe' },
  { id: 4, name: '아버지 댁', addr: '경기 성남시 분당구 정자동', icon: '👨', eta: 32, km: 18.6, cat: 'family' },
  { id: 5, name: 'SK주유소 양재점', addr: '서울 서초구 양재대로 100', icon: '⛽', eta: 12, km: 5.4, cat: 'fuel' },
  { id: 6, name: '코엑스 주차장', addr: '서울 강남구 영동대로 513', icon: '🅿️', eta: 16, km: 8.1, cat: 'parking' },
  { id: 7, name: '한남동 맛집거리', addr: '서울 용산구 한남대로 27', icon: '🍽️', eta: 22, km: 10.7, cat: 'food' },
  { id: 8, name: 'GS칼텍스 충전소', addr: '서울 강남구 봉은사로 524', icon: '⚡', eta: 14, km: 6.8, cat: 'charge' },
]

const NAV_CATEGORIES = [
  { id: 'fuel', label: '주유소', icon: '⛽' },
  { id: 'parking', label: '주차장', icon: '🅿️' },
  { id: 'charge', label: '충전소', icon: '⚡' },
  { id: 'cafe', label: '카페', icon: '☕' },
  { id: 'food', label: '맛집', icon: '🍽️' },
]

const NAV_RECENT_SEARCHES = ['강남역', '집', '코엑스', '연남동 카페', '인천공항']

const NAV_ROUTES = [
  { label: '추천', etaDelta: 0, kmDelta: 0, detail: '통행료 2,300원 · 신호 6개', tag: '가장 빠름' },
  { label: '최단', etaDelta: -2, kmDelta: -0.4, detail: '통행료 3,800원 · 신호 4개', tag: '짧음' },
  { label: '무료', etaDelta: 6, kmDelta: 1.8, detail: '통행료 0원 · 신호 11개', tag: '무료' },
]

function NavigationApp({ onClose }) {
  const [view, setView] = useState('home')
  const [destination, setDestination] = useState(null)
  const [stopovers, setStopovers] = useState([])
  const [routeIdx, setRouteIdx] = useState(0)
  const [favIds, setFavIds] = useState(new Set([1, 2]))
  const [avoidHighway, setAvoidHighway] = useState(false)
  const [avoidToll, setAvoidToll] = useState(false)
  const [departWhen, setDepartWhen] = useState('now')
  const [muted, setMuted] = useState(false)
  const [overview, setOverview] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [selectedCategory, setSelectedCategory] = useState(null)

  const toggleFav = (id) => {
    setFavIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  /* ── SEARCH VIEW ───────────────────────────────────────── */
  if (view === 'search') {
    const filtered = searchText.trim()
      ? NAV_PLACES.filter(p => p.name.includes(searchText) || p.addr.includes(searchText))
      : NAV_PLACES.filter(p => !selectedCategory || p.cat === selectedCategory)
    return (
      <Shell title="검색" onBack={() => { setView('home'); setSearchText(''); setSelectedCategory(null) }}>
        <NavSearchBar value={searchText} onChange={setSearchText} autoFocus />
        <NavCategoryRow selected={selectedCategory} onSelect={(id) => setSelectedCategory(prev => prev === id ? null : id)} />
        {!searchText && (
          <>
            <SectionLabel>최근 검색</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
              {NAV_RECENT_SEARCHES.map(q => (
                <NavChip key={q} onClick={() => setSearchText(q)}>
                  <Clock size={16} /> {q}
                </NavChip>
              ))}
            </div>
          </>
        )}
        <SectionLabel>{searchText ? `'${searchText}' 검색 결과` : selectedCategory ? '카테고리 결과' : '추천 장소'}</SectionLabel>
        {filtered.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: T.faint, fontSize: 18 }}>일치하는 장소가 없습니다</div>
        ) : filtered.slice(0, 4).map(p => (
          <ListItem
            key={p.id}
            leading={<div style={{ fontSize: 38, width: 56, textAlign: 'center' }}>{p.icon}</div>}
            title={p.name}
            subtitle={p.addr}
            trailing={`${p.eta}분`}
            onClick={() => { setDestination(p); setRouteIdx(0); setStopovers([]); setView('preview') }}
          />
        ))}
      </Shell>
    )
  }

  /* ── STOPOVER PICKER ───────────────────────────────────── */
  if (view === 'stopover') {
    const candidates = NAV_PLACES.filter(p => p.id !== destination?.id && !stopovers.find(s => s.id === p.id))
    return (
      <Shell title="경유지 추가" onBack={() => setView('preview')}>
        <SectionLabel>자주 가는 장소</SectionLabel>
        {candidates.slice(0, 4).map(p => (
          <ListItem
            key={p.id}
            leading={<div style={{ fontSize: 38, width: 56, textAlign: 'center' }}>{p.icon}</div>}
            title={p.name}
            subtitle={p.addr}
            trailing={<Plus size={26} color={T.accent} />}
            onClick={() => { setStopovers(prev => [...prev, p]); setView('preview') }}
          />
        ))}
      </Shell>
    )
  }

  /* ── GUIDING VIEW ──────────────────────────────────────── */
  if (view === 'guiding') {
    const r = NAV_ROUTES[routeIdx]
    const etaTotal = (destination?.eta ?? 0) + r.etaDelta + stopovers.length * 5
    const kmTotal = (destination?.km ?? 0) + r.kmDelta + stopovers.length * 2.5
    return (
      <Shell title="안내 중" onBack={() => setView('preview')}>
        <div style={{
          background: T.keyGrad, color: 'white',
          borderRadius: T.radiusCard, padding: 26, marginBottom: 16,
          boxShadow: `0 10px 28px ${T.accentGlow}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ fontSize: 78, lineHeight: 1 }}>↱</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 19, opacity: 0.88, fontWeight: 500, letterSpacing: -0.3 }}>800m 후</div>
              <div style={{ fontSize: 42, fontWeight: 700, marginTop: 4, letterSpacing: -1.4 }}>우회전</div>
              <div style={{ fontSize: 21, marginTop: 6, opacity: 0.92 }}>강남대로</div>
            </div>
          </div>
        </div>

        <NavSpeedHero current={52} limit={60} />

        <div style={{
          background: T.card, borderRadius: 24, padding: '20px 24px', marginBottom: 16,
          border: T.border, boxShadow: T.shadow,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
        }}>
          <div>
            <div style={{ fontSize: 17, color: T.faint, fontWeight: 600, letterSpacing: -0.3 }}>도착 예정</div>
            <div style={{ fontSize: 34, fontWeight: 700, marginTop: 4, letterSpacing: -0.9 }}>{etaTotal}분</div>
            <div style={{ fontSize: 18, color: T.sub, marginTop: 2, fontWeight: 500 }}>{kmTotal.toFixed(1)} km · {destination?.name}</div>
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 18px', borderRadius: T.radiusChip,
            background: '#fff3cd', color: '#a86b00',
            fontSize: 17, fontWeight: 600, letterSpacing: -0.3,
          }}>
            <AlertTriangle size={18} /> 사고 1건
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <NavQuickAction
            icon={muted ? <VolumeX size={28} /> : <Volume2 size={28} />}
            label={muted ? '음소거' : '음성안내'}
            active={!muted}
            onClick={() => setMuted(m => !m)}
          />
          <NavQuickAction
            icon={<Map size={28} />}
            label="전체보기"
            active={overview}
            onClick={() => setOverview(v => !v)}
          />
          <NavQuickAction
            icon={<AlertTriangle size={28} />}
            label="신고"
            onClick={() => {}}
          />
        </div>

        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { setView('home'); setDestination(null); setStopovers([]); setRouteIdx(0) }}
          style={{
            width: '100%', padding: 22, borderRadius: T.radiusChip, border: 'none', cursor: 'pointer',
            background: '#ffefef', color: T.danger,
            fontSize: 22, fontWeight: 600, letterSpacing: -0.4,
            fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
          }}
        >안내 종료</motion.button>
      </Shell>
    )
  }

  /* ── PREVIEW VIEW ──────────────────────────────────────── */
  if (view === 'preview' && destination) {
    const sel = NAV_ROUTES[routeIdx]
    return (
      <Shell title="경로 미리보기" onBack={() => { setView('home'); setStopovers([]); setRouteIdx(0) }}>
        <div style={{
          background: T.card, borderRadius: T.radiusCard, padding: 22, marginBottom: 14,
          border: T.border, boxShadow: T.shadow,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <MapPin size={32} color={T.accent} />
            <div style={{
              flex: 1, fontSize: 28, fontWeight: 700, letterSpacing: -0.7,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{destination.name}</div>
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={() => toggleFav(destination.id)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
            >
              <Star size={32} fill={favIds.has(destination.id) ? T.accent : 'none'} color={favIds.has(destination.id) ? T.accent : T.faint} />
            </motion.button>
          </div>
          <div style={{ fontSize: 19, color: T.sub, marginTop: 8, fontWeight: 500 }}>{destination.addr}</div>
        </div>

        {stopovers.length > 0 && stopovers.map((s, i) => (
          <div key={s.id} style={{
            background: T.card, borderRadius: 20, padding: '16px 20px', marginBottom: 10,
            border: T.border, boxShadow: T.shadow,
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              fontSize: 16, fontWeight: 700, color: T.accent,
              padding: '6px 16px', background: T.accentSoft, borderRadius: T.radiusChip,
              letterSpacing: -0.3,
            }}>경유 {i + 1}</div>
            <div style={{
              flex: 1, fontSize: 21, fontWeight: 600, letterSpacing: -0.4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{s.name}</div>
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={() => setStopovers(prev => prev.filter(p => p.id !== s.id))}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: T.faint }}
            >
              <X size={24} />
            </motion.button>
          </div>
        ))}

        {stopovers.length < 2 && (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setView('stopover')}
            style={{
              width: '100%', padding: 18, marginBottom: 18,
              background: 'transparent', border: `2px dashed ${T.faint}`, borderRadius: T.radiusChip,
              color: T.sub, fontSize: 19, fontWeight: 500, cursor: 'pointer', letterSpacing: -0.4,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
            }}
          >
            <Plus size={22} /> 경유지 추가
          </motion.button>
        )}

        <SectionLabel>경로 선택</SectionLabel>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          {NAV_ROUTES.map((rt, i) => {
            const active = i === routeIdx
            return (
              <motion.button
                whileTap={{ scale: 0.97 }}
                key={rt.label}
                onClick={() => setRouteIdx(i)}
                style={{
                  flex: 1, padding: '20px 8px', borderRadius: 24, textAlign: 'center',
                  background: active ? T.keyGrad : T.chipGrad,
                  color: active ? 'white' : T.sub,
                  border: active ? 'none' : T.border,
                  cursor: 'pointer',
                  boxShadow: active ? `0 8px 20px ${T.accentGlow}` : 'none',
                  fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
                }}
              >
                <div style={{ fontSize: 16, opacity: 0.88, fontWeight: 500, letterSpacing: -0.3 }}>{rt.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, letterSpacing: -0.7 }}>{destination.eta + rt.etaDelta}분</div>
                <div style={{ fontSize: 14, opacity: 0.85, marginTop: 2 }}>{(destination.km + rt.kmDelta).toFixed(1)} km</div>
              </motion.button>
            )
          })}
        </div>

        <div style={{
          background: T.accentSoft, borderRadius: 20, padding: '14px 20px', marginBottom: 18,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <CircleDot size={20} color={T.accent} />
          <div style={{ flex: 1, fontSize: 17, color: T.text, fontWeight: 500, letterSpacing: -0.3 }}>{sel.detail}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <NavToggleChip active={avoidHighway} onClick={() => setAvoidHighway(v => !v)}>고속도로 회피</NavToggleChip>
          <NavToggleChip active={avoidToll} onClick={() => setAvoidToll(v => !v)}>유료도로 회피</NavToggleChip>
        </div>

        <PrimaryButton onClick={() => setView('guiding')}>
          <NavIcon size={26} /> 안내 시작
        </PrimaryButton>
      </Shell>
    )
  }

  /* ── HOME VIEW ─────────────────────────────────────────── */
  const sorted = [...NAV_PLACES]
    .sort((a, b) => Number(favIds.has(b.id)) - Number(favIds.has(a.id)))
    .slice(0, 4)
  return (
    <Shell title="내비게이션" onBack={onClose}>
      <motion.button
        whileTap={{ scale: 0.985 }}
        onClick={() => setView('search')}
        style={{
          width: '100%',
          background: T.chipGrad, borderRadius: T.radiusChip, padding: '22px 28px',
          display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18,
          border: T.border, boxShadow: T.shadow, cursor: 'pointer',
          fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
        }}
      >
        <Search size={28} color={T.sub} />
        <div style={{
          flex: 1, textAlign: 'left', fontSize: 23, color: T.sub,
          fontWeight: 500, letterSpacing: -0.5,
        }}>어디로 갈까요?</div>
      </motion.button>
      <NavCategoryRow onSelect={(id) => { setSelectedCategory(id); setView('search') }} />
      <SectionLabel>최근 · 즐겨찾기</SectionLabel>
      {sorted.map(p => (
        <ListItem
          key={p.id}
          leading={<div style={{ fontSize: 38, width: 56, textAlign: 'center' }}>{p.icon}</div>}
          title={p.name}
          subtitle={p.addr}
          trailing={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <motion.button
                whileTap={{ scale: 0.85 }}
                onClick={(e) => { e.stopPropagation(); toggleFav(p.id) }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                <Star size={24} fill={favIds.has(p.id) ? T.accent : 'none'} color={favIds.has(p.id) ? T.accent : T.faint} />
              </motion.button>
              <div style={{ fontSize: 17, fontWeight: 500, color: T.sub }}>{p.eta}분</div>
            </div>
          }
          onClick={() => { setDestination(p); setRouteIdx(0); setStopovers([]); setView('preview') }}
        />
      ))}
    </Shell>
  )
}

/* ── Navigation helper components ─────────────────────── */

function NavSearchBar({ value, onChange, autoFocus }) {
  return (
    <div style={{
      background: T.chipGrad, borderRadius: T.radiusChip, padding: '22px 28px',
      display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20,
      border: T.border, boxShadow: T.shadow,
    }}>
      <Search size={28} color={T.sub} />
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="장소, 주소, 카테고리"
        style={{
          flex: 1, border: 'none', outline: 'none', fontSize: 24, background: 'transparent',
          color: T.text, fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
          fontWeight: 500, letterSpacing: -0.5,
        }}
      />
      {value && (
        <motion.button
          whileTap={{ scale: 0.88 }}
          onClick={() => onChange('')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: T.faint }}
        >
          <X size={26} />
        </motion.button>
      )}
    </div>
  )
}

function NavCategoryRow({ selected, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
      {NAV_CATEGORIES.map(c => {
        const active = selected === c.id
        return (
          <motion.button
            whileTap={{ scale: 0.94 }}
            key={c.id}
            onClick={() => onSelect(c.id)}
            style={{
              padding: '14px 22px', borderRadius: T.radiusChip,
              border: active ? 'none' : T.border,
              background: active ? T.keyGrad : T.chipGrad,
              color: active ? 'white' : T.sub,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 20, fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0,
              letterSpacing: -0.4,
              boxShadow: active ? `0 6px 16px ${T.accentGlow}` : 'none',
              fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
            }}
          >
            <span style={{ fontSize: 22 }}>{c.icon}</span>{c.label}
          </motion.button>
        )
      })}
    </div>
  )
}

function NavChip({ children, onClick }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      style={{
        padding: '12px 20px', borderRadius: T.radiusChip,
        border: T.border, background: T.chipGrad, color: T.sub,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
        fontSize: 18, fontWeight: 500, letterSpacing: -0.3,
        fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
      }}
    >{children}</motion.button>
  )
}

function NavToggleChip({ children, active, onClick }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      style={{
        padding: '14px 22px', borderRadius: T.radiusChip,
        background: active ? T.keyGrad : T.chipGrad,
        color: active ? 'white' : T.sub,
        border: active ? 'none' : T.border,
        cursor: 'pointer', fontSize: 19, fontWeight: 500, letterSpacing: -0.4,
        display: 'inline-flex', alignItems: 'center', gap: 8,
        boxShadow: active ? `0 6px 16px ${T.accentGlow}` : 'none',
        fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
        transition: 'background 0.2s, color 0.2s',
      }}
    >{children}</motion.button>
  )
}

function NavSpeedHero({ current, limit }) {
  const over = current > limit
  return (
    <div style={{
      background: T.card, borderRadius: T.radiusCard, padding: '20px 26px',
      border: T.border, boxShadow: T.shadow,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      marginBottom: 16,
      fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minWidth: 0 }}>
        <div>
          <div style={{
            fontSize: 16, color: T.faint, fontWeight: 600, letterSpacing: -0.3,
            marginBottom: 2,
          }}>현재 속도</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={{
              fontSize: 76, fontWeight: 700, lineHeight: 1,
              color: over ? T.danger : T.text, letterSpacing: -3,
            }}>{current}</div>
            <div style={{
              fontSize: 22, fontWeight: 600, color: T.sub, letterSpacing: -0.5,
            }}>km/h</div>
          </div>
        </div>
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        flexShrink: 0,
      }}>
        <div style={{
          width: 76, height: 76, borderRadius: '50%', background: 'white',
          border: '5px solid #e54848', color: T.text, fontSize: 30, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center', letterSpacing: -0.7,
        }}>{limit}</div>
        <div style={{ fontSize: 12, color: T.faint, fontWeight: 600 }}>제한 속도</div>
      </div>
    </div>
  )
}

function NavQuickAction({ icon, label, active, onClick }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      style={{
        flex: 1, padding: '18px 6px', borderRadius: 20, cursor: 'pointer',
        background: active ? T.keyGrad : T.chipGrad,
        border: active ? 'none' : T.border,
        color: active ? 'white' : T.sub,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        fontSize: 17, fontWeight: 600, letterSpacing: -0.3,
        boxShadow: active ? `0 6px 16px ${T.accentGlow}` : 'none',
        fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
      }}
    >
      {icon}<span>{label}</span>
    </motion.button>
  )
}

/* ============================================================
   Navigation (Kakao Maps — map + place search)
   ============================================================ */

const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY

// Idempotent loader for the Kakao Maps JS SDK (with the `services` library
// for place search). Loaded only when the Navigation app first opens.
function loadKakaoSdk(key) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.kakao && window.kakao.maps && window.kakao.maps.services) return Promise.resolve(window.kakao)
  return new Promise((resolve, reject) => {
    const ready = () => {
      if (window.kakao?.maps?.load) window.kakao.maps.load(() => resolve(window.kakao))
      else reject(new Error('Kakao SDK shape unexpected'))
    }
    const existing = document.querySelector('script[data-kakao-sdk]')
    if (existing) {
      if (window.kakao?.maps) return ready()
      existing.addEventListener('load', ready, { once: true })
      existing.addEventListener('error', () => reject(new Error('Kakao SDK load failed')), { once: true })
      return
    }
    const s = document.createElement('script')
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`
    s.async = true
    s.dataset.kakaoSdk = '1'
    s.onload = ready
    s.onerror = () => reject(new Error('Kakao SDK load failed'))
    document.head.appendChild(s)
  })
}

// Fixed starting point — the prototype vehicle isn't actually moving, and the
// experiment scenario is anchored at Hongik University (서울 마포구 와우산로 94).
const DEFAULT_CENTER = {
  lat: 37.5510, lng: 126.9251,
  name: '홍익대학교', addr: '서울 마포구 와우산로 94',
}

/* ── OSRM routing helpers ────────────────────────────────
   The Kakao JS SDK ships no driving directions. We call the public OSRM
   demo router (OpenStreetMap-based) — free, no key, CORS-allowed — to get
   a real road geometry and turn-by-turn maneuvers for in-app navigation.
*/
async function fetchDrivingRoute(origin, dest) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?steps=true&geometries=geojson&overview=full`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OSRM ${res.status}`)
  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || '경로를 찾을 수 없습니다')
  const r = data.routes[0]
  return {
    distance: r.distance,                 // meters
    duration: r.duration,                 // seconds
    geometry: r.geometry.coordinates,     // [[lng, lat], ...]
    steps: r.legs?.[0]?.steps || [],
  }
}

function formatDuration(sec) {
  const m = Math.max(1, Math.round(sec / 60))
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60), rm = m % 60
  return rm ? `${h}시간 ${rm}분` : `${h}시간`
}

function formatDistance(m) {
  if (m == null) return ''
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

// Map OSRM maneuver types to Korean nav phrases.
const MANEUVER_KO = {
  depart:           ()    => '출발',
  arrive:           ()    => '목적지 도착',
  continue:         ()    => '직진',
  'new name':       ()    => '직진',
  turn: (m) => ({
    left: '좌회전', right: '우회전',
    'slight left': '왼쪽 방향', 'slight right': '오른쪽 방향',
    'sharp left': '급좌회전', 'sharp right': '급우회전',
    uturn: '유턴', straight: '직진',
  }[m] || '회전'),
  merge: (m) => m === 'left' ? '좌측 합류' : m === 'right' ? '우측 합류' : '합류',
  fork:  (m) => m === 'left' ? '왼쪽 갈래길' : m === 'right' ? '오른쪽 갈래길' : '갈래길',
  'end of road': (m) => m === 'left' ? '도로 끝에서 좌측' : m === 'right' ? '도로 끝에서 우측' : '도로 끝',
  roundabout:        () => '회전교차로 진입',
  rotary:            () => '회전교차로 진입',
  'exit roundabout': () => '회전교차로에서 빠져나옴',
  'exit rotary':     () => '회전교차로에서 빠져나옴',
  'on ramp':         () => '진입 램프',
  'off ramp':        () => '진출 램프',
  'use lane':        () => '차로 이용',
  notification:      () => '안내',
}

function maneuverText(step) {
  const t = step?.maneuver?.type
  const fn = t && MANEUVER_KO[t]
  return fn ? fn(step.maneuver.modifier) : (t || '')
}

// Project OSRM geometry coordinates into an SVG viewbox, preserving aspect.
// Returns a single Path "d" string + the projected start/end points so the
// minimal nav view can drop the origin and destination dots.
function buildRouteSvg(geometry, w, h, pad = 20) {
  if (!geometry || geometry.length < 2) {
    return { d: '', start: [w / 2, h - pad], end: [w / 2, pad] }
  }
  const xs = geometry.map((c) => c[0]), ys = geometry.map((c) => c[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const dx = (maxX - minX) || 1e-6, dy = (maxY - minY) || 1e-6
  const s = Math.min((w - 2 * pad) / dx, (h - 2 * pad) / dy)
  const usedW = dx * s, usedH = dy * s
  const ox = pad + (w - 2 * pad - usedW) / 2
  const oy = pad + (h - 2 * pad - usedH) / 2
  const points = geometry.map(([lo, la]) => [
    ox + (lo - minX) * s,
    oy + (maxY - la) * s, // svg y is flipped relative to latitude
  ])
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  return { d, start: points[0], end: points[points.length - 1] }
}

function formatClockTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Cell for the secondary metrics row of the in-app nav view: small uppercase
// label over a tabular-numeric value, optionally divided by a hair-line.
function NavMetric({ label, value, divider }) {
  return (
    <div style={{
      padding: '14px 8px', textAlign: 'center',
      borderLeft: divider ? `1px solid ${T.divider}` : 'none',
    }}>
      <div style={{
        fontSize: 11, color: T.faint, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontSize: 22, fontWeight: 700, color: T.text, letterSpacing: -0.6,
        marginTop: 4, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  )
}

function NavigationAppMap({ onClose, activeRoute, setActiveRoute, currentLocation }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const placesRef = useRef(null)
  const destMarkerRef = useRef(null)
  const polylineRef = useRef(null)
  const currentCircleRef = useRef(null)   // blue "you are here" dot — moves with currentLocation prop

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [destination, setDestination] = useState(null)
  // 'init' | 'loading' | 'ready' | 'no-key' | error string
  const [status, setStatus] = useState('init')
  const [route, setRoute] = useState(null)          // OSRM result { distance, duration, geometry, steps }
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState(null)

  useEffect(() => {
    if (!KAKAO_JS_KEY) { setStatus('no-key'); return }
    let cancelled = false
    setStatus('loading')
    loadKakaoSdk(KAKAO_JS_KEY)
      .then((kakao) => {
        if (cancelled || !mapEl.current) return
        const start = currentLocation ?? DEFAULT_CENTER
        const center = new kakao.maps.LatLng(start.lat, start.lng)
        const map = new kakao.maps.Map(mapEl.current, { center, level: 4 })
        mapRef.current = map
        // Current-location indicator (blue dot) — kept in a ref so prop
        // changes can reposition it without rebuilding the map.
        currentCircleRef.current = new kakao.maps.Circle({
          center, radius: 32,
          strokeWeight: 4, strokeColor: '#2d7cf1', strokeOpacity: 0.95,
          fillColor: '#2d7cf1', fillOpacity: 0.35, map,
        })
        placesRef.current = new kakao.maps.services.Places()
        setStatus('ready')
      })
      .catch((e) => { if (!cancelled) setStatus(`error: ${e.message || 'load failed'}`) })
    return () => { cancelled = true }
  }, [])

  // Move the "you are here" dot whenever the parent passes a new
  // currentLocation (hydroplaning steps through fixed points as the
  // passenger asks for their position).
  useEffect(() => {
    if (status !== 'ready' || !currentLocation || !window.kakao) return
    const ll = new window.kakao.maps.LatLng(currentLocation.lat, currentLocation.lng)
    currentCircleRef.current?.setPosition(ll)
    // Re-center only when there's no destination preview taking the bounds.
    if (!destination && mapRef.current) mapRef.current.setCenter(ll)
  }, [currentLocation?.lat, currentLocation?.lng, status, destination])

  const runSearch = () => {
    if (!placesRef.current || !query.trim()) { setResults([]); return }
    const kakao = window.kakao
    placesRef.current.keywordSearch(
      query.trim(),
      (data, statusCode) => {
        if (statusCode !== kakao.maps.services.Status.OK) { setResults([]); return }
        setResults(data.slice(0, 8))
      },
      // Bias the search toward our current map center so "강남역 카페" finds
      // nearby spots first, not a same-named place 200km away.
      { location: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng), radius: 20000 },
    )
  }

  const drawPolyline = (path, dashed = false) => {
    const kakao = window.kakao
    if (polylineRef.current) polylineRef.current.setMap(null)
    polylineRef.current = new kakao.maps.Polyline({
      path,
      strokeWeight: dashed ? 4 : 6,
      strokeColor: '#2d7cf1',
      strokeOpacity: dashed ? 0.55 : 0.92,
      strokeStyle: dashed ? 'shortdash' : 'solid',
      map: mapRef.current,
    })
  }

  const chooseDestination = async (p) => {
    const kakao = window.kakao
    const lat = parseFloat(p.y), lng = parseFloat(p.x)
    const dest = {
      id: p.id,
      name: p.place_name,
      addr: p.road_address_name || p.address_name,
      lat, lng,
    }
    // Drop the destination marker immediately for feedback.
    if (destMarkerRef.current) destMarkerRef.current.setMap(null)
    destMarkerRef.current = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(lat, lng),
      map: mapRef.current,
    })
    // Provisional straight line while the route is being fetched.
    drawPolyline([
      new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
      new kakao.maps.LatLng(lat, lng),
    ], true)
    const bounds = new kakao.maps.LatLngBounds()
    bounds.extend(new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng))
    bounds.extend(new kakao.maps.LatLng(lat, lng))
    mapRef.current.setBounds(bounds, 80, 80, 80, 80)
    setDestination(dest)
    setResults([])
    setQuery(p.place_name)
    setRoute(null)
    setRouteError(null)
    setRouteLoading(true)

    // Fetch the actual road geometry + turn-by-turn steps.
    try {
      const r = await fetchDrivingRoute(
        { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng },
        { lat, lng },
      )
      setRoute(r)
      // Replace the provisional line with the real route geometry.
      drawPolyline(r.geometry.map(([lo, la]) => new kakao.maps.LatLng(la, lo)))
      const rb = new kakao.maps.LatLngBounds()
      r.geometry.forEach(([lo, la]) => rb.extend(new kakao.maps.LatLng(la, lo)))
      mapRef.current.setBounds(rb, 60, 60, 60, 60)
    } catch (e) {
      console.warn('[osrm] route failed:', e)
      setRouteError(e.message || '경로 계산 실패')
    } finally {
      setRouteLoading(false)
    }
  }

  const clearDestination = () => {
    if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null }
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null }
    setDestination(null)
    setRoute(null)
    setRouteError(null)
    if (mapRef.current) {
      mapRef.current.setCenter(new window.kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng))
      mapRef.current.setLevel(4)
    }
  }

  // "경로 확정" — promote the previewed OSRM route into a session-wide active
  // trip the AI can reason about (departure/ETA/distance go into the prompt).
  const confirmRoute = () => {
    if (!destination || !route) return
    const now = new Date()
    const baseArrival = new Date(now.getTime() + route.duration * 1000)
    setActiveRoute?.({
      destination: {
        name: destination.name, addr: destination.addr,
        lat: destination.lat, lng: destination.lng,
      },
      durationSec: route.duration,
      distanceM: route.distance,
      geometry: route.geometry,
      departureIso: now.toISOString(),
      baseArrivalIso: baseArrival.toISOString(),
    })
  }

  const endActiveRoute = () => {
    setActiveRoute?.(null)
    clearDestination()
  }

  // Tick once a minute so the "잔여 시간" / "예상 도착" reflect real-time when
  // the minimal nav view is open.
  const [, setNowTick] = useState(0)
  useEffect(() => {
    if (!activeRoute) return
    const id = setInterval(() => setNowTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [activeRoute])

  return (
    <Shell title="내비게이션" onBack={onClose}>
      <div style={{ position: 'relative', height: '100%', overflow: 'hidden', borderRadius: 24 }}>
        {/* Map */}
        <div
          ref={mapEl}
          style={{
            position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden',
            border: T.border, background: '#e6e8ee',
          }}
        />

        {/* Status overlay */}
        {status !== 'ready' && (
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(247,248,250,0.94)', padding: 24, textAlign: 'center',
            zIndex: 4,
          }}>
            {status === 'no-key' && (
              <div style={{ fontSize: 16, color: T.sub, lineHeight: 1.55 }}>
                카카오맵 키가 설정되지 않았습니다.<br />
                <span style={{ fontFamily: 'monospace', color: T.text }}>VITE_KAKAO_JS_KEY</span>를 <span style={{ fontFamily: 'monospace' }}>.env.local</span>에 추가해 주세요.
              </div>
            )}
            {status === 'loading' && (
              <div style={{ fontSize: 18, color: T.sub }}>지도 불러오는 중…</div>
            )}
            {typeof status === 'string' && status.startsWith('error') && (
              <div style={{ fontSize: 15, color: T.danger, lineHeight: 1.55, maxWidth: 360 }}>
                {status}
                <div style={{ fontSize: 13, color: T.sub, marginTop: 10, fontWeight: 500 }}>
                  주로 카카오 개발자센터의 <b>Web 플랫폼 도메인</b>에 현재 주소가 등록되지 않아서 생깁니다.<br />
                  developers.kakao.com → 내 앱 → 플랫폼 → Web → 사이트 도메인에<br />
                  <span style={{ fontFamily: 'monospace' }}>http://localhost:{typeof window !== 'undefined' ? window.location.port : '5173'}</span> 를 추가해 주세요.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Floating search bar (+ results dropdown) */}
        <div style={{ position: 'absolute', top: 14, left: 14, right: 14, zIndex: 5 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: T.card, border: T.border, borderRadius: 999,
            padding: '0 14px', height: 52, boxShadow: T.shadow,
          }}>
            <Search size={20} color={T.faint} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="목적지 검색 (예: 강남역, 코엑스)"
              disabled={status !== 'ready'}
              style={{
                flex: 1, minWidth: 0, border: 'none', outline: 'none',
                background: 'transparent', fontSize: 16, color: T.text,
                fontFamily: 'inherit',
              }}
            />
            {query && (
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => { setQuery(''); setResults([]) }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: T.faint }}
              ><X size={18} /></motion.button>
            )}
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={runSearch}
              disabled={status !== 'ready' || !query.trim()}
              style={{
                background: T.accent, color: 'white', border: 'none', borderRadius: 999,
                padding: '7px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 700,
                opacity: status === 'ready' && query.trim() ? 1 : 0.4,
              }}
            >검색</motion.button>
          </div>

          {results.length > 0 && (
            <div style={{
              marginTop: 8, background: T.card, border: T.border, borderRadius: 18,
              boxShadow: T.shadow, maxHeight: 320, overflowY: 'auto',
            }}>
              {results.map((p) => (
                <motion.button
                  key={p.id}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => chooseDestination(p)}
                  style={{
                    width: '100%', textAlign: 'left', background: 'transparent',
                    border: 'none', borderBottom: `1px solid ${T.divider}`, cursor: 'pointer',
                    padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <MapPin size={18} color={T.accent} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 16, fontWeight: 600, color: T.text,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{p.place_name}</div>
                    <div style={{
                      fontSize: 13, color: T.sub,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{p.road_address_name || p.address_name}</div>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>

        {/* Destination card (bottom) — preview only */}
        <AnimatePresence>
          {destination && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: 'absolute', bottom: 14, left: 14, right: 14, zIndex: 5,
                background: T.card, border: T.border, borderRadius: 22,
                padding: '14px 16px', boxShadow: T.shadow,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <MapPin size={20} color={T.accent} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 17, fontWeight: 700, color: T.text,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{destination.name}</div>
                  <div style={{
                    fontSize: 13, color: T.sub,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{destination.addr}</div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={clearDestination}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.faint, padding: 4 }}
                ><X size={18} /></motion.button>
              </div>
              {routeLoading ? (
                <div style={{ fontSize: 13, color: T.sub, marginBottom: 10 }}>경로 계산 중…</div>
              ) : routeError ? (
                <div style={{ fontSize: 13, color: T.danger, marginBottom: 10 }}>
                  경로를 계산하지 못했어요 ({routeError}) — 직선 거리만 표시됩니다.
                </div>
              ) : route ? (
                <>
                  <div style={{ display: 'flex', gap: 16, fontSize: 14, color: T.sub, marginBottom: 10 }}>
                    <span>예상 시간 <b style={{ color: T.text, fontWeight: 700 }}>{formatDuration(route.duration)}</b></span>
                    <span>거리 <b style={{ color: T.text, fontWeight: 700 }}>{formatDistance(route.distance)}</b></span>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={confirmRoute}
                    style={{
                      width: '100%', background: T.accent, color: 'white', border: 'none',
                      borderRadius: 14, padding: '12px 14px', fontSize: 15, fontWeight: 700,
                      cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: 8,
                    }}
                  >
                    <NavIcon size={18} /> 경로 확정 · 안내 시작
                  </motion.button>
                </>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Minimal in-app nav view — overlay (map stays mounted underneath) */}
        <AnimatePresence>
          {activeRoute && (() => {
            const dep = new Date(activeRoute.departureIso)
            const arr = new Date(activeRoute.baseArrivalIso)
            const now = new Date()
            const remainingMin = Math.max(0, Math.round((arr - now) / 60_000))
            const svg = buildRouteSvg(activeRoute.geometry, 360, 180)
            return (
              <motion.div
                key="nav-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: 'absolute', inset: 0, zIndex: 10,
                  background: T.bg, overflowY: 'auto',
                  padding: '6px 4px 14px',
                }}
              >
                {/* Destination header */}
                <div style={{ padding: '4px 4px 0' }}>
                  <div style={{
                    fontSize: 11, color: T.faint, fontWeight: 700,
                    letterSpacing: 1.6, textTransform: 'uppercase',
                  }}>안내 중</div>
                  <div style={{
                    fontSize: 30, fontWeight: 700, color: T.text,
                    letterSpacing: -0.8, lineHeight: 1.2, marginTop: 8,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{activeRoute.destination.name}</div>
                  <div style={{
                    fontSize: 14, color: T.sub, marginTop: 4,
                    letterSpacing: -0.2, lineHeight: 1.4,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{activeRoute.destination.addr}</div>
                </div>

                {/* Abstract route line — no basemap, just shape */}
                <div style={{
                  marginTop: 22,
                  background: T.chipGrad, border: T.border, borderRadius: 24,
                  padding: '18px 14px', display: 'flex', justifyContent: 'center',
                  boxShadow: T.shadow,
                }}>
                  <svg
                    width="100%" height={180}
                    viewBox="0 0 360 180"
                    preserveAspectRatio="xMidYMid meet"
                    style={{ maxWidth: 360, display: 'block' }}
                  >
                    <path
                      d={svg.d}
                      stroke={activeRoute.isAlternative ? '#10b981' : T.accent}
                      strokeWidth={5}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.95}
                    />
                    <circle cx={svg.start[0]} cy={svg.start[1]} r={9} fill={activeRoute.isAlternative ? '#10b981' : T.accent} />
                    <circle cx={svg.start[0]} cy={svg.start[1]} r={3.5} fill="#ffffff" />
                    <circle cx={svg.end[0]} cy={svg.end[1]} r={11} fill="#e85d5d" />
                    <circle cx={svg.end[0]} cy={svg.end[1]} r={4} fill="#ffffff" />
                  </svg>
                </div>

                {/* Hero metric — 도착 예정 */}
                <div style={{ marginTop: 26, padding: '0 4px' }}>
                  <div style={{
                    fontSize: 11, color: T.faint, fontWeight: 700,
                    letterSpacing: 1.6, textTransform: 'uppercase',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                  }}>
                    도착 예정
                    {activeRoute.isAlternative && (
                      <span style={{
                        background: 'rgba(16, 185, 129, 0.14)', color: '#10b981',
                        padding: '2px 8px', borderRadius: 999, fontSize: 10,
                        letterSpacing: 0.4, fontWeight: 700,
                      }}>우회 경로</span>
                    )}
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'baseline', gap: 10,
                    marginTop: 6,
                  }}>
                    <span style={{
                      fontSize: 60, fontWeight: 700, color: T.text,
                      letterSpacing: -2.4, lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                    }}>{formatClockTime(arr)}</span>
                    {activeRoute.isAlternative && activeRoute.addedMin > 0 && (
                      <span style={{
                        fontSize: 17, fontWeight: 700, color: '#10b981',
                        letterSpacing: -0.4, fontVariantNumeric: 'tabular-nums',
                      }}>+{activeRoute.addedMin}분</span>
                    )}
                  </div>
                </div>

                {/* Secondary metrics row */}
                <div style={{
                  marginTop: 20,
                  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                  background: T.card, border: T.border, borderRadius: 22,
                  overflow: 'hidden', boxShadow: T.shadow,
                }}>
                  <NavMetric label="잔여" value={`${remainingMin}분`} />
                  <NavMetric label="거리" value={formatDistance(activeRoute.distanceM)} divider />
                  <NavMetric label="출발" value={formatClockTime(dep)} divider />
                </div>

                {/* End button — subtle outline (consistent w/ system hierarchy) */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={endActiveRoute}
                  style={{
                    marginTop: 22, width: '100%',
                    background: T.card, color: T.sub, border: T.border,
                    borderRadius: 14, padding: '13px 16px',
                    fontSize: 14, fontWeight: 600, letterSpacing: -0.2,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >안내 종료</motion.button>
              </motion.div>
            )
          })()}
        </AnimatePresence>

      </div>
    </Shell>
  )
}

/* ============================================================
   Phone
   ============================================================ */

// MM:SS, or H:MM:SS once a call passes the hour mark. tabular-nums-friendly.
function formatCallElapsed(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  const h = Math.floor(m / 60)
  const mm = m % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(mm)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function PhoneApp({ onClose, callingContact, callState, startCall, endCall }) {
  const [tab, setTab] = useState('favorites')
  const [muted, setMuted] = useState(false)
  const [speaker, setSpeaker] = useState(true)
  const [elapsedSec, setElapsedSec] = useState(0)

  // Reset UI-only state when no call is active.
  useEffect(() => {
    if (!callingContact) { setMuted(false); setSpeaker(true) }
  }, [callingContact])

  // Tick the call duration once a second after we reach the 'connected' state.
  useEffect(() => {
    if (callState !== 'connected') { setElapsedSec(0); return }
    setElapsedSec(0)
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [callState])

  const recents = [
    { id: 11, name: '엄마',          when: '오늘 오전 9:12', dir: '발신',   color: '#f59e0b', sub: '010-1234-5678' },
    { id: 12, name: '02-555-0188',   when: '어제 오후 6:40', dir: '부재중', color: '#9ca3af', sub: '02-555-0188' },
    { id: 13, name: '이수현',        when: '어제 오후 2:05', dir: '수신',   color: '#ef4444', sub: '010-2222-3333' },
  ]

  /* ── CALLING VIEW (ringing or connected) ─────────────── */
  if (callingContact) {
    const isRinging = callState === 'ringing'
    return (
      <Shell title={isRinging ? '전화 거는 중' : '통화'} onBack={endCall}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingTop: 48, paddingBottom: 4,
        }}>
          {/* Status label with animated indicator */}
          <div style={{
            fontSize: 11, color: T.faint, fontWeight: 700,
            letterSpacing: 1.6, textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            {isRinging ? (
              <motion.span
                animate={{ opacity: [0.35, 1, 0.35] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  width: 8, height: 8, borderRadius: '50%', background: T.faint,
                }}
              />
            ) : (
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: T.accent,
                boxShadow: `0 0 0 4px ${T.accentSoft}`,
              }} />
            )}
            {isRinging ? '전화 거는 중…' : '통화 중'}
          </div>

          {/* Name (largest in hierarchy) */}
          <div style={{
            fontSize: 40, fontWeight: 700, color: T.text,
            letterSpacing: -1, lineHeight: 1.2, marginTop: 14,
            textAlign: 'center', maxWidth: '100%',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{callingContact.name}</div>

          {/* Phone number (smallest) */}
          {callingContact.sub && (
            <div style={{
              fontSize: 13, color: T.faint, marginTop: 6,
              fontWeight: 500, letterSpacing: -0.1,
            }}>{callingContact.sub}</div>
          )}

          {/* Live elapsed time — only during connected */}
          {!isRinging && (
            <div style={{
              fontSize: 56, fontWeight: 700, color: T.accent,
              letterSpacing: -2, marginTop: 28,
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            }}>{formatCallElapsed(elapsedSec)}</div>
          )}
        </div>

        {/* Mid-call controls — only after connected */}
        {!isRinging && (
          <div style={{ display: 'flex', gap: 12, marginTop: 32, marginBottom: 28 }}>
            <PhoneControl
              icon={muted ? <MicOff size={24} /> : <Mic size={24} />}
              label={muted ? '음소거 중' : '음소거'}
              active={muted}
              onClick={() => setMuted((m) => !m)}
            />
            <PhoneControl
              icon={speaker ? <Volume2 size={24} /> : <VolumeX size={24} />}
              label={speaker ? '스피커' : '핸즈프리'}
              active={speaker}
              onClick={() => setSpeaker((s) => !s)}
            />
          </div>
        )}

        {/* End call */}
        <div style={{
          display: 'flex', justifyContent: 'center',
          marginTop: isRinging ? 48 : 0,
        }}>
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={endCall}
            aria-label="통화 종료"
            style={{
              width: 96, height: 96, borderRadius: '50%',
              background: T.danger, border: 'none', color: 'white', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 12px 28px rgba(213, 72, 72, 0.45)',
            }}
          ><PhoneOff size={36} /></motion.button>
        </div>
      </Shell>
    )
  }

  /* ── LIST VIEW ──────────────────────────────────────── */
  return (
    <Shell title="전화" onBack={onClose}>
      {/* Segmented tabs */}
      <div style={{
        display: 'flex', background: T.chipGrad, borderRadius: T.radiusChip,
        padding: 6, marginBottom: 16, border: T.border, boxShadow: T.shadow,
      }}>
        {[{ k: 'favorites', label: '즐겨찾기' }, { k: 'recents', label: '최근 통화' }].map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              flex: 1, padding: '12px 0', border: 'none', cursor: 'pointer',
              background: tab === t.k ? T.keyGrad : 'transparent',
              color: tab === t.k ? 'white' : T.sub,
              borderRadius: T.radiusChip,
              fontSize: 18, fontWeight: 700, letterSpacing: -0.3,
              boxShadow: tab === t.k ? `0 6px 16px ${T.accentGlow}` : 'none',
              fontFamily: 'inherit',
              transition: 'background 0.2s, color 0.2s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'favorites' ? (
        // Single-column card list — name (largest) → 통화 chip (medium) →
        // phone number (smallest). A thin colored stripe on the left replaces
        // the old avatar so each contact still has a glance-able identifier.
        PHONE_FAVORITES.map((c) => (
          <motion.button
            whileTap={{ scale: 0.985 }}
            key={c.id}
            onClick={() => startCall(c)}
            style={{
              width: '100%', marginBottom: 12,
              background: T.card, border: T.border, borderRadius: 22,
              cursor: 'pointer', boxShadow: T.shadow,
              padding: '16px 18px',
              display: 'flex', alignItems: 'center', gap: 14,
              textAlign: 'left', fontFamily: 'inherit',
              position: 'relative', overflow: 'hidden',
            }}
          >
            {/* Color stripe (replaces avatar) */}
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: 5,
              background: c.color,
            }} />
            <div style={{ flex: 1, minWidth: 0, paddingLeft: 6 }}>
              <div style={{
                fontSize: 26, fontWeight: 700, color: T.text,
                letterSpacing: -0.7, lineHeight: 1.2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{c.name}</div>
              <div style={{
                fontSize: 12, color: T.faint, fontWeight: 500,
                letterSpacing: -0.1, marginTop: 4,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{c.sub}</div>
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: T.radiusChip,
              background: T.accentSoft, color: T.accent,
              fontSize: 16, fontWeight: 700, letterSpacing: -0.2,
              flexShrink: 0,
            }}>
              <PhoneIcon size={16} /> 통화
            </div>
          </motion.button>
        ))
      ) : (
        // Recents — same one-column card pattern, no avatar.
        recents.map((item) => (
          <motion.button
            whileTap={{ scale: 0.985 }}
            key={item.id}
            onClick={() => startCall(item)}
            style={{
              width: '100%', marginBottom: 12,
              background: T.card, border: T.border, borderRadius: 22,
              cursor: 'pointer', boxShadow: T.shadow,
              padding: '16px 18px',
              display: 'flex', alignItems: 'center', gap: 14,
              textAlign: 'left', fontFamily: 'inherit',
              position: 'relative', overflow: 'hidden',
            }}
          >
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: 5,
              background: item.color,
            }} />
            <div style={{ flex: 1, minWidth: 0, paddingLeft: 6 }}>
              <div style={{
                fontSize: 22, fontWeight: 700, color: T.text,
                letterSpacing: -0.5, lineHeight: 1.2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{item.name}</div>
              <div style={{
                fontSize: 13, color: T.sub, marginTop: 3,
                fontWeight: 500, letterSpacing: -0.2,
              }}>{item.when} · {item.dir}</div>
            </div>
            <PhoneIcon size={22} color={T.accent} style={{ flexShrink: 0 }} />
          </motion.button>
        ))
      )}
    </Shell>
  )
}

function PhoneControl({ icon, label, active, onClick }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      style={{
        flex: 1, padding: '22px 6px', borderRadius: 24, cursor: 'pointer',
        background: active ? T.keyGrad : T.chipGrad,
        border: active ? 'none' : T.border,
        color: active ? 'white' : T.sub,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        fontSize: 17, fontWeight: 600, letterSpacing: -0.3,
        boxShadow: active ? `0 6px 16px ${T.accentGlow}` : 'none',
        fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
      }}
    >
      {icon}<span>{label}</span>
    </motion.button>
  )
}

/* ============================================================
   Music
   ============================================================ */

const MUSIC_PLAYLISTS = [
  { id: 'drive', name: '드라이브 믹스', count: 24, mood: '시원한 팝', icon: '🚗' },
  { id: 'calm', name: 'Calm', count: 18, mood: '잔잔한 어쿠스틱', icon: '🌙' },
  { id: 'kindie', name: '한국 인디', count: 32, mood: '봄날의 멜로디', icon: '🎵' },
  { id: 'jazz', name: 'Late Night Jazz', count: 15, mood: '재즈 클래식', icon: '🎷' },
]

function MusicApp({ onClose }) {
  // Static (no-scroll) player view: just the now-playing card, transport
  // controls (prev / play-pause / next), and a playlist switcher. Volume,
  // shuffle, repeat, and the "next up" list are intentionally absent —
  // volume lives in the system-wide HMI, the others were noise for a
  // driving context.
  const [view, setView] = useState('player') // player | playlists
  const [playlist, setPlaylist] = useState('드라이브 믹스')
  const [trackIdx, setTrackIdx] = useState(0)
  const [playing, setPlaying] = useState(true)

  const queue = [
    { title: 'Drive', artist: 'The Cars', dur: '3:55' },
    { title: '하루의 끝', artist: '오존', dur: '4:12' },
    { title: 'Sunset Boulevard', artist: 'Lo-Fi Lab', dur: '3:34' },
    { title: '봄이 오는 길', artist: '김다영', dur: '3:18' },
    { title: 'Night Run', artist: 'Synthwave Crew', dur: '4:48' },
  ]
  const cur = queue[trackIdx]
  const goNext = () => setTrackIdx(i => (i + 1) % queue.length)
  const goPrev = () => setTrackIdx(i => (i - 1 + queue.length) % queue.length)

  // Per-second progress: real interval while playing, clamped at the track
  // duration. Resets on track change.
  const durToSec = (s) => {
    const [m, sec] = s.split(':').map(Number)
    return (m || 0) * 60 + (sec || 0)
  }
  const fmtMS = (sec) => {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  const totalSec = durToSec(cur.dur)
  const [playedSec, setPlayedSec] = useState(0)
  useEffect(() => { setPlayedSec(0) }, [trackIdx])
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      setPlayedSec((s) => (s + 1 >= totalSec ? totalSec : s + 1))
    }, 1000)
    return () => clearInterval(id)
  }, [playing, totalSec])
  const progressPct = Math.min(100, (playedSec / Math.max(1, totalSec)) * 100)

  /* ── PLAYLIST PICKER ─────────────────────────────────── */
  if (view === 'playlists') {
    return (
      <Shell title="플레이리스트" onBack={() => setView('player')}>
        {MUSIC_PLAYLISTS.map(p => {
          const active = p.name === playlist
          return (
            <motion.button
              whileTap={{ scale: 0.985 }}
              key={p.id}
              onClick={() => { setPlaylist(p.name); setTrackIdx(0); setPlaying(true); setView('player') }}
              style={{
                width: '100%', padding: '22px 26px', marginBottom: 14,
                background: active ? T.keyGrad : T.card,
                border: active ? 'none' : T.border,
                borderRadius: T.radiusCard, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 18, textAlign: 'left',
                boxShadow: active ? `0 8px 20px ${T.accentGlow}` : T.shadow,
                fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
              }}
            >
              <div style={{ fontSize: 40, width: 56, textAlign: 'center' }}>{p.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 26, fontWeight: 600, letterSpacing: -0.6,
                  color: active ? 'white' : T.text,
                }}>{p.name}</div>
                <div style={{
                  fontSize: 19, marginTop: 4, fontWeight: 500, letterSpacing: -0.3,
                  color: active ? 'rgba(255,255,255,0.85)' : T.sub,
                }}>{p.count}곡 · {p.mood}</div>
              </div>
              {active && <CircleDot size={26} color="white" />}
            </motion.button>
          )
        })}
      </Shell>
    )
  }

  const nextTrack = queue[(trackIdx + 1) % queue.length]
  const PLAYER_W = 280 // shared inner width for progress + transport — locks the
                       // visual rhythm to the album-art axis instead of letting
                       // the progress bar stretch full-panel.

  /* ── PLAYER VIEW (static, no-scroll) ─────────────────── */
  return (
    <Shell title="음악" onBack={onClose}>
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        overflow: 'hidden',
      }}>
        {/* Header: playlist label + switcher */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{
              fontSize: 11, color: T.faint, fontWeight: 700,
              letterSpacing: 1.6, textTransform: 'uppercase',
            }}>지금 재생</div>
            <div style={{
              fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: -0.4,
              marginTop: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{playlist}</div>
          </div>
          <motion.button
            whileTap={{ scale: 0.94 }}
            onClick={() => setView('playlists')}
            style={{
              background: T.chipGrad, color: T.sub, border: T.border, cursor: 'pointer',
              padding: '9px 14px', borderRadius: T.radiusChip,
              fontSize: 13, fontWeight: 600, letterSpacing: -0.3, flexShrink: 0,
              fontFamily: 'inherit',
            }}
          >플레이리스트 변경</motion.button>
        </div>

        {/* Main column — flex:1 distributes vertical space so the album sits
            visually anchored and the bottom isn't empty. */}
        <div style={{
          flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 0,
        }}>
          {/* Album art */}
          <div style={{
            width: 200, height: 200,
            background: `linear-gradient(135deg, ${T.accentHi} 0%, #8b5cf6 100%)`,
            borderRadius: T.radiusCard, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 84, fontWeight: 800,
            boxShadow: `0 16px 34px ${T.accentGlow}`,
            flexShrink: 0,
          }}>♪</div>

          {/* Title + artist — centered, controlled width */}
          <div style={{
            width: PLAYER_W, marginTop: 22, textAlign: 'center',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          }}>
            <div style={{
              fontSize: 26, fontWeight: 700, letterSpacing: -0.8,
              color: T.text, lineHeight: 1.2,
              width: '100%',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{cur.title}</div>
            <div style={{
              fontSize: 16, color: T.sub,
              fontWeight: 500, letterSpacing: -0.3, lineHeight: 1.3,
            }}>{cur.artist}</div>
          </div>

          {/* Progress — width locked to PLAYER_W so it tracks the album/transport */}
          <div style={{ width: PLAYER_W, marginTop: 24 }}>
            <div style={{
              height: 4, background: T.divider, borderRadius: 2, position: 'relative',
            }}>
              <div style={{
                width: `${progressPct}%`, height: '100%',
                background: T.keyGrad, borderRadius: 2,
                transition: 'width 1s linear',
              }} />
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 12, color: T.faint, marginTop: 7, fontWeight: 600,
              letterSpacing: 0.1, fontVariantNumeric: 'tabular-nums',
            }}>
              <span>{fmtMS(playedSec)}</span><span>{cur.dur}</span>
            </div>
          </div>

          {/* Transport — prev / play / next, same horizontal extent */}
          <div style={{
            width: PLAYER_W, marginTop: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={goPrev}
              style={{
                width: 60, height: 60, borderRadius: '50%',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: T.text, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="이전 곡"
            ><SkipBack size={34} /></motion.button>
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setPlaying(p => !p)}
              style={{
                width: 80, height: 80, borderRadius: '50%', background: T.keyGrad,
                border: 'none', cursor: 'pointer', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 10px 22px ${T.accentGlow}`,
              }}
              aria-label={playing ? '일시정지' : '재생'}
            >
              {playing
                ? <Pause size={34} fill="white" />
                : <Play size={34} fill="white" style={{ marginLeft: 3 }} />}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={goNext}
              style={{
                width: 60, height: 60, borderRadius: '50%',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: T.text, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="다음 곡"
            ><SkipForward size={34} /></motion.button>
          </div>
        </div>

        {/* Next-up — anchors the bottom, single line, no scroll */}
        <div style={{
          flexShrink: 0,
          background: T.chipGrad, border: T.border, borderRadius: T.radiusChip,
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <SkipForward size={16} color={T.faint} />
          <div style={{
            fontSize: 11, color: T.faint, fontWeight: 700,
            letterSpacing: 1.4, textTransform: 'uppercase', flexShrink: 0,
          }}>다음</div>
          <div style={{
            flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontSize: 14, fontWeight: 600, color: T.text, letterSpacing: -0.3,
          }}>
            {nextTrack.title}
            <span style={{ color: T.sub, fontWeight: 500, marginLeft: 8 }}>
              {nextTrack.artist}
            </span>
          </div>
        </div>
      </div>
    </Shell>
  )
}

/* ============================================================
   Mail
   ============================================================ */

function MailApp({ onClose }) {
  const [openId, setOpenId] = useState(null)

  const mails = [
    { id: 1, from: '카카오 알림', subject: '이번 주 일정 요약', preview: '오늘 회의 3건, 내일 1건이 예정되어 있습니다…', time: '오전 9:42', body: '안녕하세요.\n이번 주에 예정된 일정 요약입니다.\n\n• 오늘 10:00 디자인 리뷰\n• 오늘 14:30 사용자 테스트\n• 오늘 17:00 주간 회고\n• 내일 11:00 외부 미팅\n\n좋은 하루 보내세요!', unread: true },
    { id: 2, from: '쿠팡', subject: '주문하신 상품이 배송 출발했습니다', preview: '주문번호 92013483, 오늘 도착 예정…', time: '오전 8:15', body: '주문하신 상품(블루투스 키보드 외 1건)이 오늘 18시 이전에 도착할 예정입니다.\n현재 위치: 동탄 물류센터 출발 완료.', unread: true },
    { id: 3, from: '김민지', subject: '회의 자료 공유드립니다', preview: '첨부드린 자료 검토 부탁드려요…', time: '어제', body: '안녕하세요 PM님,\n내일 회의에 사용할 자료를 첨부드립니다. 검토 후 코멘트 부탁드립니다.\n\n감사합니다.\n김민지 드림', unread: false },
    { id: 4, from: 'GitHub', subject: '[PR] feat: add wake word integration', preview: 'A new pull request has been opened…', time: '어제', body: 'ystmk1 opened pull request #42 in HCI-prototype: feat: add wake word integration.\n+312 -47 lines.', unread: false },
    { id: 5, from: '하나카드', subject: '이번 달 청구 금액 안내', preview: '청구 예정 금액은 423,500원입니다…', time: '월요일', body: '안녕하세요. 5월 결제 예정 금액 안내드립니다.\n\n청구액: 423,500원\n결제일: 5월 25일', unread: false },
  ]

  const open = mails.find(m => m.id === openId)
  if (open) {
    return (
      <Shell title="메일" onBack={() => setOpenId(null)}>
        <div style={{
          fontSize: 30, fontWeight: 700, marginBottom: 18, letterSpacing: -0.8, lineHeight: 1.25,
        }}>{open.subject}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
          <Avatar initials={open.from[0]} color="#6366f1" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: T.text, letterSpacing: -0.4 }}>{open.from}</div>
            <div style={{ fontSize: 14, color: T.faint, marginTop: 2, fontWeight: 600 }}>{open.time}</div>
          </div>
        </div>
        <div style={{
          background: T.card, borderRadius: T.radiusCard, padding: 22,
          border: T.border, boxShadow: T.shadow,
          fontSize: 18, lineHeight: 1.6, fontWeight: 500, letterSpacing: -0.3,
          whiteSpace: 'pre-wrap', color: T.text,
        }}>{open.body}</div>
      </Shell>
    )
  }

  return (
    <Shell title="메일" onBack={onClose}>
      <SectionLabel>받은 편지함 · {mails.filter(m => m.unread).length}개 안 읽음</SectionLabel>
      {mails.slice(0, 4).map(m => (
        <ListItem
          key={m.id}
          leading={
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              background: m.unread ? T.accent : 'transparent',
              marginLeft: 6,
            }} />
          }
          title={m.subject}
          subtitle={`${m.from} · ${m.preview}`}
          trailing={m.time}
          onClick={() => setOpenId(m.id)}
        />
      ))}
    </Shell>
  )
}

/* ============================================================
   Calendar
   ============================================================ */

function CalendarApp({ onClose }) {
  const [openId, setOpenId] = useState(null)
  const today = new Date()
  const ymd = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][today.getDay()]}요일`

  const events = [
    { id: 1, title: '디자인 리뷰', when: '오늘 10:00 – 11:00', where: '회의실 A', notes: 'V2 와이어프레임 리뷰. 채팅 UX 변경점 위주.', color: '#5ba3d9', group: 'today' },
    { id: 2, title: '사용자 테스트', when: '오늘 14:30 – 16:00', where: '사용자 연구실', notes: '참가자 4명. 음성 wake-word 시나리오.', color: '#10b981', group: 'today' },
    { id: 3, title: '주간 회고', when: '오늘 17:00 – 17:30', where: '온라인 (Zoom)', notes: '이번 주 진행 상황 공유.', color: '#f59e0b', group: 'today' },
    { id: 4, title: '외부 미팅 (현대모비스)', when: '내일 11:00 – 12:30', where: '판교 본사', notes: 'HCI 협업안 1차 미팅.', color: '#6366f1', group: 'upcoming' },
    { id: 5, title: '치과 예약', when: '5월 19일 09:00', where: '강남 본점', notes: '정기 검진.', color: '#ef4444', group: 'upcoming' },
    { id: 6, title: '엄마 생신', when: '5월 22일 종일', where: '본가', notes: '저녁 식사 예약 필요.', color: '#ec4899', group: 'upcoming' },
  ]

  const open = events.find(e => e.id === openId)
  if (open) {
    return (
      <Shell title="일정" onBack={() => setOpenId(null)}>
        <div style={{
          background: T.card, borderRadius: T.radiusCard, padding: 22,
          border: T.border, boxShadow: T.shadow,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{ width: 8, height: 44, borderRadius: 4, background: open.color }} />
            <div style={{
              fontSize: 28, fontWeight: 700, letterSpacing: -0.7, lineHeight: 1.2,
            }}>{open.title}</div>
          </div>
          <Detail icon={<Clock size={20} />} label={open.when} />
          <Detail icon={<MapPin size={20} />} label={open.where} />
          <div style={{
            borderTop: `1px solid ${T.divider}`, marginTop: 20, paddingTop: 20,
            fontSize: 18, lineHeight: 1.6, color: T.text, fontWeight: 500, letterSpacing: -0.3,
          }}>{open.notes}</div>
        </div>
      </Shell>
    )
  }

  const today_ = events.filter(e => e.group === 'today')
  const upcoming = events.filter(e => e.group === 'upcoming')

  return (
    <Shell title="일정" onBack={onClose}>
      <div style={{ marginBottom: 18 }}>
        <div style={{
          fontSize: 11, color: T.faint, fontWeight: 700,
          letterSpacing: 1.4, textTransform: 'uppercase',
        }}>오늘</div>
        <div style={{
          fontSize: 24, fontWeight: 700, letterSpacing: -0.6,
          color: T.text, marginTop: 4, lineHeight: 1.2,
        }}>{ymd}</div>
      </div>
      <SectionLabel>오늘 일정</SectionLabel>
      {today_.slice(0, 2).map(e => (
        <ListItem
          key={e.id}
          leading={<div style={{ width: 8, height: 56, background: e.color, borderRadius: 4 }} />}
          title={e.title}
          subtitle={`${e.when.replace('오늘 ', '')} · ${e.where}`}
          onClick={() => setOpenId(e.id)}
        />
      ))}
      <SectionLabel style={{ marginTop: 22 }}>다가오는 일정</SectionLabel>
      {upcoming.slice(0, 2).map(e => (
        <ListItem
          key={e.id}
          leading={<div style={{ width: 8, height: 56, background: e.color, borderRadius: 4 }} />}
          title={e.title}
          subtitle={`${e.when} · ${e.where}`}
          onClick={() => setOpenId(e.id)}
        />
      ))}
    </Shell>
  )
}

function Detail({ icon, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      color: T.sub, marginBottom: 10, fontSize: 18, fontWeight: 500, letterSpacing: -0.3,
    }}>
      {icon}<span>{label}</span>
    </div>
  )
}

/* ============================================================
   Router
   ============================================================ */

export default function AppView({
  id, onClose,
  activeRoute, setActiveRoute,
  callingContact, callState, startCall, endCall,
  currentLocation,
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{ width: '100%', height: '100%' }}
      >
        {id === 'Navigation' && <NavigationAppMap onClose={onClose} activeRoute={activeRoute} setActiveRoute={setActiveRoute} currentLocation={currentLocation} />}
        {id === 'Phone' && <PhoneApp onClose={onClose} callingContact={callingContact} callState={callState} startCall={startCall} endCall={endCall} />}
        {id === 'Music' && <MusicApp onClose={onClose} />}
        {id === 'Mail' && <MailApp onClose={onClose} />}
        {id === 'Calendar' && <CalendarApp onClose={onClose} />}
      </motion.div>
    </AnimatePresence>
  )
}
