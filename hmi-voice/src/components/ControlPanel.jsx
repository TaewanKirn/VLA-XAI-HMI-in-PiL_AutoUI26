import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Snowflake, Flame, Wind, RotateCcw, Cloud,
  Tv, Music, Play, Store, Smartphone,
  ArrowLeft, Search,
} from 'lucide-react'

/* Sub-level design tokens — matches AppViews + main screen system */
const T = {
  bg: '#f7f8fa',
  card: '#ffffff',
  chipGrad: 'linear-gradient(87deg, #ffffff 5%, #edeef2 95%)',
  text: '#131417',
  sub: '#5c668d',
  faint: '#99a1af',
  divider: 'rgba(19, 20, 23, 0.08)',
  border: '1.5px solid rgba(0, 0, 0, 0.08)',
  borderFine: '1px solid rgba(0, 0, 0, 0.08)',
  keyGrad: 'linear-gradient(-90deg, #77a9e8 0%, #2d7cf1 100%)',
  accent: '#2d7cf1',
  accentSoft: 'rgba(45, 124, 241, 0.12)',
  accentGlow: 'rgba(45, 124, 241, 0.32)',
  warm: '#e85d5d',
  cool: '#4a90d9',
  skeleton: '#e7e9ef',
  shadow: '0px 6px 12px rgba(0, 0, 0, 0.08)',
  radiusCard: 32,
  radiusChip: 999,
  font: "'Pretendard Variable', 'Pretendard', sans-serif",
}

/* Active-state gradient palettes (per Figma) */
const WARM_GRAD = 'linear-gradient(116deg, #ff7a7a 0%, #e85d5d 100%)'
const COOL_GRAD = 'linear-gradient(115deg, #6db8ff 0%, #4a90d9 100%)'
const APP_ICON_PATH = '/icons/ott'

/* ─────────── Control tile ───────────
   Inactive: white card, dark text top-left, icon bottom-right.
   Active warm  → red gradient + white text/icon.
   Active cool  → blue gradient + white text/icon.
   Smooth color transition makes the toggle feel grounded.
*/
function ControlTile({ icon, label, active, accent, onClick }) {
  const isWarm = accent === T.warm
  const activeBg = isWarm ? WARM_GRAD : COOL_GRAD
  const textColor = active ? '#f7f8fa' : T.text
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      style={{
        position: 'relative',
        width: '100%', height: 134,
        background: active ? activeBg : '#ffffff',
        border: active ? 'none' : T.border,
        borderRadius: 14,
        cursor: 'pointer',
        padding: '22px 22px',
        textAlign: 'left',
        fontFamily: T.font,
        boxShadow: active ? '0 6px 16px rgba(0,0,0,0.10)' : 'none',
        transition: 'background 0.22s ease, color 0.22s ease, box-shadow 0.22s ease, border 0.22s ease',
      }}
    >
      <span style={{
        display: 'inline-block',
        fontSize: 20, fontWeight: active ? 600 : 500,
        color: textColor, letterSpacing: -0.4, lineHeight: 1.2,
        whiteSpace: 'pre-line',
        transition: 'color 0.22s ease',
      }}>{label}</span>
      <span style={{
        position: 'absolute', right: 22, bottom: 22,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: textColor,
        transition: 'color 0.22s ease',
      }}>{icon}</span>
    </motion.button>
  )
}

/* ─────────── Temperature slider card ───────────
   Card with label / temp / blue→red gradient slider with white knob.
   Slider styling lives in index.css (.ctrl-temp-slider) so we can target
   the browser-prefix thumb pseudo-elements.
*/
function TempSlider({ label, value, onChange, min = 17, max = 30 }) {
  return (
    <div style={{
      background: T.chipGrad,
      border: T.borderFine, borderRadius: 10,
      padding: '24px 24px',
      display: 'flex', flexDirection: 'column', gap: 18,
      height: 125, boxSizing: 'border-box',
      fontFamily: T.font,
    }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 500, color: T.text, letterSpacing: -0.16, lineHeight: 1.2 }}>{label}</div>
        <div style={{
          marginTop: 6, color: T.text, letterSpacing: -0.8,
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span style={{ fontSize: 32, fontWeight: 700 }}>{value.toFixed(1)}</span>
          <span style={{ fontSize: 24, fontWeight: 600 }}>°C</span>
        </div>
      </div>
      <input
        type="range"
        min={min} max={max} step={0.5}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="ctrl-temp-slider"
        aria-label={`${label} 온도`}
      />
    </div>
  )
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 32, fontWeight: 600, color: T.text, letterSpacing: -0.48,
        lineHeight: 1.6, fontFamily: T.font,
      }}>{title}</div>
      {subtitle && (
        <div style={{
          fontSize: 22, color: T.sub, fontWeight: 500, letterSpacing: -0.44,
          lineHeight: 1.4, fontFamily: T.font,
        }}>{subtitle}</div>
      )}
    </div>
  )
}

function CategoryLabel({ children }) {
  return (
    <div style={{
      fontSize: 24, fontWeight: 600, color: T.text, letterSpacing: -0.48,
      paddingTop: 8, marginBottom: 12, fontFamily: T.font,
      lineHeight: 1.3,
    }}>{children}</div>
  )
}

/* ─────────── OTT app icon tile ───────────
   Renders the PNG as <img> with object-fit: cover so the source — whichever
   aspect ratio it arrived in — is square-cropped centered. Lucide Store
   fallback for the "앱 마켓" tile (no asset image).
*/
function AppTile({ src, label, color, fallbackIcon, onClick }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        fontFamily: T.font,
      }}
    >
      <div style={{
        width: 80, height: 80, borderRadius: 18,
        background: color, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white',
        boxShadow: '0 8px 12px rgba(0,0,0,0.12)',
        flexShrink: 0,
      }}>
        {src ? (
          <img
            src={src}
            alt={label}
            draggable={false}
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center',
              display: 'block',
            }}
          />
        ) : (
          fallbackIcon
        )}
      </div>
      <span style={{
        fontSize: 18, fontWeight: 500, color: T.text, letterSpacing: -0.48,
        lineHeight: 1.3,
      }}>{label}</span>
    </motion.button>
  )
}

/* ─────────── App wireframe screens (kept) ─────────── */

function Sk({ w = '100%', h, r = 12, style }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: T.skeleton, flexShrink: 0, ...style }} />
}

function WireframeRow({ count = 5, cardW = 260, cardH = 156 }) {
  return (
    <div style={{ marginTop: 30 }}>
      <Sk w={200} h={22} r={8} />
      <div style={{ display: 'flex', gap: 18, marginTop: 16, overflow: 'hidden' }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i}>
            <Sk w={cardW} h={cardH} r={16} />
            <Sk w={cardW * 0.7} h={14} r={6} style={{ marginTop: 10 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function VideoWireframe({ app }) {
  return (
    <div style={{ padding: 44, height: '100%', overflowY: 'auto' }}>
      <div style={{
        height: 300, borderRadius: 24,
        background: `linear-gradient(150deg, ${app.color} 0%, rgba(20,20,28,0.92) 130%)`,
        position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        padding: 36, overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 28, right: 32, width: 76, height: 76, borderRadius: '50%',
          background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Play size={34} fill={app.color} strokeWidth={0} style={{ marginLeft: 4 }} />
        </div>
        <Sk w={360} h={30} r={8} style={{ background: 'rgba(255,255,255,0.65)' }} />
        <Sk w={520} h={16} r={6} style={{ background: 'rgba(255,255,255,0.45)', marginTop: 14 }} />
      </div>
      <WireframeRow count={5} />
      <WireframeRow count={5} />
    </div>
  )
}

function MusicWireframe({ app }) {
  return (
    <div style={{ padding: 44, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
        <Sk w={220} h={220} r={20} style={{ background: `linear-gradient(150deg, ${app.color} 0%, rgba(20,20,28,0.85) 130%)` }} />
        <div style={{ flex: 1 }}>
          <Sk w={140} h={16} r={6} />
          <Sk w={420} h={34} r={8} style={{ marginTop: 16 }} />
          <Sk w={260} h={16} r={6} style={{ marginTop: 16 }} />
          <Sk w={150} h={48} r={999} style={{ marginTop: 28, background: app.color, opacity: 0.85 }} />
        </div>
      </div>
      <Sk w={180} h={22} r={8} style={{ marginTop: 40 }} />
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 22, marginTop: 18,
      }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i}>
            <Sk w="100%" h={180} r={16} />
            <Sk w="80%" h={14} r={6} style={{ marginTop: 10 }} />
            <Sk w="55%" h={12} r={6} style={{ marginTop: 7 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function StoreWireframe() {
  return (
    <div style={{ padding: 44, height: '100%', overflowY: 'auto' }}>
      <div style={{
        height: 56, borderRadius: 999, background: T.skeleton,
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px',
      }}>
        <Search size={24} color={T.faint} />
        <Sk w={220} h={14} r={6} style={{ background: '#d6d9e2' }} />
      </div>
      <Sk w={160} h={22} r={8} style={{ marginTop: 36 }} />
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, marginTop: 18,
      }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{
            background: T.card, border: T.border, borderRadius: 22,
            padding: 18, display: 'flex', alignItems: 'center', gap: 16,
          }}>
            <Sk w={72} h={72} r={18} />
            <div style={{ flex: 1 }}>
              <Sk w="60%" h={16} r={6} />
              <Sk w="40%" h={12} r={6} style={{ marginTop: 9 }} />
            </div>
            <div style={{
              width: 84, height: 40, borderRadius: 999, background: T.accentSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.accent, fontSize: 15, fontWeight: 700, fontFamily: T.font,
            }}>설치</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AppScreen({ app, onBack }) {
  const Body = app.key === 'store'
    ? StoreWireframe
    : app.key === 'spotify'
    ? MusicWireframe
    : VideoWireframe
  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: T.bg }}
    >
      <div style={{
        padding: '20px 36px', display: 'flex', alignItems: 'center', gap: 18,
        borderBottom: `1px solid ${T.divider}`, background: T.card, flexShrink: 0,
      }}>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onBack}
          style={{
            background: T.chipGrad, border: T.border, cursor: 'pointer',
            width: 52, height: 52, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text,
          }}
        ><ArrowLeft size={26} strokeWidth={2.2} /></motion.button>
        <div style={{
          width: 46, height: 46, borderRadius: 13, background: app.color, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
        }}>
          {app.src
            ? <img src={app.src} alt={app.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Store size={22} color="white" />}
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, color: T.text, letterSpacing: -0.5 }}>{app.label}</div>
        <div style={{
          marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: T.faint,
          border: `1px dashed ${T.faint}`, borderRadius: 999, padding: '6px 14px',
        }}>와이어프레임</div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}><Body app={app} /></div>
    </motion.div>
  )
}

/* ─────────── Panel ─────────── */

export default function ControlPanel({ onClose }) {
  const [controls, setControls] = useState({
    autoClimate: true,
    recirculate: false,
    defrostFront: true,
    defrostRear: true,
    driverHeat: true,
    passengerHeat: true,
    driverVent: false,
    passengerVent: false,
  })
  const toggle = (k) => setControls(c => ({ ...c, [k]: !c[k] }))

  const [driverTemp, setDriverTemp] = useState(22)
  const [passengerTemp, setPassengerTemp] = useState(24)

  const [openApp, setOpenApp] = useState(null)

  // Climate (HVAC) row
  const climate = [
    { key: 'autoClimate', label: 'AUTO\n공조', icon: <Cloud size={34} />, accent: T.cool },
    { key: 'recirculate', label: '대기\n순환', icon: <RotateCcw size={34} />, accent: T.cool },
    { key: 'defrostFront', label: '앞유리\n서리 제거', icon: <Wind size={34} />, accent: T.cool },
    { key: 'defrostRear', label: '뒷유리\n서리 제거', icon: <Wind size={34} style={{ transform: 'scaleX(-1)' }} />, accent: T.cool },
  ]
  // Seat row — heat (warm) + vent (cool). No 스티어링.
  const seats = [
    { key: 'driverHeat',    label: '운전석\n열선', icon: <Flame size={34} />,    accent: T.warm },
    { key: 'passengerHeat', label: '동승석\n열선', icon: <Flame size={34} />,    accent: T.warm },
    { key: 'driverVent',    label: '운전석\n통풍', icon: <Snowflake size={34} />, accent: T.cool },
    { key: 'passengerVent', label: '동승석\n통풍', icon: <Snowflake size={34} />, accent: T.cool },
  ]
  const grid4 = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 21 }

  const apps = [
    { key: 'netflix', label: 'Netflix',  src: `${APP_ICON_PATH}/netflix.png`,  color: '#000000' },
    { key: 'youtube', label: 'YouTube',  src: `${APP_ICON_PATH}/youtube.png`,  color: '#ff0000' },
    { key: 'tving',   label: 'TVING',    src: `${APP_ICON_PATH}/tving.png`,    color: '#ec0a8c' },
    { key: 'wavve',   label: 'Wavve',    src: `${APP_ICON_PATH}/wavve.png`,    color: '#0077ff' },
    { key: 'disney',  label: 'Disney+',  src: `${APP_ICON_PATH}/disney.png`,   color: '#0f1f4d' },
    { key: 'spotify', label: 'Spotify',  src: `${APP_ICON_PATH}/spotify.png`,  color: '#1db954' },
    { key: 'apple',   label: 'Apple TV', src: `${APP_ICON_PATH}/appletv.png`,  color: '#000000' },
    { key: 'store',   label: '앱 마켓',  src: null, color: T.accent, fallbackIcon: <Store size={36} color="white" /> },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 50,
        background: 'rgba(19, 20, 23, 0.45)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1722, height: 920,
          background: T.bg, borderRadius: 40,
          boxShadow: '0 -20px 60px rgba(0, 0, 0, 0.3)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          marginBottom: 24,
          fontFamily: T.font,
        }}
      >
        {/* Header */}
        <div style={{
          padding: '22px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `0.8px solid ${T.divider}`, background: T.card, flexShrink: 0,
        }}>
          <div style={{
            fontSize: 26, fontWeight: 600, letterSpacing: -0.8, color: T.text,
            lineHeight: 1.5,
          }}>차량 제어 & 미디어</div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            style={{
              background: T.chipGrad, border: T.border, cursor: 'pointer',
              width: 48, height: 48, borderRadius: 24,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.text, boxShadow: '0 6px 6px rgba(0,0,0,0.08)',
            }}
          ><X size={24} strokeWidth={2.2} /></motion.button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
            {/* Left: vehicle controls (Figma ratio ≈ 1.36 : 1.0) */}
            <div style={{
              flex: 1.36, padding: '28px 30px 28px 49px', overflowY: 'auto',
              borderRight: `0.8px solid ${T.divider}`,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <CategoryLabel>온도</CategoryLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <TempSlider label="운전석" value={driverTemp} onChange={setDriverTemp} />
                <TempSlider label="동승석" value={passengerTemp} onChange={setPassengerTemp} />
              </div>

              <CategoryLabel>공조</CategoryLabel>
              <div style={grid4}>
                {climate.map(c => (
                  <ControlTile
                    key={c.key} icon={c.icon} label={c.label}
                    active={controls[c.key]} accent={c.accent}
                    onClick={() => toggle(c.key)}
                  />
                ))}
              </div>

              <CategoryLabel>시트</CategoryLabel>
              <div style={grid4}>
                {seats.map(c => (
                  <ControlTile
                    key={c.key} icon={c.icon} label={c.label}
                    active={controls[c.key]} accent={c.accent}
                    onClick={() => toggle(c.key)}
                  />
                ))}
              </div>
            </div>

            {/* Right: media & apps */}
            <div style={{
              flex: 1, padding: '28px 29px', overflowY: 'auto', background: T.card,
              display: 'flex', flexDirection: 'column', gap: 45,
            }}>
              <SectionHeader title="미디어 & 앱" subtitle="자율주행 중 즐기는 OTT · 음악" />

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                rowGap: 36, columnGap: 18,
              }}>
                {apps.map(a => (
                  <AppTile
                    key={a.key}
                    src={a.src} label={a.label} color={a.color}
                    fallbackIcon={a.fallbackIcon}
                    onClick={() => setOpenApp(a)}
                  />
                ))}
              </div>

              {/* Phone connection — gradient strip card */}
              <div style={{
                background: 'linear-gradient(71deg, #ffffff 5%, #edeef2 95%)',
                border: T.borderFine, borderRadius: 10,
                width: '100%', maxWidth: 501, height: 75,
                display: 'flex', alignItems: 'center', gap: 24,
                padding: '0 33px 0 50px',
                boxShadow: '0 6px 6px rgba(0,0,0,0.08)',
                alignSelf: 'center',
              }}>
                <Smartphone size={28} color={T.text} strokeWidth={2} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 18, fontWeight: 600, color: T.text,
                    letterSpacing: -0.24, lineHeight: 1.2,
                  }}>휴대폰 연결</div>
                  <div style={{
                    fontSize: 14, fontWeight: 400, color: T.sub,
                    marginTop: 2, lineHeight: 1.2,
                  }}>Android Auto / CarPlay 자동 연결됨</div>
                </div>
              </div>
            </div>
          </div>

          {/* App wireframe overlay */}
          <AnimatePresence>
            {openApp && (
              <motion.div
                style={{ position: 'absolute', inset: 0, zIndex: 5 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <AppScreen app={openApp} onBack={() => setOpenApp(null)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  )
}
