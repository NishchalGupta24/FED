export type Session = { token: string; shopId: string; userId: string; role: 'OWNER' | 'MANAGER' | 'STAFF'; name: string }
const key = 'dukaansaathi-session'
export const sessionStore = { get: (): Session | null => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as Session : null }, set: (value: Session) => localStorage.setItem(key, JSON.stringify(value)), clear: () => localStorage.removeItem(key) }
