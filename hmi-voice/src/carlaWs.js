// ── CARLA WS 주소 단일 출처 (런타임 host 오버라이드) ───────────────────────────
// 시각 HMI(services/carlaBridge.js)와 동일 규칙(변인통제). env 수정·vite 재시작 없이
// IP 변경을 반영하기 위해, 대시보드 launch 링크가 ?carla=<IP> 를 붙여 주면 그 값으로 붙는다.
//   우선순위: 1) ?carla= (URL 쿼리)  2) localStorage('carlaHost')  3) VITE_CARLA_WS_URL/HOST  4) localhost
// ?carla= 가 오면 localStorage 에 기억 → /hmi·/operator 간(동일 origin) 공유 + 새로고침 유지.
function _resolve() {
  let override = null
  try {
    const q = new URLSearchParams(window.location.search).get('carla')
    if (q && q.trim()) { override = q.trim(); localStorage.setItem('carlaHost', override) }
    else { override = localStorage.getItem('carlaHost') }
  } catch (_) { /* no-DOM guard */ }
  if (override) return `ws://${override}:8766`
  return import.meta.env.VITE_CARLA_WS_URL || `ws://${import.meta.env.VITE_CARLA_HOST || 'localhost'}:8766`
}

export const CARLA_WS_URL = _resolve()
