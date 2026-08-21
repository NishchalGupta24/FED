import { localDb } from '../db/localDb'
import { pendingEvents } from './outbox'

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000'
export async function flushOutbox(token: string) {
  const events = await pendingEvents()
  if (!events.length) return { pushed: 0 }
  const response = await fetch(`${API}/api/sync/push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ events }) })
  if (!response.ok) throw new Error('Sync failed')
  const body = await response.json()
  const accepted = new Set((body.data || []).filter((result: { status: string }) => result.status === 'processed' || result.status === 'duplicate').map((result: { transactionId: string }) => result.transactionId))
  for (const event of events) {
    if (event.id && accepted.has(event.transactionId)) await localDb.outbox.delete(event.id)
    else if (event.id) await localDb.outbox.update(event.id, { syncStatus: 'FAILED', attempts: event.attempts + 1, error: 'Server rejected this change' })
  }
  await localDb.syncMetadata.put({ id: 'main', lastServerCursor: (await localDb.syncMetadata.get('main'))?.lastServerCursor || 0, lastSuccessfulSync: new Date().toISOString() })
  return { pushed: events.length }
}
export function startSync(token: string, onError?: (error: unknown) => void) { const run = () => flushOutbox(token).catch(onError); addEventListener('online', run); void run(); return () => removeEventListener('online', run) }
