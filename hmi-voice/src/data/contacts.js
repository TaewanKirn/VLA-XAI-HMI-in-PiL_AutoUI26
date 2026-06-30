// Mock phone book shared between the Phone app (UI) and App.jsx (voice intent
// parser). Keeping it in one place means the AI prompt's known-favorites list
// can't drift from what the in-app list actually shows.
export const PHONE_FAVORITES = [
  { id: 1, name: '엄마',     sub: '010-1234-5678', initials: '엄', color: '#f59e0b' },
  { id: 2, name: '김민지',   sub: 'PM · 회사',      initials: '김', color: '#10b981' },
  { id: 3, name: '박사장님', sub: '010-9999-0001',  initials: '박', color: '#6366f1' },
  { id: 4, name: '집',       sub: '02-555-1234',    initials: '집', color: '#0ea5e9' },
]

// Used by the voice-intent CALL flow to match spoken names to favorites.
// Forgiving: trims, removes spaces, and accepts partial matches.
export function findFavorite(rawName) {
  const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase()
  const q = norm(rawName)
  if (!q) return null
  return PHONE_FAVORITES.find((c) => norm(c.name) === q)
      ?? PHONE_FAVORITES.find((c) => norm(c.name).includes(q) || q.includes(norm(c.name)))
      ?? null
}

// Build an ad-hoc contact for an unknown name so the calling flow can still
// proceed visually (the AI is already supposed to confirm with the user
// before emitting [CALL] for unknowns).
export function adhocContact(name) {
  return {
    id: `adhoc-${name}`,
    name,
    sub: '연락처 미등록',
    initials: (name || '?')[0],
    color: '#9ca3af',
  }
}
