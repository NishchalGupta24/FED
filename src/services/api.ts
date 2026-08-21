import type { Session } from './session'
const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'
export async function api<T>(path: string, init: RequestInit = {}, session?: Session | null): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}), ...init.headers } })
  const body = await response.json()
  if (!response.ok || !body.success) throw new Error(body.error?.message || 'Request failed')
  return body.data as T
}
