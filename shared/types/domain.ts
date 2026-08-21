export type Role = 'OWNER' | 'MANAGER' | 'STAFF'
export type LedgerType = 'SALE' | 'PAYMENT' | 'INTEREST' | 'REFUND' | 'ADJUSTMENT'
export type Direction = 'DEBIT' | 'CREDIT'
export type StockMovementType = 'SALE' | 'PURCHASE' | 'ADJUSTMENT' | 'OCR_IMPORT'
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED'
export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'CONFIRMED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED'
export type RatePeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface Identity { id: string; shopId: string; createdAt: string; updatedAt: string }
export interface Product extends Identity { productId: string; name: string; sku: string; barcode?: string; category?: string; brand?: string; unit: string; purchasePrice: number; sellingPrice: number; minimumStock: number; supplierId?: string; description?: string; image?: string; currentStock: number }
export interface Customer extends Identity { customerId: string; name: string; phone: string; email?: string; address?: string; openingBalance: number; creditLimit?: number; interestEnabled: boolean; interestRate?: number; interestType?: string; gracePeriod?: number; notes?: string; lastTransactionDate?: string }
export interface LedgerTransaction extends Identity { transactionId: string; customerId: string; type: LedgerType; direction: Direction; amount: number; referenceId?: string; description: string }
export interface Sale extends Identity { saleId: string; customerId?: string; items: SaleItem[]; subtotal: number; discount: number; tax: number; total: number; paymentMethod: 'CASH' | 'UPI' | 'CREDIT'; paymentStatus: PaymentStatus; transactionId: string }
export interface SaleItem { saleItemId: string; saleId: string; productId: string; quantity: number; price: number; purchasePrice: number }
export interface StockMovement extends Identity { transactionId: string; productId: string; quantity: number; type: StockMovementType; direction: 'IN' | 'OUT'; referenceId?: string; notes?: string }
export interface Payment extends Identity { paymentId: string; saleId?: string; customerId?: string; ledgerTransactionId?: string; amount: number; status: PaymentStatus; provider: string; transactionReference?: string; transactionId: string; verifiedAt?: string }
export interface Supplier extends Identity { supplierId: string; name: string; phone?: string; email?: string; address?: string; gstNumber?: string; paymentTerms?: string; notes?: string }
export interface PurchaseOrder extends Identity { purchaseOrderId: string; supplierId: string; items: Array<{ productId: string; quantity: number; price: number }>; estimatedTotal: number; status: PurchaseOrderStatus; transactionId: string }

export interface SyncQueueItem { id?: number; syncEventId: string; transactionId: string; entityId: string; action: 'CREATE' | 'UPDATE' | 'DELETE'; endpoint: string; method: 'POST' | 'PUT'; payload: unknown; createdAt: string; syncStatus: 'PENDING' | 'SYNCING' | 'FAILED'; attempts: number; error?: string }
export interface SyncPullResponse { changes: unknown[]; nextCursor: number }
