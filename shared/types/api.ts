import type { SyncQueueItem } from './domain'

export interface ApiError { success: false; error: { code: string; message: string; details?: unknown } }
export interface ApiSuccess<T> { success: true; data: T }
export type ApiResponse<T> = ApiSuccess<T> | ApiError
export interface PushRequest { events: SyncQueueItem[] }
export interface PushResult { transactionId: string; status: 'processed' | 'duplicate' | 'failed'; entityId?: string }
