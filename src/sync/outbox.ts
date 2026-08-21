import type { SyncQueueItem } from '../../shared/types'
import { localDb } from '../db/localDb'

export async function enqueue(event: Omit<SyncQueueItem, 'syncEventId' | 'createdAt' | 'attempts' | 'syncStatus'>) {
  return localDb.outbox.add({ ...event, syncEventId: crypto.randomUUID(), createdAt: new Date().toISOString(), attempts: 0, syncStatus: 'PENDING' })
}
export async function pendingEvents() { return localDb.outbox.where('syncStatus').anyOf('PENDING', 'FAILED').sortBy('createdAt') }
