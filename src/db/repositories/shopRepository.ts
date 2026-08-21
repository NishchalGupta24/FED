import { liveQuery } from 'dexie'
import { localDb } from '../localDb'
import type { Customer, Product, Sale, Supplier, PurchaseOrder } from '../../../shared/types'

export const repositories = {
  customers: {
    list: (shopId: string) => localDb.customers.where('shopId').equals(shopId).toArray(),
    watch: (shopId: string) => liveQuery(() => localDb.customers.where('shopId').equals(shopId).toArray()),
    put: (item: Customer) => localDb.customers.put(item),
  },
  products: {
    list: (shopId: string) => localDb.products.where('shopId').equals(shopId).toArray(),
    watch: (shopId: string) => liveQuery(() => localDb.products.where('shopId').equals(shopId).toArray()),
    put: (item: Product) => localDb.products.put(item),
  },
  sales: {
    list: (shopId: string) => localDb.sales.where('shopId').equals(shopId).toArray(),
    put: (item: Sale) => localDb.sales.put(item),
  },
  suppliers: {
    list: (shopId: string) => localDb.suppliers.where('shopId').equals(shopId).toArray(),
    put: (item: Supplier) => localDb.suppliers.put(item),
  },
  purchaseOrders: {
    list: (shopId: string) => localDb.purchaseOrders.where('shopId').equals(shopId).toArray(),
    put: (item: PurchaseOrder) => localDb.purchaseOrders.put(item),
  },
}
