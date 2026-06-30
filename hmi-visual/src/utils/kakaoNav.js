// Kakao Maps JS SDK + OSRM routing helpers, copied (with light edits) from
// the reference HCI-prototype project. No backend, no Gemini — pure browser:
//   • Kakao SDK provides the basemap + Places keyword search.
//   • OSRM (public demo) provides actual road geometry + ETA.

export const KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY

// Fixed starting point. The prototype vehicle isn't really moving; we anchor
// the user at Hongik University so all routes start from a known location.
export const DEFAULT_CENTER = {
  lat: 37.5510, lng: 126.9251,
  name: '홍익대학교', addr: '서울 마포구 와우산로 94',
}

// Idempotent loader for the Kakao Maps JS SDK with the `services` library
// (needed for Places keyword search). Resolves with `window.kakao`.
export function loadKakaoSdk(key) {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
    return Promise.resolve(window.kakao)
  }
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

// OSRM public demo router — free, no key, CORS-allowed. Returns real road
// geometry + ETA between two lat/lng points.
export async function fetchDrivingRoute(origin, dest) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?steps=false&geometries=geojson&overview=full`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OSRM ${res.status}`)
  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(data.message || '경로를 찾을 수 없습니다')
  }
  const r = data.routes[0]
  return {
    distance: r.distance,                  // meters
    duration: r.duration,                  // seconds
    geometry: r.geometry.coordinates,      // [[lng, lat], ...]
  }
}

// ── Display formatters ───────────────────────────────────────
export function formatDuration(sec) {
  const m = Math.max(1, Math.round(sec / 60))
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60), rm = m % 60
  return rm ? `${h}시간 ${rm}분` : `${h}시간`
}

export function formatDistance(m) {
  if (m == null) return ''
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

export function formatClockTime(d) {
  const h = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0')
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mm} ${period}`
}

// Project OSRM geometry coordinates into an SVG viewbox, preserving aspect.
// Returns { d, start: [x,y], end: [x,y] } so callers can drop dots at the
// origin and destination.
export function buildRouteSvg(geometry, w, h, pad = 12) {
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
    oy + (maxY - la) * s, // svg y is flipped vs latitude
  ])
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  return { d, start: points[0], end: points[points.length - 1] }
}
