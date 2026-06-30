import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useRef } from 'react'
import {
  X, Maximize2, Shrink,
  Search, Home as HomeIcon, Star, Clock,
  MapPin, Navigation as NavIcon, ArrowLeft,
  Fuel, ParkingMeter, Zap, Coffee, UtensilsCrossed,
  Volume2, VolumeX, Loader2,
} from 'lucide-react'

import {
  KAKAO_JS_KEY, DEFAULT_CENTER, loadKakaoSdk, fetchDrivingRoute,
  formatDuration, formatDistance,
} from '../utils/kakaoNav'

import imgMap from '../../assets/images/image 21.png'

// Static favorites + suggested places. lat/lng are required for OSRM routing.
const PLACES = [
  { id: 1, name: '집',              addr: '서울 마포구 합정동',         icon: HomeIcon,        cat: 'home',    lat: 37.5495, lng: 126.9136 },
  { id: 2, name: '회사',            addr: '서울 강남구 테헤란로 152',   icon: 'work',          cat: 'work',    lat: 37.5006, lng: 127.0364 },
  { id: 3, name: '스타벅스 강남점', addr: '서울 강남구 강남대로 390',   icon: Coffee,          cat: 'cafe',    lat: 37.4979, lng: 127.0276 },
  { id: 4, name: '아버지 댁',       addr: '경기 성남시 분당구 정자동',  icon: HomeIcon,        cat: 'family',  lat: 37.3675, lng: 127.1085 },
  { id: 5, name: 'SK주유소 양재점', addr: '서울 서초구 양재대로 100',   icon: Fuel,            cat: 'fuel',    lat: 37.4843, lng: 127.0397 },
  { id: 6, name: '코엑스 주차장',   addr: '서울 강남구 영동대로 513',   icon: ParkingMeter,    cat: 'parking', lat: 37.5126, lng: 127.0589 },
  { id: 7, name: '한남동 맛집거리', addr: '서울 용산구 한남대로 27',    icon: UtensilsCrossed, cat: 'food',    lat: 37.5341, lng: 127.0010 },
  { id: 8, name: 'GS칼텍스 충전소', addr: '서울 강남구 봉은사로 524',   icon: Zap,             cat: 'charge',  lat: 37.5126, lng: 127.0531 },
]

const CATEGORIES = [
  { id: 'fuel',    label: '주유소',  icon: Fuel,            color: '#E85D5D' },
  { id: 'parking', label: '주차장',  icon: ParkingMeter,    color: '#4A90D9' },
  { id: 'charge',  label: '충전소',  icon: Zap,             color: '#34C759' },
  { id: 'cafe',    label: '카페',    icon: Coffee,          color: '#A07855' },
  { id: 'food',    label: '맛집',    icon: UtensilsCrossed, color: '#FF9500' },
]

const RECENT_SEARCHES = ['강남역', '집', '코엑스', '연남동 카페', '인천공항']

// Synthetic alternative deltas applied on top of the real OSRM route.
const ROUTE_VARIANTS = [
  { label: '추천', etaDelta: 0,  kmDelta: 0,     detail: '통행료 2,300원 · 신호 6개',  tag: '가장 빠름' },
  { label: '최단', etaDelta: -2, kmDelta: -0.4,  detail: '통행료 3,800원 · 신호 4개',  tag: '짧음' },
  { label: '무료', etaDelta: 6,  kmDelta: 1.8,   detail: '통행료 0원 · 신호 11개',     tag: '무료' },
]

export default function NavigationApp({
  isFullscreen, setIsFullscreen, isBriefingOpen, onClose,
  activeRoute, setActiveRoute, currentLocation, initialView,
}) {
  const [activeTab, setActiveTab] = useState(initialView === 'search' ? 'Search' : 'Home')
  const [view, setView] = useState(initialView === 'search' ? 'search' : 'home') // home | search | route
  const [destination, setDestination] = useState(null)
  const [routeIdx, setRouteIdx] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [favIds, setFavIds] = useState(new Set([1, 2]))
  const [muted, setMuted] = useState(false)

  // Kakao Places real keyword search (debounced)
  const [kakaoResults, setKakaoResults] = useState([])
  const [searching, setSearching] = useState(false)
  const placesServiceRef = useRef(null)

  // OSRM preview route fetched when a destination is chosen.
  const [previewRoute, setPreviewRoute] = useState(null) // { distance, duration, geometry }
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState(null)

  // Kakao map refs (full-screen view)
  const mapElRef = useRef(null)
  const mapRef = useRef(null)
  const polylineRef = useRef(null)
  const destMarkerRef = useRef(null)
  const originCircleRef = useRef(null)
  const [kakaoErr, setKakaoErr] = useState(null)

  const origin = currentLocation ?? DEFAULT_CENTER

  const briefingWidth = 420 + 30 + 16
  const getWidth = () => {
    if (isFullscreen && isBriefingOpen) return 1920 - briefingWidth
    if (isFullscreen) return 1920
    if (isBriefingOpen) return 1410 - briefingWidth
    return 1410
  }
  const getLeft = () => (isFullscreen ? 0 : 461)
  const isNarrow = !isFullscreen || isBriefingOpen
  const filtered = selectedCategory ? PLACES.filter(p => p.cat === selectedCategory) : PLACES

  const toggleFav = (id) => {
    setFavIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const pickDestination = (place) => {
    setDestination(place)
    setRouteIdx(0)
    setView('route')
  }

  // ── Kakao Places keyword search (real, debounced) ──────────
  // The SDK is loaded the moment the user types anything so the search bar
  // works even before the fullscreen map mounts. Results are mapped to the
  // same shape as static PLACES so picking one flows through the existing
  // OSRM → confirm pipeline.
  useEffect(() => {
    const q = searchText.trim()
    if (!q || view !== 'search') {
      setKakaoResults([])
      setSearching(false)
      return
    }
    if (!KAKAO_JS_KEY) return
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      loadKakaoSdk(KAKAO_JS_KEY)
        .then((kakao) => {
          if (cancelled) return
          if (!placesServiceRef.current) {
            placesServiceRef.current = new kakao.maps.services.Places()
          }
          placesServiceRef.current.keywordSearch(q, (data, status) => {
            if (cancelled) return
            setSearching(false)
            if (status !== kakao.maps.services.Status.OK) {
              setKakaoResults([])
              return
            }
            setKakaoResults(
              data.slice(0, 12).map((p) => ({
                id: `k_${p.id}`,
                name: p.place_name,
                addr: p.road_address_name || p.address_name || '',
                category: p.category_group_name || '',
                lat: parseFloat(p.y),
                lng: parseFloat(p.x),
                kakao: true,
              }))
            )
          })
        })
        .catch(() => { if (!cancelled) { setSearching(false); setKakaoResults([]) } })
    }, 280) // debounce
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchText, view])

  // ── Fetch OSRM route when a destination is selected ─────────
  useEffect(() => {
    if (view !== 'route' || !destination) return
    let cancelled = false
    setPreviewRoute(null)
    setRouteError(null)
    setRouteLoading(true)
    fetchDrivingRoute(origin, destination)
      .then((r) => {
        if (cancelled) return
        setPreviewRoute(r)
        setRouteLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setRouteError(err.message || '경로를 찾을 수 없습니다')
        setRouteLoading(false)
      })
    return () => { cancelled = true }
  }, [view, destination?.id, origin.lat, origin.lng])

  // ── Kakao map: instantiate when fullscreen ──────────────────
  useEffect(() => {
    if (!isFullscreen || !mapElRef.current || view === 'route') return
    if (!KAKAO_JS_KEY) { setKakaoErr('VITE_KAKAO_JS_KEY 미설정'); return }
    if (mapRef.current) return
    let cancelled = false
    loadKakaoSdk(KAKAO_JS_KEY)
      .then((kakao) => {
        if (cancelled || !mapElRef.current) return
        const center = new kakao.maps.LatLng(origin.lat, origin.lng)
        const map = new kakao.maps.Map(mapElRef.current, { center, level: 6 })
        mapRef.current = map
        const circle = new kakao.maps.Circle({
          center, radius: 60, strokeWeight: 3, strokeColor: '#2d7cf1',
          strokeOpacity: 0.9, fillColor: '#2d7cf1', fillOpacity: 0.3,
        })
        circle.setMap(map)
        originCircleRef.current = circle
      })
      .catch((err) => { if (!cancelled) setKakaoErr(err.message) })
    return () => { cancelled = true }
  }, [isFullscreen, view, origin.lat, origin.lng])

  // Tear down map when leaving fullscreen or switching to route view
  useEffect(() => {
    if (isFullscreen && view !== 'route') return
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null }
    if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null }
    if (originCircleRef.current) { originCircleRef.current.setMap(null); originCircleRef.current = null }
    mapRef.current = null
  }, [isFullscreen, view])

  // ── Confirm route → push to App via setActiveRoute ─────────
  const confirmRoute = () => {
    if (!destination || !previewRoute) return
    const v = ROUTE_VARIANTS[routeIdx]
    const durationSec = Math.max(60, previewRoute.duration + v.etaDelta * 60)
    const distanceM = Math.max(100, previewRoute.distance + v.kmDelta * 1000)
    const now = new Date()
    setActiveRoute?.({
      destination: { name: destination.name, addr: destination.addr, lat: destination.lat, lng: destination.lng },
      geometry: previewRoute.geometry,
      distanceM,
      durationSec,
      departureIso: now.toISOString(),
      baseArrivalIso: new Date(now.getTime() + durationSec * 1000).toISOString(),
      variant: v.label,
    })
    onClose?.()
  }

  const clearActiveRoute = () => setActiveRoute?.(null)

  const TABS = [
    { id: 'Home',      icon: HomeIcon },
    { id: 'Search',    icon: Search },
    { id: 'Favorites', icon: Star },
    { id: 'Recent',    icon: Clock },
  ]

  const baseDurationSec = previewRoute?.duration ?? 0
  const baseDistanceM = previewRoute?.distance ?? 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 60, left: getLeft(), top: isFullscreen ? 79 : 104, width: getWidth(), height: isFullscreen ? 880 : 830 }}
      animate={{ opacity: 1, y: 0, scale: 1, width: getWidth(), height: isFullscreen ? 880 : 830, left: getLeft(), top: isFullscreen ? 79 : 104 }}
      exit={{ opacity: 0, y: 60 }}
      transition={{ type: 'spring', stiffness: 250, damping: 30 }}
      className={`absolute z-30 overflow-hidden ${isFullscreen ? '' : 'border border-[rgba(19,20,23,0.05)]'}`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(237,238,242,0.95) 100%)',
        backdropFilter: 'blur(20px)',
        boxShadow: isFullscreen ? 'none' : '0px 12px 48px 0px rgba(0,0,0,0.12)',
        borderRadius: isFullscreen ? '0px' : '32px',
      }}
    >
      {/* Window Controls */}
      <div className="absolute top-[30px] right-[40px] flex items-center gap-[16px] z-10">
        <button onClick={() => setMuted(m => !m)}
          className="btn-window-ctrl"
          aria-label={muted ? "음소거 해제" : "음소거"}>
          {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <button onClick={() => setIsFullscreen(!isFullscreen)}
          className="btn-window-ctrl"
          aria-label={isFullscreen ? "축소" : "최대화"}>
          {isFullscreen ? <Shrink size={20} /> : <Maximize2 size={20} />}
        </button>
        <button onClick={onClose}
          className="btn-window-ctrl"
          aria-label="닫기">
          <X size={20} />
        </button>
      </div>

      <div className="flex w-full h-full">
        {/* Sidebar */}
        <div className={`border-r border-[rgba(19,20,23,0.05)] bg-[rgba(255,255,255,0.3)] flex flex-col pt-[40px] shrink-0 transition-all duration-300 ${isNarrow ? 'w-[100px] items-center' : 'w-[260px]'}`}>
          <div className="flex flex-col gap-[8px] px-[16px] mt-[80px]">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setView(tab.id === 'Search' ? 'search' : 'home'); setDestination(null) }}
                className={`sidebar-tab ${activeTab === tab.id ? 'active' : ''} ${
                  isNarrow ? 'justify-center w-[68px] h-[60px] mx-auto' : 'px-[20px] py-[16px] w-[228px]'
                }`}
              >
                <tab.icon size={22} />
                {!isNarrow && <span className="ml-[16px] text-[18px]">{tab.id}</span>}
              </button>
            ))}
          </div>

          {/* Active route indicator in sidebar */}
          {!isNarrow && activeRoute && (
            <div className="mt-auto mb-[24px] mx-[16px] p-[14px] rounded-[16px] bg-[#2d7cf1]/10 border border-[#2d7cf1]/30">
              <p className="text-[12px] font-semibold text-[#2d7cf1] uppercase tracking-wider mb-[4px]">안내 중</p>
              <p className="text-[14px] font-semibold text-[#131417] truncate">{activeRoute.destination.name}</p>
              <button onClick={clearActiveRoute} className="mt-[8px] text-[12px] text-[#2d7cf1] underline">안내 종료</button>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className={`flex-1 flex flex-col h-full ${isNarrow ? 'p-[40px]' : 'p-[60px]'} overflow-hidden`}>
          {/* Route view */}
          {view === 'route' && destination ? (
            <div className="flex flex-col h-full">
              <button
                onClick={() => { setDestination(null); setView(activeTab === 'Search' ? 'search' : 'home'); setPreviewRoute(null) }}
                className="self-start btn-secondary !h-[48px] !px-4 mb-[24px] !rounded-[12px]"
              >
                <ArrowLeft size={20} /> 뒤로
              </button>

              <div className="flex items-center gap-[18px] mb-[28px]">
                <div className="w-[64px] h-[64px] rounded-[20px] bg-white border border-[rgba(19,20,23,0.08)] flex items-center justify-center shrink-0 shadow-[0px_6px_12px_rgba(0,0,0,0.06)]">
                  <NavIcon size={28} className="text-[#2d7cf1]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-medium text-[#99a1af] leading-[22px]">목적지</p>
                  <p className="text-[28px] font-semibold text-[#131417] leading-[36px] tracking-[-0.6px] truncate">{destination.name}</p>
                  <p className="text-[15px] text-[#99a1af] truncate">{destination.addr}</p>
                </div>
              </div>

              {routeLoading && (
                <div className="flex items-center justify-center gap-3 py-[40px] text-[#99a1af]">
                  <Loader2 size={20} className="animate-spin" />
                  <span>경로 계산 중...</span>
                </div>
              )}

              {routeError && (
                <div className="p-[20px] rounded-[16px] bg-red-50 border border-red-200 text-red-700 text-[14px] mb-[20px]">
                  경로를 가져올 수 없습니다: {routeError}
                </div>
              )}

              {previewRoute && !routeLoading && (
                <>
                  <div className="grid grid-cols-3 gap-[12px] mb-[24px]">
                    {ROUTE_VARIANTS.map((r, i) => {
                      const isActive = routeIdx === i
                      const durMin = Math.max(1, Math.round((baseDurationSec + r.etaDelta * 60) / 60))
                      const distKm = Math.max(0.1, (baseDistanceM + r.kmDelta * 1000) / 1000)
                      return (
                        <button
                          key={r.label}
                          onClick={() => setRouteIdx(i)}
                          className={`text-left p-[18px] rounded-[20px] border transition-all ${
                            isActive
                              ? 'bg-white border-[#2d7cf1] shadow-[0px_8px_20px_rgba(45,124,241,0.15)]'
                              : 'bg-white/60 border-[rgba(19,20,23,0.08)] hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-[8px]">
                            <span className={`text-[18px] font-semibold ${isActive ? 'text-[#2d7cf1]' : 'text-[#131417]'}`}>{r.label}</span>
                            <span className="text-[11px] font-semibold text-[#99a1af] px-[8px] py-[2px] rounded-full bg-[rgba(19,20,23,0.05)]">{r.tag}</span>
                          </div>
                          <p className="text-[22px] font-bold text-[#131417] tabular-nums">{durMin}<span className="text-[13px] font-normal text-[#99a1af] ml-[3px]">분</span></p>
                          <p className="text-[13px] text-[#99a1af] mt-[4px] tabular-nums">{distKm.toFixed(1)} km · {r.detail}</p>
                        </button>
                      )
                    })}
                  </div>

                  <button
                    onClick={confirmRoute}
                    className="btn-primary w-full !h-[64px] !rounded-[16px] text-[20px] !shadow-[0_10px_24px_rgba(45,124,241,0.32)]"
                  >
                    <NavIcon size={22} /> {ROUTE_VARIANTS[routeIdx].label} 경로로 안내 시작
                  </button>

                  {isFullscreen && (
                    <div className="mt-[24px] flex-1 rounded-[24px] overflow-hidden border border-[rgba(19,20,23,0.08)] relative bg-[#f7f8fa]">
                      <RouteMapPreview origin={origin} destination={destination} geometry={previewRoute.geometry} />
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              {/* Search bar */}
              <div className="search-container mb-[28px]">
                <Search size={22} className="text-[#99a1af] mr-3 shrink-0" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="어디로 갈까요?"
                  className="flex-1 text-[18px] outline-none bg-transparent placeholder:text-[#99a1af]"
                />
              </div>

              {view === 'home' && (
                <div className="flex items-center gap-[12px] mb-[28px] overflow-x-auto pb-[4px]">
                  {CATEGORIES.map((c) => {
                    const isActive = selectedCategory === c.id
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCategory(isActive ? null : c.id)}
                        className={`flex items-center gap-[8px] px-[18px] py-[10px] h-[44px] rounded-full border transition-all shrink-0 ${
                          isActive 
                            ? 'bg-[#131417] text-white border-[#131417]' 
                            : 'bg-white text-[#131417] border-[rgba(19,20,23,0.1)] hover:bg-[#f7f8fa]'
                        }`}
                      >
                        <c.icon size={18} style={{ color: isActive ? '#fff' : c.color }} />
                        <span className="text-[15px] font-medium">{c.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {view === 'search' && !searchText.trim() && (
                <div className="mb-[24px]">
                  <p className="text-[14px] font-semibold text-[#99a1af] mb-[12px] uppercase tracking-wider">최근 검색</p>
                  <div className="flex flex-wrap gap-[8px]">
                    {RECENT_SEARCHES.map((s) => (
                      <button key={s} onClick={() => setSearchText(s)}
                        className="px-[16px] py-[10px] rounded-full bg-white border border-[rgba(19,20,23,0.1)] text-[16px] text-[#131417] hover:bg-[#f7f8fa] flex items-center gap-[6px]">
                        <Clock size={14} className="text-[#99a1af]" /> {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto pr-[8px] -mr-[8px]">
                {view === 'search' && searchText.trim() ? (
                  <>
                    <p className="text-[14px] font-semibold text-[#99a1af] mb-[12px] uppercase tracking-wider flex items-center gap-2">
                      카카오 검색 결과
                      {searching && <Loader2 size={14} className="animate-spin" />}
                    </p>
                    {!KAKAO_JS_KEY && (
                      <p className="text-[14px] text-[#99a1af] py-[20px]">
                        VITE_KAKAO_JS_KEY 미설정 — 실 검색을 쓰려면 .env.local 에 키를 추가해 주세요.
                      </p>
                    )}
                    {KAKAO_JS_KEY && !searching && kakaoResults.length === 0 && (
                      <p className="text-[14px] text-[#99a1af] py-[20px]">검색 결과가 없습니다.</p>
                    )}
                    <div className="flex flex-col gap-[10px]">
                      {kakaoResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => pickDestination(p)}
                          className="w-full list-item flex items-center gap-[16px] !p-[16px] text-left mb-[8px]"
                        >
                          <div className="w-[48px] h-[48px] rounded-[14px] bg-[#f7f8fa] flex items-center justify-center shrink-0 border border-[rgba(19,20,23,0.06)]">
                            <MapPin size={22} className="text-[#131417]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[18px] font-semibold text-[#131417] truncate">{p.name}</p>
                            <p className="text-[15px] text-[#99a1af] truncate">
                              {p.category ? `${p.category} · ` : ''}{p.addr}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[14px] font-semibold text-[#99a1af] mb-[12px] uppercase tracking-wider">
                      {selectedCategory ? CATEGORIES.find(c => c.id === selectedCategory)?.label : activeTab === 'Favorites' ? '즐겨찾기' : '추천 장소'}
                    </p>
                    <div className="flex flex-col gap-[10px]">
                      {(activeTab === 'Favorites' ? PLACES.filter(p => favIds.has(p.id)) : filtered).map((p) => {
                        const Icon = typeof p.icon === 'function' ? p.icon : MapPin
                        const isFav = favIds.has(p.id)
                        return (
                          <button
                            key={p.id}
                            onClick={() => pickDestination(p)}
                            className="w-full list-item flex items-center gap-[16px] !p-[16px] text-left mb-[8px]"
                          >
                            <div className="w-[48px] h-[48px] rounded-[14px] bg-[#f7f8fa] flex items-center justify-center shrink-0 border border-[rgba(19,20,23,0.06)]">
                              <Icon size={22} className="text-[#131417]" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[18px] font-semibold text-[#131417] truncate">{p.name}</p>
                              <p className="text-[15px] text-[#99a1af] truncate">{p.addr}</p>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); toggleFav(p.id) }} className="shrink-0 p-[6px] hover:scale-110 transition-transform">
                              <Star size={20} className={isFav ? 'text-[#FFCC00] fill-[#FFCC00]' : 'text-[#d1d5db]'} />
                            </button>
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Map panel (fullscreen, idle) */}
        <AnimatePresence>
          {isFullscreen && view !== 'route' && (
            <motion.div
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50, transition: { duration: 0.2 } }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="flex-1 p-[40px] border-l border-[#131417]/10"
            >
              <div className="w-full h-full rounded-[24px] overflow-hidden relative border border-[rgba(19,20,23,0.08)] bg-[#f7f8fa]">
                {KAKAO_JS_KEY ? (
                  <div ref={mapElRef} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-center px-[40px]">
                    <img src={imgMap} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
                    <div className="relative bg-white/95 rounded-[16px] px-[24px] py-[20px] shadow-[0px_8px_24px_rgba(0,0,0,0.08)]">
                      <p className="text-[18px] font-semibold text-[#131417] mb-[6px]">카카오 맵 키 미설정</p>
                      <p className="text-[14px] text-[#99a1af]">.env.local 의 VITE_KAKAO_JS_KEY 를 설정하세요.</p>
                    </div>
                  </div>
                )}
                {kakaoErr && (
                  <div className="absolute top-[16px] left-[16px] bg-red-50 border border-red-200 text-red-700 text-[13px] px-[12px] py-[6px] rounded-[10px]">
                    {kakaoErr}
                  </div>
                )}
                <div className="absolute top-[24px] left-[24px] bg-white/95 backdrop-blur-md rounded-[16px] px-[20px] py-[14px] shadow-[0px_8px_24px_rgba(0,0,0,0.1)] flex items-center gap-[10px] pointer-events-none">
                  <MapPin size={18} className="text-[#2d7cf1]" />
                  <span className="text-[16px] font-medium text-[#131417]">현재 위치 · {origin.name}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

// ── Embedded Kakao map for the route-preview view ──────────────
function RouteMapPreview({ origin, destination, geometry }) {
  const elRef = useRef(null)
  const stateRef = useRef({ map: null, polyline: null, marker: null, circle: null })
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!KAKAO_JS_KEY) { setErr('VITE_KAKAO_JS_KEY 미설정'); return }
    let cancelled = false
    loadKakaoSdk(KAKAO_JS_KEY).then((kakao) => {
      if (cancelled || !elRef.current) return
      const path = geometry.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng))
      const map = new kakao.maps.Map(elRef.current, {
        center: new kakao.maps.LatLng(origin.lat, origin.lng),
        level: 6,
      })
      stateRef.current.map = map
      // Polyline
      const polyline = new kakao.maps.Polyline({
        path, strokeWeight: 6, strokeColor: '#2d7cf1', strokeOpacity: 0.95, strokeStyle: 'solid',
      })
      polyline.setMap(map)
      stateRef.current.polyline = polyline
      // Origin circle
      const circle = new kakao.maps.Circle({
        center: new kakao.maps.LatLng(origin.lat, origin.lng), radius: 80,
        strokeWeight: 3, strokeColor: '#2d7cf1', strokeOpacity: 0.9, fillColor: '#2d7cf1', fillOpacity: 0.3,
      })
      circle.setMap(map)
      stateRef.current.circle = circle
      // Destination marker
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(destination.lat, destination.lng), map,
      })
      stateRef.current.marker = marker
      // Fit bounds
      const bounds = new kakao.maps.LatLngBounds()
      path.forEach(p => bounds.extend(p))
      map.setBounds(bounds, 40, 40, 40, 40)
    }).catch((e) => { if (!cancelled) setErr(e.message) })
    return () => {
      cancelled = true
      const { polyline, marker, circle } = stateRef.current
      polyline?.setMap(null); marker?.setMap(null); circle?.setMap(null)
      stateRef.current = { map: null, polyline: null, marker: null, circle: null }
    }
    // re-init when the route changes
  }, [origin.lat, origin.lng, destination.lat, destination.lng, geometry])

  return (
    <>
      {KAKAO_JS_KEY ? (
        <div ref={elRef} className="w-full h-full" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[14px] text-[#99a1af]">
          VITE_KAKAO_JS_KEY 미설정 — 카카오 지도 미리보기 사용 불가
        </div>
      )}
      {err && (
        <div className="absolute top-[12px] left-[12px] bg-red-50 border border-red-200 text-red-700 text-[12px] px-[10px] py-[5px] rounded">
          {err}
        </div>
      )}
    </>
  )
}
