import Dexie, { type Table } from 'dexie'
import type { Customer, Product, Sale, SaleItem, LedgerTransaction, StockMovement, Payment, Supplier, PurchaseOrder, SyncQueueItem } from '../../shared/types'

export interface SyncMetadata { id: string; lastServerCursor: number; lastSuccessfulSync?: string }
export class LocalDb extends Dexie {
  customers!: Table<Customer, string>; products!: Table<Product, string>; sales!: Table<Sale, string>; saleItems!: Table<SaleItem, string>
  ledgerTransactions!: Table<LedgerTransaction, string>; stockMovements!: Table<StockMovement, string>; payments!: Table<Payment, string>
  suppliers!: Table<Supplier, string>; purchaseOrders!: Table<PurchaseOrder, string>; outbox!: Table<SyncQueueItem, number>; syncMetadata!: Table<SyncMetadata, string>
  constructor() {
    super('dukaansaathi-local')

    this.version(1).stores({ customers: 'id, shopId, phone', products: 'id, shopId, sku, barcode', sales: 'id, shopId, saleId, transactionId', saleItems: 'saleItemId, saleId, productId', ledgerTransactions: 'id, shopId, customerId, transactionId, createdAt', stockMovements: 'id, shopId, productId, transactionId, createdAt', payments: 'id, shopId, paymentId, transactionId', suppliers: 'id, shopId, supplierId', purchaseOrders: 'id, shopId, purchaseOrderId, transactionId', outbox: '++id, syncEventId, transactionId, syncStatus, createdAt', syncMetadata: 'id' })

    // v2: index referenceId on ledgerTransactions. Without this, queries like
    // `.where('referenceId').equals(saleId)` throw a Dexie SchemaError at
    // runtime, which was silently breaking the "mark as delivered" flow
    // (the sale's paymentStatus got updated but the ledger entry that
    // Pending Deliveries checks for was never written, so orders kept
    // reappearing in the list).
    this.version(2).stores({ ledgerTransactions: 'id, shopId, customerId, transactionId, createdAt, referenceId' })
  }
}
export const localDb = new LocalDb()