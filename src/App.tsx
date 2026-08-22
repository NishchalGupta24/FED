import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'

import { localDb } from './db/localDb'
import { enqueue } from './sync/outbox'
import { startSync } from './sync/syncEngine'
import { api } from './services/api'
import { sessionStore, type Session } from './services/session'

import type {
  Customer,
  LedgerTransaction,
  Payment,
  PaymentStatus,
  Product,
  PurchaseOrder,
  Sale,
  SaleItem,
  StockMovement,
  Supplier,
} from '../shared/types'

/* =========================================================
   HELPERS
========================================================= */

const id = () => crypto.randomUUID()

const now = () => new Date().toISOString()

const money = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)

/* =========================================================
   CUSTOMER PURCHASE HISTORY (khata bill breakdown)
========================================================= */

type BillItemLine = {
  productId: string
  name: string
  quantity: number
  price: number
  lineTotal: number
}

type CustomerBill = {
  id: string
  date: string
  label: string
  items: BillItemLine[]
  subtotal?: number
  discount?: number
  total: number
  amountPaid: number
  amountDue: number
  status: 'PAID' | 'PARTIAL' | 'DUE'
  clearedAt?: string
}

// Builds a per-bill breakdown for a customer: every credit sale (with its
// items, discount and total) plus the opening balance, and works out -
// using a simple oldest-debt-first allocation of payments - how much of
// each bill is paid, whether it is fully cleared, and when.
function buildCustomerBills(
  customer: Customer,
  sales: Sale[],
  ledger: LedgerTransaction[],
  products: Product[],
): CustomerBill[] {
  const productName = (pid: string) =>
    products.find((p) => p.productId === pid)?.name ?? 'Item'

  const custLedger = ledger.filter(
    (l) => l.customerId === customer.customerId,
  )

  type Debit = {
    id: string
    date: string
    label: string
    total: number
    sale?: Sale
  }

  const debits: Debit[] = []

  if (customer.openingBalance > 0) {
    debits.push({
      id: `opening-${customer.customerId}`,
      date: customer.createdAt,
      label: 'Opening balance',
      total: customer.openingBalance,
    })
  }

  custLedger
    .filter((l) => l.direction === 'DEBIT')
    .forEach((l) => {
      const sale =
        l.type === 'SALE'
          ? sales.find((s) => s.saleId === l.referenceId)
          : undefined

      debits.push({
        id: l.id,
        date: l.createdAt,
        label: sale ? 'Credit purchase' : l.description,
        total: l.amount,
        sale,
      })
    })

  debits.sort((a, b) => a.date.localeCompare(b.date))

  const credits = custLedger
    .filter((l) => l.direction === 'CREDIT')
    .map((l) => ({ date: l.createdAt, remaining: l.amount }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const bills = debits.map((d) => {
    let remainingDue = d.total
    let clearedAt: string | undefined

    for (const credit of credits) {
      if (remainingDue <= 0) break
      if (credit.remaining <= 0) continue

      const applied = Math.min(remainingDue, credit.remaining)
      remainingDue -= applied
      credit.remaining -= applied

      if (remainingDue <= 0) {
        clearedAt = credit.date
      }
    }

    const amountPaid = d.total - remainingDue

    const status: CustomerBill['status'] =
      remainingDue <= 0
        ? 'PAID'
        : amountPaid > 0
          ? 'PARTIAL'
          : 'DUE'

    const items: BillItemLine[] = d.sale
      ? d.sale.items.map((it) => ({
          productId: it.productId,
          name: productName(it.productId),
          quantity: it.quantity,
          price: it.price,
          lineTotal: it.price * it.quantity,
        }))
      : []

    return {
      id: d.id,
      date: d.date,
      label: d.label,
      items,
      subtotal: d.sale?.subtotal,
      discount: d.sale?.discount,
      total: d.total,
      amountPaid,
      amountDue: remainingDue,
      status,
      clearedAt,
    }
  })

  // Most recent bill first.
  return bills.sort((a, b) => b.date.localeCompare(a.date))
}

/* =========================================================
   REUSABLE UI
========================================================= */

const Card = ({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) => (
  <section
    className={`rounded-2xl border border-slate-200 bg-white p-5
      shadow-[0_4px_20px_rgba(15,23,42,0.05)]
      transition-all duration-200
      hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)]
      ${className}`}
  >
    {children}
  </section>
)

const Input = ({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full rounded-xl border border-slate-200 bg-white px-4 py-3
      text-sm text-slate-900 outline-none transition
      placeholder:text-slate-400
      focus:border-emerald-600
      focus:ring-4 focus:ring-emerald-100
      ${className}`}
  />
)

const Select = ({
  className = '',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...props}
    className={`w-full rounded-xl border border-slate-200 bg-white px-4 py-3
      text-sm text-slate-900 outline-none transition
      focus:border-emerald-600
      focus:ring-4 focus:ring-emerald-100
      ${className}`}
  />
)

const PrimaryButton = ({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={`rounded-xl bg-emerald-700 px-5 py-3
      font-semibold text-white shadow-sm transition
      hover:bg-emerald-800
      active:scale-[0.98]
      disabled:cursor-not-allowed
      disabled:opacity-50
      ${className}`}
  >
    {children}
  </button>
)

const SecondaryButton = ({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={`rounded-xl border border-emerald-200 bg-white px-5 py-3
      font-semibold text-emerald-800 transition
      hover:bg-emerald-50
      active:scale-[0.98]
      ${className}`}
  >
    {children}
  </button>
)

/* =========================================================
   TYPES
========================================================= */

type Ctx = {
  session: Session
  products: Product[]
  customers: Customer[]
  refresh: () => Promise<void>
}

/* =========================================================
   APP
========================================================= */

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<Protected />} />
      </Routes>
    </BrowserRouter>
  )
}

/* =========================================================
   LOGIN
========================================================= */

function Login() {
  const nav = useNavigate()

  const [email, setEmail] = useState('demo@dukaansaathi.in')
  const [password, setPassword] = useState('Password123')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const demo = () => {
    sessionStore.set({
      token: 'offline-demo',
      shopId: 'offline-demo-shop',
      userId: 'offline-demo-owner',
      role: 'OWNER',
      name: 'Demo Owner',
    })

    nav('/')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()

    setBusy(true)
    setError('')

    try {
      sessionStore.set(
        await api<Session>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password,
          }),
        }),
      )

      nav('/')
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message}. You can still use Offline demo.`
          : 'Sign in failed',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-slate-950 p-5">

      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-teal-400/10 blur-3xl" />
      </div>

      <form
        onSubmit={submit}
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-white p-8 shadow-2xl"
      >

        {/* Brand */}
        <div className="flex items-center gap-3">

          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-700 font-bold text-white shadow-lg">
            DS
          </div>

          <div>
            <p className="font-bold tracking-tight text-slate-950">
              Dukaan<span className="text-emerald-700">Saathi</span>
            </p>

            <p className="text-xs text-slate-500">
              Shop Management System
            </p>
          </div>

        </div>

        <div className="mt-8">
          <p className="text-sm font-semibold text-emerald-700">
            WELCOME BACK
          </p>

          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">
            Run your shop,
            <br />
            anywhere.
          </h1>

          <p className="mt-3 text-sm leading-6 text-slate-500">
            Manage sales, inventory, customers and suppliers from one simple
            dashboard.
          </p>
        </div>

        <label className="mt-7 block text-sm font-medium text-slate-700">
          Email

          <Input
            className="mt-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Password

          <Input
            className="mt-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>

        {error && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        <PrimaryButton
          className="mt-6 w-full"
          disabled={busy}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </PrimaryButton>

        <SecondaryButton
          type="button"
          onClick={demo}
          className="mt-3 w-full"
        >
          Open offline demo
        </SecondaryButton>

        <div className="mt-6 rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
          Demo account
          <br />
          <span className="font-medium text-slate-700">
            demo@dukaansaathi.in / Password123
          </span>
        </div>

      </form>
    </main>
  )
}

/* =========================================================
   PROTECTED
========================================================= */

function Protected() {
  const s = sessionStore.get()

  return s ? (
    <Shop session={s} />
  ) : (
    <Navigate to="/login" replace />
  )
}

/* =========================================================
   SHOP SHELL
========================================================= */

function Shop({ session }: { session: Session }) {
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)

  // ---------------------------------------------------------
  // OFFLINE DEMO DATA
  // Seeds the local IndexedDB database when using Offline demo.
  // ---------------------------------------------------------
  const seedDemoData = async () => {
    if (session.token !== 'offline-demo') return

    const existingProducts = await localDb.products
      .where('shopId')
      .equals(session.shopId)
      .count()

    // Do not overwrite existing shop data.
    if (existingProducts > 0) return

    const time = now()

    // =========================
    // PRODUCTS
    // =========================
    // Format: [name, sku, unit, purchasePrice, mrpSellingPrice, minimumStock, currentStock]
    const productData = [
      ['Tata Salt 1kg', 'SALT001', 'packet', 22, 28, 10, 42],
      ['Aashirvaad Atta 5kg', 'ATTA001', 'bag', 250, 285, 8, 18],
      ['Amul Milk 1L', 'MILK001', 'packet', 62, 68, 10, 7],
      ['Maggi 70g', 'MAG001', 'packet', 12, 15, 10, 32],
      ['Parle-G 800g', 'PARLE001', 'packet', 65, 75, 8, 24],
      ['Fortune Sunflower Oil 1L', 'OIL001', 'bottle', 130, 145, 10, 12],
      ['Surf Excel 1kg', 'SURF001', 'packet', 190, 210, 10, 9],
      ['Coca Cola 750ml', 'COKE001', 'bottle', 35, 40, 8, 25],
      ['Thums Up 750ml', 'THUMS001', 'bottle', 35, 40, 8, 21],
      ['Britannia Good Day', 'BRIT001', 'packet', 25, 30, 8, 16],
      ['Dairy Milk 40g', 'DAIRY001', 'bar', 30, 40, 8, 19],
      ['Colgate 200g', 'COLGATE001', 'tube', 85, 105, 5, 11],
      ['Tata Tea Premium 250g', 'TEA001', 'packet', 135, 155, 8, 14],
      ['Bru Instant Coffee 100g', 'COFFEE001', 'jar', 148, 165, 6, 9],
      ['Toor Dal 1kg', 'DAL001', 'packet', 118, 132, 10, 20],
      ['Basmati Rice 5kg', 'RICE001', 'bag', 390, 430, 8, 10],
      ['Sugar 1kg', 'SUGAR001', 'packet', 42, 48, 12, 26],
      ['Saffola Oats 1kg', 'OATS001', 'packet', 165, 189, 6, 8],
      ['Kissan Tomato Ketchup 500g', 'KETCHUP001', 'bottle', 105, 120, 6, 13],
      ['Haldiram Bhujia 400g', 'BHUJIA001', 'packet', 92, 110, 8, 15],
      ['Dettol Handwash 200ml', 'DETTOL001', 'bottle', 72, 85, 8, 12],
      ['Vim Dishwash Bar 300g', 'VIM001', 'bar', 20, 25, 10, 28],
      ['Nestle Everyday Milk Powder 400g', 'POWDER001', 'packet', 198, 225, 6, 9],
      ['Maaza 600ml', 'MAAZA001', 'bottle', 34, 40, 8, 17],
    ]

    const products: Product[] = productData.map(
      ([
        name,
        sku,
        unit,
        purchasePrice,
        sellingPrice,
        minimumStock,
        currentStock,
      ]) => ({
        id: id(),
        productId: id(),
        shopId: session.shopId,
        name: name as string,
        sku: sku as string,
        unit: unit as string,
        purchasePrice: purchasePrice as number,
        sellingPrice: sellingPrice as number,
        minimumStock: minimumStock as number,
        currentStock: currentStock as number,
        createdAt: time,
        updatedAt: time,
      }),
    )

    // Insert products independently so an unrelated demo record
    // cannot roll back the inventory data.
    await localDb.products.bulkPut(products)

    // =========================
    // CUSTOMERS
    // =========================
    const customerData = [
      ['Rahul Sharma', '9876543210', 1250],
      ['Amit Kumar', '9812345678', 780],
      ['Priya Singh', '9898765432', 450],
      ['Rohit Gupta', '9765432109', 2100],
      ['Anjali Verma', '9823456710', 320],
      ['Vikash Yadav', '9798765432', 650],
    ]

    const customers: Customer[] = customerData.map(
      ([name, phone, openingBalance]) => {
        const customerId = id()

        return {
          id: customerId,
          customerId,
          shopId: session.shopId,
          name: name as string,
          phone: phone as string,
          openingBalance: openingBalance as number,
          interestEnabled: false,
          createdAt: time,
          updatedAt: time,
        }
      },
    )

    await localDb.customers.bulkPut(customers)

    // =========================
    // SUPPLIERS
    // =========================
    const suppliers: Supplier[] = [
      {
        id: id(),
        supplierId: id(),
        shopId: session.shopId,
        name: 'Sharma Wholesale',
        createdAt: time,
        updatedAt: time,
      },
      {
        id: id(),
        supplierId: id(),
        shopId: session.shopId,
        name: 'Bharat FMCG Distributors',
        createdAt: time,
        updatedAt: time,
      },
      {
        id: id(),
        supplierId: id(),
        shopId: session.shopId,
        name: 'Metro General Suppliers',
        createdAt: time,
        updatedAt: time,
      },
    ]

    await localDb.suppliers.bulkPut(suppliers)

    // =========================
    // DEMO SALES
    // =========================
    const saleProducts = products.slice(0, 5)

    const makeSale = (
      productIndex: number,
      quantity: number,
      customerId?: string,
    ): Sale => {
      const product = saleProducts[productIndex]
      const saleId = id()
      const transactionId = id()

      const saleItem: SaleItem = {
        saleItemId: id(),
        saleId,
        productId: product.productId,
        quantity,
        price: product.sellingPrice,
        purchasePrice: product.purchasePrice,
      }

      const total = quantity * product.sellingPrice

      return {
        id: saleId,
        saleId,
        shopId: session.shopId,
        customerId,
        items: [saleItem],
        subtotal: total,
        discount: 0,
        tax: 0,
        total,
        paymentMethod: customerId ? 'CREDIT' : 'CASH',
        paymentStatus: customerId ? 'PENDING' : 'SUCCESS',
        transactionId,
        createdAt: time,
        updatedAt: time,
      }
    }

    const sale1 = makeSale(0, 3)
    const sale2 = makeSale(1, 1)
    const sale3 = makeSale(3, 4, customers[0].customerId)

    await localDb.sales.bulkPut([sale1, sale2, sale3])

    await localDb.saleItems.bulkPut([
      ...sale1.items,
      ...sale2.items,
      ...sale3.items,
    ] as SaleItem[])

    // =========================
    // KHATA / LEDGER
    // =========================
    const ledgerEntry: LedgerTransaction = {
      id: id(),
      shopId: session.shopId,
      transactionId: id(),
      customerId: customers[0].customerId,
      type: 'SALE',
      direction: 'DEBIT',
      amount: sale3.total,
      referenceId: sale3.saleId,
      description: 'Demo credit sale',
      createdAt: time,
      updatedAt: time,
    }

    await localDb.ledgerTransactions.put(ledgerEntry)

    // =========================
    // DEMO PENDING DELIVERY ORDERS
    // =========================
    const deliveryOrder1: Sale = makeSale(
      0,
      5,
      customers[0].customerId,
    )
    deliveryOrder1.paymentStatus = 'PENDING'
    deliveryOrder1.paymentMethod = 'CREDIT'

    const deliveryOrder2: Sale = makeSale(
      1,
      2,
      customers[1].customerId,
    )
    deliveryOrder2.paymentStatus = 'PENDING'
    deliveryOrder2.paymentMethod = 'UPI'

    const deliveryOrder3: Sale = makeSale(
      3,
      8,
      customers[2].customerId,
    )
    deliveryOrder3.paymentStatus = 'PENDING'
    deliveryOrder3.paymentMethod = 'CREDIT'

    const deliveryOrder4: Sale = makeSale(
      4,
      1,
      customers[3].customerId,
    )
    deliveryOrder4.paymentStatus = 'PENDING'
    deliveryOrder4.paymentMethod = 'UPI'

    await localDb.sales.bulkPut([
      deliveryOrder1,
      deliveryOrder2,
      deliveryOrder3,
      deliveryOrder4,
    ])

    await localDb.saleItems.bulkPut([
      ...deliveryOrder1.items,
      ...deliveryOrder2.items,
      ...deliveryOrder3.items,
      ...deliveryOrder4.items,
    ] as SaleItem[])

    console.log('DukaanSaathi: offline demo data seeded successfully')
  }

  const refresh = async () => {
    setProducts(
      await localDb.products
        .where('shopId')
        .equals(session.shopId)
        .toArray(),
    )

    setCustomers(
      await localDb.customers
        .where('shopId')
        .equals(session.shopId)
        .toArray(),
    )

    setPending(
      await localDb.outbox
        .where('syncStatus')
        .anyOf('PENDING', 'FAILED')
        .count(),
    )
  }

  useEffect(() => {
    void seedDemoData().then(refresh)

    const on = () => {
      setOnline(true)
      void refresh()
    }

    const off = () => {
      setOnline(false)
    }

    addEventListener('online', on)
    addEventListener('offline', off)

    const stop =
      session.token === 'offline-demo'
        ? () => {}
        : startSync(session.token, () => void refresh())

    return () => {
      removeEventListener('online', on)
      removeEventListener('offline', off)
      stop()
    }
  }, [session.shopId, session.token])

  const ctx = {
    session,
    products,
    customers,
    refresh,
  }

  const navigation = [
    ['/', 'Dashboard'],
    ['/pos', 'POS'],
    ['/khata', 'Khata'],
    ['/inventory', 'Inventory'],
    ['/suppliers', 'Suppliers'],
    ['/ocr', 'OCR'],
  ]

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">

      {/* TOP HEADER */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">

        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">

          <div className="flex items-center gap-3">

            <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-700 font-bold text-white shadow-sm">
              DS
            </div>

            <div>
              <div className="text-base font-bold tracking-tight">
                Dukaan<span className="text-emerald-700">Saathi</span>
              </div>

              <div className="text-xs text-slate-500">
                {session.name}
              </div>
            </div>

          </div>

          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              online
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            <span className="text-[10px]">
              ●
            </span>

            {online ? 'Online' : 'Offline'}

            <span className="opacity-50">·</span>

            {pending} waiting
          </div>

        </div>
      </header>

      {/* NAVIGATION */}
      <nav className="sticky top-[66px] z-30 border-b border-slate-200 bg-white">

        <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-2">

          {navigation.map(([to, label]) => (
            <NavLink
              key={to}
              end={to === '/'}
              to={to}
              className={({ isActive }) =>
                `relative whitespace-nowrap rounded-lg px-4 py-3 text-sm font-medium transition ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                }`
              }
            >
              {label}
            </NavLink>
          ))}

          <button
            className="ml-auto whitespace-nowrap rounded-lg px-4 py-3 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            onClick={() => {
              sessionStore.clear()
              location.assign('/login')
            }}
          >
            Log out
          </button>

        </div>
      </nav>

      {/* PAGE */}
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        <Routes>

          <Route
            path="/"
            element={<Dashboard {...ctx} />}
          />

          <Route
            path="/inventory"
            element={<Inventory {...ctx} />}
          />

          <Route
            path="/khata"
            element={<Khata {...ctx} />}
          />

          <Route
            path="/pos"
            element={<Pos {...ctx} />}
          />

          <Route
            path="/suppliers"
            element={<Suppliers {...ctx} />}
          />

          <Route
            path="/ocr"
            element={<Ocr {...ctx} />}
          />

        </Routes>
      </main>

    </div>
  )
}

/* =========================================================
   DASHBOARD
========================================================= */

function Dashboard({
  session,
  products,
  customers,
}: {
  session: Session
  products: Product[]
  customers: Customer[]
}) {
  const [sales, setSales] = useState<Sale[]>([])
  const [ledger, setLedger] = useState<LedgerTransaction[]>([])
  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [showSalesView, setShowSalesView] = useState(false)

  useEffect(() => {
    void localDb.sales
      .where('shopId')
      .equals(session.shopId)
      .toArray()
      .then(setSales)

    void localDb.ledgerTransactions
      .where('shopId')
      .equals(session.shopId)
      .toArray()
      .then(setLedger)

    void localDb.saleItems
      .toArray()
      .then(setSaleItems)
  }, [session.shopId, products, customers])

  const outstanding = customers.reduce(
    (sum, c) =>
      sum +
      ledger
        .filter((x) => x.customerId === c.customerId)
        .reduce(
          (b, x) =>
            b + (x.direction === 'DEBIT' ? x.amount : -x.amount),
          c.openingBalance,
        ),
    0,
  )

  const today = new Date().toDateString()

  const todaySales = sales
    .filter(
      (s) => new Date(s.createdAt).toDateString() === today,
    )
    .reduce((n, s) => n + s.total, 0)

  const lowStock = products.filter(
    (p) => p.currentStock <= p.minimumStock,
  )

  return (
    <div className="space-y-6">

      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8">

        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl" />

        <div className="relative flex flex-col justify-between gap-6 md:flex-row md:items-end">

          <div>

            <div className="mb-3 inline-flex rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              SHOP OVERVIEW
            </div>

            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Good to see you, {session.name}.
            </h1>

            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
              Everything you need to manage your shop — sales, inventory,
              customers and suppliers in one place.
            </p>

          </div>

          <NavLink
            to="/pos"
            className="inline-flex w-fit items-center rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-500"
          >
            Start a new sale →
          </NavLink>

        </div>

      </section>

      {/* STATS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">

        <Card>
          <p className="text-sm font-medium text-slate-500">
            Today's sales
          </p>

          <div className="mt-3 flex items-end justify-between">

            <b className="text-3xl font-bold tracking-tight text-slate-950">
              {money(todaySales)}
            </b>

            <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
              SALES
            </span>

          </div>

          <p className="mt-2 text-xs text-slate-400">
            Total recorded today
          </p>
        </Card>

        <Card>
          <p className="text-sm font-medium text-slate-500">
            Outstanding khata
          </p>

          <div className="mt-3 flex items-end justify-between">

            <b className="text-3xl font-bold tracking-tight text-amber-700">
              {money(outstanding)}
            </b>

            <span className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
              DUE
            </span>

          </div>

          <p className="mt-2 text-xs text-slate-400">
            Customer credit balance
          </p>
        </Card>

        <Card>
          <p className="text-sm font-medium text-slate-500">
            Low stock
          </p>

          <div className="mt-3 flex items-end justify-between">

            <b className="text-3xl font-bold tracking-tight text-slate-950">
              {lowStock.length}
            </b>

            <span className="rounded-lg bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700">
              ACTION
            </span>

          </div>

          <p className="mt-2 text-xs text-slate-400">
            Products need attention
          </p>
        </Card>

        <Card>
          <p className="text-sm font-medium text-slate-500">
            Customers
          </p>

          <div className="mt-3 flex items-end justify-between">

            <b className="text-3xl font-bold tracking-tight text-slate-950">
              {customers.length}
            </b>

            <span className="rounded-lg bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">
              KHATA
            </span>

          </div>

          <p className="mt-2 text-xs text-slate-400">
            Saved customers
          </p>
        </Card>

      </div>

      {/* MAIN DASHBOARD */}
      <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">

        <Card>

          <div className="flex items-center justify-between">

            <div>
              <h2 className="text-lg font-bold text-slate-950">
                Store overview
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Quick access to the important parts of your store.
              </p>
            </div>

            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              Today
            </span>

          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">

            <NavLink
              to="/inventory"
              className="rounded-2xl border border-slate-200 p-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50"
            >
              <div className="text-xl">📦</div>

              <p className="mt-3 font-semibold">
                Inventory
              </p>

              <p className="mt-1 text-xs text-slate-500">
                {products.length} products
              </p>
            </NavLink>

            <NavLink
              to="/khata"
              className="rounded-2xl border border-slate-200 p-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50"
            >
              <div className="text-xl">📒</div>

              <p className="mt-3 font-semibold">
                Khata
              </p>

              <p className="mt-1 text-xs text-slate-500">
                {customers.length} customers
              </p>
            </NavLink>

            <NavLink
              to="/suppliers"
              className="rounded-2xl border border-slate-200 p-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50"
            >
              <div className="text-xl">🚚</div>

              <p className="mt-3 font-semibold">
                Suppliers
              </p>

              <p className="mt-1 text-xs text-slate-500">
                Manage purchases
              </p>
            </NavLink>

          </div>

          {lowStock.length > 0 ? (
            <div className="mt-5 flex flex-col justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">

              <div>
                <p className="font-semibold text-amber-900">
                  ⚠ Low stock needs attention
                </p>

                <p className="mt-1 text-sm text-amber-800">
                  {lowStock
                    .slice(0, 3)
                    .map((p) => p.name)
                    .join(' · ')}

                  {lowStock.length > 3 ? ' · …' : ''}
                </p>
              </div>

              <NavLink
                to="/inventory"
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm"
              >
                View inventory
              </NavLink>

            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
              ✓ Your current stock levels look healthy.
            </div>
          )}

        </Card>

        {/* QUICK ACTIONS */}
        <Card>

          <h2 className="text-lg font-bold">
            Quick actions
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Common tasks for running your shop.
          </p>

          <div className="mt-5 space-y-2">

            <NavLink
              to="/pos"
              className="flex items-center justify-between rounded-xl border border-slate-200 p-3 font-semibold transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              <span>New sale</span>
              <span className="text-emerald-700">→</span>
            </NavLink>

            <NavLink
              to="/inventory"
              className="flex items-center justify-between rounded-xl border border-slate-200 p-3 font-semibold transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              <span>Add product</span>
              <span className="text-emerald-700">→</span>
            </NavLink>

            <NavLink
              to="/khata"
              className="flex items-center justify-between rounded-xl border border-slate-200 p-3 font-semibold transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              <span>Add customer</span>
              <span className="text-emerald-700">→</span>
            </NavLink>

            <NavLink
              to="/ocr"
              className="flex items-center justify-between rounded-xl border border-slate-200 p-3 font-semibold transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              <span>Scan invoice</span>
              <span className="text-emerald-700">→</span>
            </NavLink>

          </div>

        </Card>

      </div>

      {/* SALES VIEW */}
      {showSalesView && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-slate-950">
              All Sales & Payments
            </h2>

            <button
              onClick={() => setShowSalesView(false)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>

          {sales.length === 0 ? (
            <Card>
              <p className="text-center text-slate-500">
                No sales recorded yet.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4">
              {sales.map((sale) => {
                const customer = customers.find(
                  (c) => c.customerId === sale.customerId,
                )
                const items = saleItems.filter(
                  (i) => i.saleId === sale.saleId,
                )

                return (
                  <Card key={sale.saleId}>
                    <div className="flex items-start justify-between">
                      <div>
                        {customer && (
                          <>
                            <h3 className="font-bold">
                              {customer.name}
                            </h3>

                            <p className="text-sm text-slate-500">
                              {customer.phone}
                            </p>
                          </>
                        )}

                        <p className="mt-2 text-xs text-slate-400">
                          {new Date(
                            sale.createdAt,
                          ).toLocaleDateString('en-IN')}{' '}
                          at{' '}
                          {new Date(
                            sale.createdAt,
                          ).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>

                      <div className="text-right">
                        <span
                          className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                            sale.paymentStatus ===
                            'SUCCESS'
                              ? 'bg-emerald-100 text-emerald-800'
                              : sale.paymentStatus ===
                                  'PENDING'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {sale.paymentStatus}
                        </span>

                        <p className="mt-2 text-sm font-semibold">
                          {sale.paymentMethod}
                        </p>
                      </div>
                    </div>

                    <div className="my-4 border-t border-slate-100 pt-4">
                      <div className="space-y-2">
                        {items.map((item) => {
                          const product = products.find(
                            (p) =>
                              p.productId ===
                              item.productId,
                          )

                          return (
                            <div
                              key={item.saleItemId}
                              className="flex justify-between text-sm"
                            >
                              <span>
                                {product?.name || 'Unknown'} (
                                {item.quantity})
                              </span>

                              <span className="font-medium">
                                {money(
                                  item.quantity *
                                    item.price,
                                )}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    <div className="flex justify-between border-t border-slate-100 pt-4 text-lg font-bold">
                      <span>Total</span>

                      <span>{money(sale.total)}</span>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* QUICK ACCESS TO SALES */}
      {!showSalesView && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-950">
                Today's Transactions
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                {sales.length} sales recorded
              </p>
            </div>

            <button
              onClick={() => setShowSalesView(true)}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500"
            >
              View All Sales
            </button>
          </div>
        </Card>
      )}

    </div>
  )
}

/* =========================================================
   INVENTORY
========================================================= */

function Inventory({
  session,
  products,
  refresh,
}: Ctx) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')

  const add = async (e: FormEvent) => {
    e.preventDefault()

    const time = now()
    const productId = id()
    const transactionId = id()

    const p: Product = {
      id: productId,
      productId,
      shopId: session.shopId,
      name,
      sku: '',
      unit: 'unit',
      purchasePrice: 0,
      sellingPrice: +price,
      minimumStock: 5,
      currentStock: +stock,
      createdAt: time,
      updatedAt: time,
    }

    const m: StockMovement = {
      id: id(),
      shopId: session.shopId,
      transactionId,
      productId,
      quantity: +stock,
      type: 'PURCHASE',
      direction: 'IN',
      referenceId: productId,
      createdAt: time,
      updatedAt: time,
    }

    await localDb.transaction(
      'rw',
      localDb.products,
      localDb.stockMovements,
      localDb.outbox,
      async () => {
        await localDb.products.put(p)
        await localDb.stockMovements.put(m)

        await enqueue({
          transactionId,
          entityId: productId,
          action: 'CREATE',
          endpoint: '/api/products',
          method: 'POST',
          payload: p,
        })
      },
    )

    setName('')
    setPrice('')
    setStock('')

    await refresh()
  }

  return (
    <div className="space-y-5">

      <PageHeader
        eyebrow="PRODUCT MANAGEMENT"
        title="Inventory"
        description="Manage products, prices and available stock."
      />

      <Card>

        <form
          onSubmit={add}
          className="grid gap-3 md:grid-cols-4"
        >

          <Input
            placeholder="Product name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            type="number"
            min="0"
            placeholder="Selling price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />

          <Input
            type="number"
            min="0"
            placeholder="Opening stock"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            required
          />

          <PrimaryButton>
            + Add product
          </PrimaryButton>

        </form>

      </Card>

      {products.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No products yet"
          text="Add your first product above to start managing inventory."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">

          {products.map((p) => (
            <Card key={p.id}>

              <div className="flex items-start justify-between gap-3">

                <div>
                  <h3 className="font-bold text-slate-950">
                    {p.name}
                  </h3>

                  <p className="mt-1 text-sm text-slate-500">
                    {money(p.sellingPrice)} per {p.unit}
                  </p>
                </div>

                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    p.currentStock <= p.minimumStock
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {p.currentStock <= p.minimumStock
                    ? 'Low stock'
                    : 'Healthy'}
                </span>

              </div>

              <div className="mt-5 rounded-xl bg-slate-50 p-4">

                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Current stock
                </p>

                <p className="mt-1 text-2xl font-bold">
                  {p.currentStock}
                </p>

              </div>

            </Card>
          ))}

        </div>
      )}

    </div>
  )
}

/* =========================================================
   KHATA
========================================================= */

function Khata({
  session,
  customers,
  products,
  refresh,
}: Ctx) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [givenAmount, setGivenAmount] = useState('')
  const [givenDateTime, setGivenDateTime] = useState('')
  const [selected, setSelected] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentDateTime, setPaymentDateTime] = useState('')
  const [ledger, setLedger] = useState<LedgerTransaction[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [historyCustomerId, setHistoryCustomerId] = useState<
    string | null
  >(null)

  // Converts a <input type="datetime-local"> value into an ISO timestamp.
  // Falls back to the current time when the field is left blank.
  const toIsoOrNow = (value: string) => {
    if (!value) return now()

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return now()

    return parsed.toISOString()
  }

  const loadLedger = async () => {
    setLedger(
      await localDb.ledgerTransactions
        .where('shopId')
        .equals(session.shopId)
        .toArray(),
    )
  }

  const loadSales = async () => {
    setSales(
      await localDb.sales
        .where('shopId')
        .equals(session.shopId)
        .toArray(),
    )
  }

  useEffect(() => {
    void loadLedger()
    void loadSales()
  }, [session.shopId, customers])

  const add = async (e: FormEvent) => {
    e.preventDefault()

    const openingAmount = Math.max(0, Number(givenAmount) || 0)
    const time = toIsoOrNow(givenDateTime)
    const customerId = id()
    const transactionId = id()

    const customer: Customer = {
      id: customerId,
      customerId,
      shopId: session.shopId,
      name: name.trim(),
      phone: phone.trim(),
      openingBalance: openingAmount,
      interestEnabled: false,
      createdAt: time,
      updatedAt: time,
    }

    await localDb.transaction(
      'rw',
      localDb.customers,
      localDb.outbox,
      async () => {
        await localDb.customers.put(customer)

        await enqueue({
          transactionId,
          entityId: customerId,
          action: 'CREATE',
          endpoint: '/api/customers',
          method: 'POST',
          payload: customer,
        })
      },
    )

    setName('')
    setPhone('')
    setGivenAmount('')
    setGivenDateTime('')

    await refresh()
    await loadLedger()

    setSelected(customerId)
  }

  const deleteCustomerRecords = async (customer: Customer) => {
    const confirmed = window.confirm(
      `Delete ${customer.name}'s customer record?`,
    )

    if (!confirmed) return

    const confirmedAgain = window.confirm(
      `This will permanently delete ${customer.name}'s record and transaction history. Continue?`,
    )

    if (!confirmedAgain) return

    await localDb.transaction(
      'rw',
      localDb.customers,
      localDb.ledgerTransactions,
      async () => {
        await localDb.customers
          .where('id')
          .equals(customer.id)
          .delete()

        await localDb.ledgerTransactions
          .where('shopId')
          .equals(session.shopId)
          .filter((transaction) =>
            transaction.customerId === customer.customerId,
          )
          .delete()
      },
    )

    if (selected === customer.customerId) {
      setSelected('')
    }

    if (historyCustomerId === customer.customerId) {
      setHistoryCustomerId(null)
    }

    await refresh()
    await loadLedger()
    await loadSales()
  }

  // Positive balance = customer still has to pay us
  // Negative balance = customer has paid extra / we owe customer
  const balanceFor = (c: Customer) =>
    c.openingBalance +
    ledger
      .filter((l) => l.customerId === c.customerId)
      .reduce(
        (n, l) =>
          n + (l.direction === 'DEBIT' ? l.amount : -l.amount),
        0,
      )

  const selectedCustomer = customers.find(
    (c) => c.customerId === selected,
  )

  const historyCustomer = customers.find(
    (c) => c.customerId === historyCustomerId,
  )

  const historyBills = historyCustomer
    ? buildCustomerBills(historyCustomer, sales, ledger, products)
    : []

  const [customerSort, setCustomerSort] = useState<
    | 'default'
    | 'dueDesc'
    | 'dueAsc'
    | 'advanceDesc'
    | 'advanceAsc'
    | 'daysDesc'
    | 'daysAsc'
  >('default')

  const PENDING_FILTER_OPTIONS = [
    500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000,
    9000, 10000,
  ] as const

  const [pendingFilter, setPendingFilter] = useState<
    'all' | (typeof PENDING_FILTER_OPTIONS)[number]
  >('all')

  // Pending due = positive balance (customer owes us), Advance = negative balance (we owe customer / customer overpaid).
  const dueAmount = (balance: number) =>
    balance > 0 ? balance : 0

  const advanceAmount = (balance: number) =>
    balance < 0 ? Math.abs(balance) : 0

  // Earliest date this customer started owing money that is still unpaid,
  // based on the opening balance and any DEBIT (credit given) ledger entries.
  const oldestDueTimestamp = (c: Customer) => {
    const timestamps: number[] = []

    if (c.openingBalance > 0) {
      timestamps.push(new Date(c.createdAt).getTime())
    }

    ledger
      .filter(
        (l) =>
          l.customerId === c.customerId &&
          l.direction === 'DEBIT',
      )
      .forEach((l) =>
        timestamps.push(new Date(l.createdAt).getTime()),
      )

    if (timestamps.length === 0) return null

    return Math.min(...timestamps)
  }

  // Number of days a customer's current due has been outstanding.
  // Customers with no due are treated as 0 days.
  const daysPending = (c: Customer, balance: number) => {
    if (balance <= 0) return 0

    const oldest = oldestDueTimestamp(c)
    if (oldest === null) return 0

    const diffMs = Date.now() - oldest
    return Math.max(
      0,
      Math.floor(diffMs / (1000 * 60 * 60 * 24)),
    )
  }

  const sortedCustomers = useMemo(() => {
    const filtered =
      pendingFilter === 'all'
        ? customers
        : customers.filter(
            (c) => dueAmount(balanceFor(c)) > pendingFilter,
          )

    if (customerSort === 'default') return filtered

    const withBalance = filtered.map((c) => {
      const balance = balanceFor(c)

      return {
        customer: c,
        balance,
        days: daysPending(c, balance),
      }
    })

    withBalance.sort((a, b) => {
      switch (customerSort) {
        case 'dueDesc':
          return (
            dueAmount(b.balance) - dueAmount(a.balance)
          )
        case 'dueAsc':
          return (
            dueAmount(a.balance) - dueAmount(b.balance)
          )
        case 'advanceDesc':
          return (
            advanceAmount(b.balance) -
            advanceAmount(a.balance)
          )
        case 'advanceAsc':
          return (
            advanceAmount(a.balance) -
            advanceAmount(b.balance)
          )
        case 'daysDesc':
          return b.days - a.days
        case 'daysAsc':
          return a.days - b.days
        default:
          return 0
      }
    })

    return withBalance.map((w) => w.customer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, ledger, customerSort, pendingFilter])

  const pay = async () => {
    if (!selectedCustomer) {
      alert('Choose a customer first')
      return
    }

    const received = Number(amount)

    if (!Number.isFinite(received) || received <= 0) {
      alert('Enter a valid amount received')
      return
    }

    const due = balanceFor(selectedCustomer)

    if (received > due) {
      const advanceAmount = received - due

      if (due > 0) {
        alert(
          `This clears the outstanding due of ${money(
            due,
          )} and records the remaining ${money(
            advanceAmount,
          )} as an advance from the customer.`,
        )
      } else if (due === 0) {
        alert(
          `This customer has no outstanding due. ${money(
            advanceAmount,
          )} will be recorded as an advance from the customer.`,
        )
      } else {
        alert(
          `This adds ${money(
            advanceAmount,
          )} to the customer's existing advance of ${money(
            Math.abs(due),
          )}.`,
        )
      }
    }

    const time = toIsoOrNow(paymentDateTime)
    const transactionId = id()

    const payment: Payment = {
      id: id(),
      paymentId: id(),
      shopId: session.shopId,
      customerId: selectedCustomer.customerId,
      amount: received,
      status: 'SUCCESS',
      provider: 'CASH',
      transactionId,
      verifiedAt: time,
      createdAt: time,
      updatedAt: time,
    }

    const entry: LedgerTransaction = {
      id: id(),
      shopId: session.shopId,
      transactionId: `${transactionId}:ledger`,
      customerId: selectedCustomer.customerId,
      type: 'PAYMENT',
      direction: 'CREDIT',
      amount: received,
      referenceId: payment.paymentId,
      description: 'Cash payment received',
      createdAt: time,
      updatedAt: time,
    }

    await localDb.transaction(
      'rw',
      localDb.payments,
      localDb.ledgerTransactions,
      localDb.outbox,
      async () => {
        await localDb.payments.put(payment)
        await localDb.ledgerTransactions.put(entry)

        await enqueue({
          transactionId,
          entityId: payment.paymentId,
          action: 'CREATE',
          endpoint: '/api/payments',
          method: 'POST',
          payload: payment,
        })
      },
    )

    setAmount('')
    setPaymentDateTime('')
    await refresh()
    await loadLedger()
  }

  const customerHistory = selectedCustomer
    ? [
        ...(selectedCustomer.openingBalance > 0
          ? [
              {
                id: `opening-${selectedCustomer.customerId}`,
                createdAt: selectedCustomer.createdAt,
                description: 'Credit given',
                direction: 'DEBIT' as const,
                amount: selectedCustomer.openingBalance,
              },
            ]
          : []),

        ...ledger
          .filter(
            (l) => l.customerId === selectedCustomer.customerId,
          )
          .map((l) => ({
            id: l.id,
            createdAt: l.createdAt,
            description: l.description,
            direction: l.direction,
            amount: l.amount,
          })),
      ].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      )
    : []

  // Calculate running balance for history.
  // Positive = customer owes us.
  // Negative = customer has paid in advance.
  let runningBalance = 0

  const historyWithBalance = customerHistory.map((item) => {
    runningBalance +=
      item.direction === 'DEBIT'
        ? item.amount
        : -item.amount

    return {
      ...item,
      balance: runningBalance,
    }
  })

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="CUSTOMER CREDIT"
        title="Khata"
        description="Track customers, credit given, payments received and complete transaction history."
      />

      {/* ADD CUSTOMER */}
      <Card>
        <div className="mb-4">
          <h2 className="font-bold text-slate-950">
            Add customer
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Add the credit amount given to this customer.
          </p>
        </div>

        <form
          onSubmit={add}
          className="grid gap-3 md:grid-cols-5"
        >
          <Input
            placeholder="Customer name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />

          <Input
            type="number"
            min="0"
            step="1"
            placeholder="Credit given"
            value={givenAmount}
            onChange={(e) =>
              setGivenAmount(e.target.value)
            }
            required
          />

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              Date &amp; time (optional)
            </label>

            <Input
              type="datetime-local"
              value={givenDateTime}
              onChange={(e) =>
                setGivenDateTime(e.target.value)
              }
            />
          </div>

          <PrimaryButton>
            + Add customer
          </PrimaryButton>
        </form>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
        {/* CUSTOMER LIST */}
        <div className="space-y-3">
          {customers.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold text-slate-950">
                Customers
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={pendingFilter}
                  onChange={(e) =>
                    setPendingFilter(
                      (e.target.value === 'all'
                        ? 'all'
                        : Number(
                            e.target.value,
                          )) as typeof pendingFilter,
                    )
                  }
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm focus:border-emerald-400 focus:outline-none"
                >
                  <option value="all">
                    Filter: All customers
                  </option>

                  {PENDING_FILTER_OPTIONS.map((amt) => (
                    <option key={amt} value={amt}>
                      Pending above {money(amt)}
                    </option>
                  ))}
                </select>

                <select
                  value={customerSort}
                  onChange={(e) =>
                    setCustomerSort(
                      e.target.value as typeof customerSort,
                    )
                  }
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm focus:border-emerald-400 focus:outline-none"
                >
                  <option value="default">Sort by</option>
                  <option value="dueDesc">
                    Pending due: High to Low
                  </option>
                  <option value="dueAsc">
                    Pending due: Low to High
                  </option>
                  <option value="advanceDesc">
                    Advance received: High to Low
                  </option>
                  <option value="advanceAsc">
                    Advance received: Low to High
                  </option>
                  <option value="daysDesc">
                    Pending since: Max days to Min days
                  </option>
                  <option value="daysAsc">
                    Pending since: Min days to Max days
                  </option>
                </select>
              </div>
            </div>
          )}

          {customers.length === 0 ? (
            <EmptyState
              icon="📒"
              title="No customers yet"
              text="Add a customer above to start using Khata."
            />
          ) : sortedCustomers.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="No customers match this filter"
              text="Try a lower pending amount or clear the filter."
            />
          ) : (
            sortedCustomers.map((c) => {
              const balance = balanceFor(c)

              const received = ledger
                .filter(
                  (l) =>
                    l.customerId === c.customerId &&
                    l.direction === 'CREDIT',
                )
                .reduce(
                  (n, l) => n + l.amount,
                  0,
                )

              const hasDue = balance > 0
              const hasAdvance = balance < 0
              const pendingDays = daysPending(c, balance)

              return (
                <button
                  type="button"
                  className={`block w-full rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    selected === c.customerId
                      ? 'border-emerald-500 ring-4 ring-emerald-50'
                      : 'border-slate-200'
                  }`}
                  onClick={() =>
                    setSelected(c.customerId)
                  }
                  key={c.id}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setHistoryCustomerId(c.customerId)
                        }}
                        className="text-base font-bold text-slate-950 underline decoration-dotted decoration-slate-300 underline-offset-4 transition hover:text-emerald-700 hover:decoration-emerald-400"
                      >
                        {c.name}
                      </button>

                      <p className="mt-1 text-sm text-slate-500">
                        {c.phone}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
                          Credit given{' '}
                          {money(c.openingBalance)}
                        </span>

                        <span className="rounded-lg bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                          Received {money(received)}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void deleteCustomerRecords(c)
                        }}
                        className="mb-3 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
                      >
                        Delete
                      </button>

                      {hasDue ? (
                        <>
                          <p className="text-xs text-slate-400">
                            Due from customer
                          </p>

                          <p className="text-xl font-bold text-amber-700">
                            {money(balance)}
                          </p>

                          <p className="mt-1 text-xs font-semibold text-amber-600">
                            Pending{' '}
                            {pendingDays === 0
                              ? 'since today'
                              : pendingDays === 1
                                ? 'for 1 day'
                                : `for ${pendingDays} days`}
                          </p>
                        </>
                      ) : hasAdvance ? (
                        <>
                          <p className="text-xs text-slate-400">
                            Customer advance
                          </p>

                          <p className="text-xl font-bold text-emerald-700">
                            {money(Math.abs(balance))}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-slate-400">
                            Account settled
                          </p>

                          <p className="text-xl font-bold text-emerald-700">
                            ₹0
                          </p>
                        </>
                      )}
                    </div>
                  </div>

                  {hasAdvance && (
                    <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                      This customer has paid{' '}
                      <b>{money(Math.abs(balance))}</b>{' '}
                      in advance.
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* PAYMENT + HISTORY */}
        <Card className="h-fit lg:sticky lg:top-36">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              ₹
            </div>

            <div>
              <h2 className="font-bold">
                Record payment
              </h2>

              <p className="text-xs text-slate-500">
                Record money received from a customer.
              </p>
            </div>
          </div>

          <Select
            className="mt-5"
            value={selected}
            onChange={(e) =>
              setSelected(e.target.value)
            }
          >
            <option value="">
              Choose customer
            </option>

            {customers.map((c) => (
              <option
                key={c.id}
                value={c.customerId}
              >
                {c.name}
              </option>
            ))}
          </Select>

          {selectedCustomer && (
            <>
              {balanceFor(selectedCustomer) > 0 ? (
                <div className="mt-3 rounded-xl bg-amber-50 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-amber-800">
                      Due from customer
                    </span>

                    <b className="text-lg text-amber-800">
                      {money(
                        balanceFor(selectedCustomer),
                      )}
                    </b>
                  </div>
                </div>
              ) : balanceFor(selectedCustomer) < 0 ? (
                <div className="mt-3 rounded-xl bg-emerald-50 p-4">
                  <p className="text-sm font-semibold text-emerald-800">
                    Customer has paid in advance
                  </p>

                  <p className="mt-1 text-sm text-emerald-700">
                    You have received{' '}
                    <b>
                      {money(
                        Math.abs(
                          balanceFor(
                            selectedCustomer,
                          ),
                        ),
                      )}
                    </b>{' '}
                    extra from this customer.
                  </p>
                </div>
              ) : (
                <div className="mt-3 rounded-xl bg-emerald-50 p-4">
                  <p className="text-sm font-semibold text-emerald-800">
                    Account settled
                  </p>

                  <p className="mt-1 text-sm text-emerald-700">
                    No amount is currently due.
                  </p>
                </div>
              )}
            </>
          )}

          <Input
            className="mt-3"
            type="number"
            min="1"
            step="1"
            placeholder="Amount received"
            value={amount}
            onChange={(e) =>
              setAmount(e.target.value)
            }
            disabled={!selectedCustomer}
          />

          <div className="mt-3">
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              Date &amp; time (optional)
            </label>

            <Input
              type="datetime-local"
              value={paymentDateTime}
              onChange={(e) =>
                setPaymentDateTime(e.target.value)
              }
              disabled={!selectedCustomer}
            />
          </div>

          <PrimaryButton
            type="button"
            className="mt-3 w-full"
            onClick={pay}
            disabled={!selectedCustomer}
          >
            Save cash payment
          </PrimaryButton>

          {/* CUSTOMER HISTORY */}
          {selectedCustomer && (
            <div className="mt-7 border-t border-slate-100 pt-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Customer history
                  </p>

                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {selectedCustomer.name}
                  </p>
                </div>

                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {historyWithBalance.length}{' '}
                  entries
                </span>
              </div>

              {historyWithBalance.length === 0 ? (
                <div className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">
                  No transactions yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {historyWithBalance
                    .slice()
                    .reverse()
                    .map((item) => {
                      const balance = item.balance

                      return (
                        <div
                          className="rounded-xl border border-slate-100 bg-slate-50 p-3"
                          key={item.id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">
                                {item.description}
                              </p>

                              <p className="mt-1 text-xs text-slate-400">
                                {new Date(
                                  item.createdAt,
                                ).toLocaleString(
                                  'en-IN',
                                  {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  },
                                )}
                              </p>
                            </div>

                            <b
                              className={
                                item.direction ===
                                'DEBIT'
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                              }
                            >
                              {item.direction ===
                              'DEBIT'
                                ? `+ ${money(
                                    item.amount,
                                  )}`
                                : `− ${money(
                                    item.amount,
                                  )}`}
                            </b>
                          </div>

                          <div className="mt-2 border-t border-slate-200 pt-2">
                            {balance > 0 ? (
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-500">
                                  Due from customer
                                </span>

                                <span className="font-semibold text-amber-700">
                                  {money(balance)}
                                </span>
                              </div>
                            ) : balance < 0 ? (
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-500">
                                  Customer advance
                                </span>

                                <span className="font-semibold text-emerald-700">
                                  {money(
                                    Math.abs(balance),
                                  )}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-500">
                                  Balance
                                </span>

                                <span className="font-semibold text-emerald-700">
                                  Settled
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {historyCustomer && (
        <CustomerHistoryModal
          customer={historyCustomer}
          bills={historyBills}
          onClose={() => setHistoryCustomerId(null)}
        />
      )}
    </div>
  )
}

/* =========================================================
   CUSTOMER HISTORY MODAL
========================================================= */

function CustomerHistoryModal({
  customer,
  bills,
  onClose,
}: {
  customer: Customer
  bills: CustomerBill[]
  onClose: () => void
}) {
  const totalDue = bills.reduce((n, b) => n + b.amountDue, 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 pt-10 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Purchase history
            </p>

            <h2 className="mt-1 text-lg font-bold text-slate-950">
              {customer.name}
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              {customer.phone}
            </p>

            <p className="mt-2 text-sm font-semibold text-amber-700">
              {totalDue > 0
                ? `Total due: ${money(totalDue)}`
                : 'No amount due'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-5">
          {bills.length === 0 ? (
            <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
              No purchase records yet for this customer.
            </div>
          ) : (
            bills.map((bill) => (
              <div
                key={bill.id}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {bill.label}
                    </p>

                    <p className="mt-0.5 text-xs text-slate-400">
                      {new Date(bill.date).toLocaleString(
                        'en-IN',
                        {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        },
                      )}
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      bill.status === 'PAID'
                        ? 'bg-emerald-50 text-emerald-700'
                        : bill.status === 'PARTIAL'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {bill.status === 'PAID'
                      ? 'Cleared'
                      : bill.status === 'PARTIAL'
                        ? 'Partially paid'
                        : 'Due'}
                  </span>
                </div>

                {bill.items.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                    {bill.items.map((item, idx) => (
                      <div
                        className="flex items-center justify-between text-sm"
                        key={`${bill.id}-${item.productId}-${idx}`}
                      >
                        <span className="text-slate-600">
                          {item.name}{' '}
                          <span className="text-slate-400">
                            × {item.quantity} @{' '}
                            {money(item.price)}
                          </span>
                        </span>

                        <span className="font-medium text-slate-800">
                          {money(item.lineTotal)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
                  {bill.subtotal !== undefined && (
                    <div className="flex justify-between text-slate-500">
                      <span>Subtotal</span>
                      <span>{money(bill.subtotal)}</span>
                    </div>
                  )}

                  {!!bill.discount && (
                    <div className="flex justify-between text-slate-500">
                      <span>Discount</span>
                      <span>
                        − {money(bill.discount)}
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between font-bold text-slate-900">
                    <span>Total bill</span>
                    <span>{money(bill.total)}</span>
                  </div>

                  {bill.amountPaid > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Paid</span>
                      <span>{money(bill.amountPaid)}</span>
                    </div>
                  )}

                  {bill.amountDue > 0 && (
                    <div className="flex justify-between font-semibold text-amber-700">
                      <span>Due</span>
                      <span>{money(bill.amountDue)}</span>
                    </div>
                  )}

                  {bill.status === 'PAID' && bill.clearedAt && (
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Cleared on</span>
                      <span>
                        {new Date(
                          bill.clearedAt,
                        ).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/* =========================================================
   POS
========================================================= */

function Pos({
  session,
  products,
  customers,
  refresh,
}: Ctx) {
  const [cart, setCart] = useState<Record<string, number>>({})
  const [customerId, setCustomerId] = useState('')
  const [method, setMethod] =
    useState<'CASH' | 'CREDIT' | 'UPI'>('CASH')
  const [showUpi, setShowUpi] = useState(false)
  const [view, setView] = useState<'billing' | 'deliveries'>('billing')
  const [pendingSales, setPendingSales] = useState<Sale[]>([])
  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [paymentDialog, setPaymentDialog] = useState<{
    saleId: string
    sale: Sale
  } | null>(null)
  const [paymentStatus, setPaymentStatus] =
    useState<'PAID' | 'PARTIAL' | 'NOT_PAID'>('NOT_PAID')
  const [amountPaid, setAmountPaid] = useState('')

  const loadPendingSales = async () => {
    const sales = await localDb.sales
      .where('shopId')
      .equals(session.shopId)
      .toArray()

    // Get all khata entries to see which orders have been marked as delivered
    const allLedger = await localDb.ledgerTransactions
      .where('shopId')
      .equals(session.shopId)
      .toArray()

    const deliveredOrderIds = new Set(
      allLedger
        .filter((l) => l.description?.includes('Delivery order'))
        .map((l) => l.referenceId),
    )

    const pending = sales.filter(
      (s) =>
        (s.paymentStatus === 'PENDING' ||
          s.paymentStatus === 'FAILED') &&
        s.customerId &&
        !deliveredOrderIds.has(s.saleId), // Exclude orders already marked as delivered
    )
    setPendingSales(pending)

    const allItems = await localDb.saleItems.toArray()
    setSaleItems(allItems)
  }

  useEffect(() => {
    void loadPendingSales()
  }, [session.shopId])

  const total = useMemo(
    () =>
      products.reduce(
        (n, p) =>
          n + (cart[p.productId] || 0) * p.sellingPrice,
        0,
      ),
    [products, cart],
  )

  const transactionId = id()

  const upi =
    `upi://pay?pa=saathikirana@upi` +
    `&pn=Saathi%20Kirana%20Store` +
    `&am=${total.toFixed(2)}` +
    `&tn=DukaanSaathi%20sale` +
    `&tr=${transactionId}`

  const checkout = async () => {
    const items = products
      .filter((p) => cart[p.productId])
      .map((p) => ({
        saleItemId: id(),
        saleId: '',
        productId: p.productId,
        quantity: cart[p.productId],
        price: p.sellingPrice,
        purchasePrice: p.purchasePrice,
      }))

    if (
      !items.length ||
      items.some(
        (i) =>
          products.find(
            (p) => p.productId === i.productId,
          )!.currentStock < i.quantity,
      )
    ) {
      return alert('Add items within available stock')
    }

    if (method === 'CREDIT' && !customerId) {
      return alert('Choose a customer for credit')
    }

    const time = now()
    const saleId = id()
    const tid = id()

    items.forEach((i) => {
      i.saleId = saleId
    })

    const sale: Sale = {
      id: saleId,
      saleId,
      shopId: session.shopId,
      customerId:
        method === 'CREDIT' ? customerId : undefined,
      items,
      subtotal: total,
      discount: 0,
      tax: 0,
      total,
      paymentMethod: method,
      paymentStatus:
        method === 'CREDIT'
          ? 'PENDING'
          : method === 'UPI'
            ? 'PENDING'
            : 'SUCCESS',
      transactionId: tid,
      createdAt: time,
      updatedAt: time,
    }

    await localDb.transaction(
      'rw',
      [
        localDb.sales,
        localDb.saleItems,
        localDb.products,
        localDb.stockMovements,
        localDb.ledgerTransactions,
        localDb.outbox,
      ],
      async () => {
        await localDb.sales.put(sale)

        await localDb.saleItems.bulkPut(
          items as SaleItem[],
        )

        for (const i of items) {
          const p = products.find(
            (v) => v.productId === i.productId,
          )!

          await localDb.products.put({
            ...p,
            currentStock: p.currentStock - i.quantity,
            updatedAt: time,
          })

          await localDb.stockMovements.put({
            id: id(),
            shopId: session.shopId,
            transactionId: `${tid}:${i.productId}`,
            productId: i.productId,
            quantity: i.quantity,
            type: 'SALE',
            direction: 'OUT',
            referenceId: saleId,
            createdAt: time,
            updatedAt: time,
          })
        }

        if (method === 'CREDIT') {
          await localDb.ledgerTransactions.put({
            id: id(),
            shopId: session.shopId,
            transactionId: `${tid}:ledger`,
            customerId,
            type: 'SALE',
            direction: 'DEBIT',
            amount: total,
            referenceId: saleId,
            description: 'Credit sale',
            createdAt: time,
            updatedAt: time,
          })
        }

        await enqueue({
          transactionId: tid,
          entityId: saleId,
          action: 'CREATE',
          endpoint: '/api/sales',
          method: 'POST',
          payload: sale,
        })
      },
    )

    setCart({})
    setCustomerId('')

    await refresh()

    alert(`Receipt saved locally: ${money(total)}`)
  }

  const handlePaymentConfirm = async () => {
    if (!paymentDialog) return

    const { saleId, sale } = paymentDialog
    const time = now()
    let newPaymentStatus: PaymentStatus = 'SUCCESS'
    let amountOwed = 0

    if (paymentStatus === 'NOT_PAID') {
      newPaymentStatus = 'PENDING'
      amountOwed = sale.total
    } else if (paymentStatus === 'PARTIAL') {
      newPaymentStatus = 'PENDING'
      const paid = parseFloat(amountPaid) || 0
      amountOwed = Math.max(0, sale.total - paid)
    } else {
      newPaymentStatus = 'SUCCESS'
      amountOwed = 0
    }

    // Update sale with new payment status
    await localDb.sales.put({
      ...sale,
      paymentStatus: newPaymentStatus,
      updatedAt: time,
    })

    // If customer and amount owed, add/update khata
    if (sale.customerId && amountOwed > 0) {
      // Get customer's existing balance from other ledger entries
      const existingEntries =
        await localDb.ledgerTransactions
          .where('customerId')
          .equals(sale.customerId)
          .toArray()

      // Calculate total outstanding balance
      let totalBalance = 0
      for (const entry of existingEntries) {
        if (entry.direction === 'DEBIT') {
          totalBalance += entry.amount
        } else if (entry.direction === 'CREDIT') {
          totalBalance -= entry.amount
        }
      }

      // Add this sale's outstanding amount
      const newBalance = totalBalance + amountOwed

      // Check if khata entry already exists for this sale
      const existingEntry =
        await localDb.ledgerTransactions
          .where('referenceId')
          .equals(saleId)
          .first()

      if (!existingEntry) {
        await localDb.ledgerTransactions.put({
          id: id(),
          shopId: session.shopId,
          transactionId: `${sale.transactionId}:khata`,
          customerId: sale.customerId,
          type: 'SALE',
          direction: 'DEBIT',
          amount: amountOwed,
          referenceId: saleId,
          description:
            paymentStatus === 'PARTIAL'
              ? `Delivery order - partial payment (${money(parseFloat(amountPaid) || 0)} paid)`
              : 'Delivery order - unpaid',
          createdAt: time,
          updatedAt: time,
        })
      }
    } else if (sale.customerId && newPaymentStatus === 'SUCCESS') {
      // For paid orders, also create a delivery entry to mark as processed
      const existingEntry =
        await localDb.ledgerTransactions
          .where('referenceId')
          .equals(saleId)
          .first()

      if (!existingEntry) {
        await localDb.ledgerTransactions.put({
          id: id(),
          shopId: session.shopId,
          transactionId: `${sale.transactionId}:delivery`,
          customerId: sale.customerId,
          type: 'SALE',
          direction: 'CREDIT',
          amount: 0,
          referenceId: saleId,
          description: 'Delivery order - paid',
          createdAt: time,
          updatedAt: time,
        })
      }
    }

    // Enqueue for sync
    await enqueue({
      transactionId: sale.transactionId,
      entityId: saleId,
      action: 'UPDATE',
      endpoint: '/api/sales',
      method: 'PUT',
      payload: { ...sale, paymentStatus: newPaymentStatus },
    })

    setPaymentDialog(null)
    setPaymentStatus('NOT_PAID')
    setAmountPaid('')

    // First, remove from state immediately for UI responsiveness
    setPendingSales((prev) =>
      prev.filter((s) => s.saleId !== saleId),
    )

    // Reload from the database using the same delivered-order filter.
    await refresh()
    await loadPendingSales()

    const statusMsg =
      newPaymentStatus === 'SUCCESS'
        ? 'Order marked as paid'
        : amountOwed > 0
          ? `Order marked with ${money(amountOwed)} pending - added to khata`
          : 'Order marked as delivered'

    alert(statusMsg)
  }

  const openPaymentDialog = (sale: Sale) => {
    setPaymentDialog({ saleId: sale.saleId, sale })
    setPaymentStatus('NOT_PAID')
    setAmountPaid('')
  }

  const markAsDelivered = async (saleId: string) => {
    const sale = pendingSales.find((s) => s.saleId === saleId)
    if (!sale) return

    openPaymentDialog(sale)
  }

  return (
    <div className="space-y-5">

      {/* PAYMENT STATUS DIALOG */}
      {paymentDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <Card className="w-full max-w-md">
            <div>
              <h3 className="text-lg font-bold">
                Payment Status
              </h3>

              <p className="mt-2 text-sm text-slate-500">
                Order Total: <span className="font-bold">{money(paymentDialog.sale.total)}</span>
              </p>
            </div>

            <div className="my-5 space-y-3">
              <label className="flex items-center gap-3 rounded-lg border-2 border-slate-200 p-3 cursor-pointer hover:border-emerald-300"
                onClick={() => setPaymentStatus('PAID')}
              >
                <input
                  type="radio"
                  checked={paymentStatus === 'PAID'}
                  onChange={() => setPaymentStatus('PAID')}
                  className="cursor-pointer"
                />
                <div>
                  <p className="font-semibold">Paid in Full</p>
                  <p className="text-xs text-slate-500">
                    No entry in khata
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 rounded-lg border-2 border-slate-200 p-3 cursor-pointer hover:border-emerald-300"
                onClick={() => setPaymentStatus('PARTIAL')}
              >
                <input
                  type="radio"
                  checked={paymentStatus === 'PARTIAL'}
                  onChange={() => setPaymentStatus('PARTIAL')}
                  className="cursor-pointer"
                />
                <div>
                  <p className="font-semibold">Partial Payment</p>
                  <p className="text-xs text-slate-500">
                    Enter amount paid
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 rounded-lg border-2 border-slate-200 p-3 cursor-pointer hover:border-emerald-300"
                onClick={() => setPaymentStatus('NOT_PAID')}
              >
                <input
                  type="radio"
                  checked={paymentStatus === 'NOT_PAID'}
                  onChange={() => setPaymentStatus('NOT_PAID')}
                  className="cursor-pointer"
                />
                <div>
                  <p className="font-semibold">Not Paid</p>
                  <p className="text-xs text-slate-500">
                    Full amount to khata
                  </p>
                </div>
              </label>
            </div>

            {paymentStatus === 'PARTIAL' && (
              <div className="mb-4">
                <label className="block text-sm font-semibold text-slate-700">
                  Amount Paid
                </label>

                <input
                  type="number"
                  value={amountPaid}
                  onChange={(e) =>
                    setAmountPaid(e.target.value)
                  }
                  placeholder="0"
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2"
                />

                {amountPaid && (
                  <p className="mt-2 text-sm text-slate-600">
                    Remaining:{' '}
                    <span className="font-bold">
                      {money(
                        Math.max(
                          0,
                          paymentDialog.sale.total -
                            (parseFloat(amountPaid) || 0),
                        ),
                      )}
                    </span>
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setPaymentDialog(null)
                  setPaymentStatus('NOT_PAID')
                  setAmountPaid('')
                }}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>

              <PrimaryButton
                className="flex-1"
                onClick={handlePaymentConfirm}
              >
                Confirm
              </PrimaryButton>
            </div>
          </Card>
        </div>
      )}

      <PageHeader
        eyebrow="POINT OF SALE"
        title="Point of sale"
        description={
          view === 'billing'
            ? 'Build a bill and complete a sale quickly.'
            : 'Manage pending deliveries and payments.'
        }
      />

      <div className="mb-4 flex gap-2 border-b border-slate-200">
        <button
          onClick={() => setView('billing')}
          className={`px-4 py-2 font-semibold transition ${
            view === 'billing'
              ? 'border-b-2 border-emerald-600 text-emerald-600'
              : 'text-slate-500'
          }`}
        >
          New Sale
        </button>

        <button
          onClick={() => setView('deliveries')}
          className={`px-4 py-2 font-semibold transition ${
            view === 'deliveries'
              ? 'border-b-2 border-emerald-600 text-emerald-600'
              : 'text-slate-500'
          }`}
        >
          Pending Deliveries ({pendingSales.length})
        </button>
      </div>

      {view === 'billing' && (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">

        {/* PRODUCTS */}
        <div>

          <div className="mb-3 flex items-center justify-between">

            <h2 className="font-bold text-slate-950">
              Products
            </h2>

            <span className="text-xs text-slate-400">
              {products.length} available
            </span>

          </div>

          <div className="grid gap-3 sm:grid-cols-2">

            {products.map((p) => (
              <button
                key={p.id}
                disabled={!p.currentStock}
                onClick={() =>
                  setCart((c) => ({
                    ...c,
                    [p.productId]:
                      (c[p.productId] || 0) + 1,
                  }))
                }
                className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
              >

                <div className="flex items-start justify-between">

                  <div>
                    <b className="text-base">
                      {p.name}
                    </b>

                    <p className="mt-1 text-sm text-slate-500">
                      {money(p.sellingPrice)}
                    </p>
                  </div>

                  <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500">
                    {p.currentStock} left
                  </span>

                </div>

                <div className="mt-4 text-sm font-semibold text-emerald-700">
                  + Add to bill
                </div>

              </button>
            ))}

          </div>

        </div>

        {/* BILL */}
        <Card className="h-fit lg:sticky lg:top-36">

          <div className="flex items-center justify-between">

            <div>
              <h2 className="text-lg font-bold">
                Current bill
              </h2>

              <p className="text-xs text-slate-500">
                {Object.values(cart).reduce(
                  (a, b) => a + b,
                  0,
                )}{' '}
                items
              </p>
            </div>

            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
              {money(total)}
            </div>

          </div>

          <div className="mt-5 space-y-2">

            {Object.entries(cart).length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-400">
                Your bill is empty.
                <br />
                Select products to begin.
              </div>
            ) : (
              Object.entries(cart).map(
                ([pid, q]) => {
                  const p = products.find(
                    (v) => v.productId === pid,
                  )!

                  return (
                    <div
                      className="flex items-center justify-between rounded-xl bg-slate-50 p-3"
                      key={pid}
                    >

                      <div>
                        <p className="text-sm font-semibold">
                          {p.name}
                        </p>

                        <p className="text-xs text-slate-500">
                          {money(p.sellingPrice)} × {q}
                        </p>
                      </div>

                      <button
                        className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white font-bold text-slate-600"
                        onClick={() =>
                          setCart((c) => ({
                            ...c,
                            [pid]: Math.max(
                              0,
                              (c[pid] || 0) - 1,
                            ),
                          }))
                        }
                      >
                        −
                      </button>

                    </div>
                  )
                },
              )
            )}

          </div>

          <div className="my-5 border-t border-slate-100 pt-4">

            <div className="flex justify-between">
              <span className="text-sm text-slate-500">
                Total
              </span>

              <span className="text-2xl font-bold">
                {money(total)}
              </span>
            </div>

          </div>

          <Select
            value={method}
            onChange={(e) =>
              setMethod(
                e.target.value as typeof method,
              )
            }
          >
            <option value="CASH">
              Cash
            </option>

            <option value="UPI">
              UPI (demo verification)
            </option>

            <option value="CREDIT">
              Credit / Khata
            </option>
          </Select>

          {method === 'CREDIT' && (
            <Select
              className="mt-3"
              value={customerId}
              onChange={(e) =>
                setCustomerId(e.target.value)
              }
            >
              <option value="">
                Customer
              </option>

              {customers.map((c) => (
                <option
                  key={c.id}
                  value={c.customerId}
                >
                  {c.name}
                </option>
              ))}
            </Select>
          )}

          {method === 'UPI' && (
            <button
              onClick={() =>
                setShowUpi(!showUpi)
              }
              className="mt-3 w-full rounded-xl border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800"
            >
              {showUpi ? 'Hide' : 'Show'} UPI QR
            </button>
          )}

          {showUpi && (
            <div className="mt-3 grid place-items-center rounded-2xl bg-slate-50 p-5">

              <QRCodeSVG
                value={upi}
                size={180}
              />

              <a
                className="mt-3 text-sm font-semibold text-emerald-700"
                href={upi}
              >
                Open UPI app
              </a>

              <small className="mt-2 text-center text-xs text-slate-500">
                Demo verification only — confirm payment manually.
              </small>

            </div>
          )}

          <PrimaryButton
            className="mt-4 w-full"
            onClick={checkout}
          >
            Save {method.toLowerCase()} sale
          </PrimaryButton>

        </Card>

      </div>
      )}

      {view === 'deliveries' && (
        <div className="space-y-4">
          {pendingSales.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-slate-500">
                No pending deliveries
              </p>
            </div>
          ) : (
            pendingSales.map((sale) => {
              const customer = customers.find(
                (c) => c.customerId === sale.customerId,
              )
              const items = saleItems.filter(
                (i) => i.saleId === sale.saleId,
              )

              return (
                <Card key={sale.saleId}>
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      {customer && (
                        <>
                          <h3 className="text-lg font-bold">
                            {customer.name}
                          </h3>

                          <p className="text-sm text-slate-500">
                            {customer.phone}
                          </p>
                        </>
                      )}

                      <p className="mt-1 text-xs text-slate-400">
                        {new Date(
                          sale.createdAt,
                        ).toLocaleDateString('en-IN')}{' '}
                        at{' '}
                        {new Date(
                          sale.createdAt,
                        ).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>

                    <span
                      className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                        sale.paymentStatus === 'PENDING'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {sale.paymentStatus}
                    </span>
                  </div>

                  <div className="my-4 border-t border-slate-100 pt-4">
                    <h4 className="mb-3 font-semibold text-slate-700">
                      Order Items
                    </h4>

                    <div className="space-y-2">
                      {items.map((item) => {
                        const product = products.find(
                          (p) =>
                            p.productId ===
                            item.productId,
                        )

                        return (
                          <div
                            key={item.saleItemId}
                            className="flex items-center justify-between rounded-lg bg-slate-50 p-3"
                          >
                            <div>
                              <p className="font-medium">
                                {product?.name ||
                                  'Unknown'}
                              </p>

                              <p className="text-xs text-slate-500">
                                Qty: {item.quantity} ×{' '}
                                {money(item.price)}
                              </p>
                            </div>

                            <p className="font-semibold">
                              {money(
                                item.quantity *
                                  item.price,
                              )}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className="my-4 border-t border-slate-100 pt-4">
                    <div className="flex justify-between">
                      <span className="text-slate-600">
                        Payment Method
                      </span>

                      <span className="font-semibold">
                        {sale.paymentMethod}
                      </span>
                    </div>

                    <div className="mt-2 flex justify-between text-lg font-bold">
                      <span>Total</span>

                      <span>{money(sale.total)}</span>
                    </div>
                  </div>

                  <PrimaryButton
                    className="mt-4 w-full"
                    onClick={() =>
                      markAsDelivered(sale.saleId)
                    }
                  >
                    Mark as Delivered
                  </PrimaryButton>
                </Card>
              )
            })
          )}
        </div>
      )}

    </div>
  )
}

/* =========================================================
   SUPPLIERS
========================================================= */

function Suppliers({
  session,
  products,
  refresh,
}: Ctx) {
  const [name, setName] = useState('')
  const [items, setItems] = useState<Supplier[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])

  useEffect(() => {
    void localDb.suppliers
      .where('shopId')
      .equals(session.shopId)
      .toArray()
      .then(setItems)

    void localDb.purchaseOrders
      .where('shopId')
      .equals(session.shopId)
      .toArray()
      .then(setOrders)
  }, [session.shopId])

  const add = async (e: FormEvent) => {
    e.preventDefault()

    const time = now()
    const supplierId = id()

    const v: Supplier = {
      id: supplierId,
      supplierId,
      shopId: session.shopId,
      name,
      createdAt: time,
      updatedAt: time,
    }

    await localDb.transaction(
      'rw',
      localDb.suppliers,
      localDb.outbox,
      async () => {
        await localDb.suppliers.put(v)

        await enqueue({
          transactionId: id(),
          entityId: supplierId,
          action: 'CREATE',
          endpoint: '/api/suppliers',
          method: 'POST',
          payload: v,
        })
      },
    )

    setItems([...items, v])
    setName('')
  }

  const order = async (supplierId: string) => {
    const low = products.filter(
      (p) => p.currentStock <= p.minimumStock,
    )

    if (!low.length) {
      return alert('No low-stock products')
    }

    const time = now()
    const purchaseOrderId = id()

    const v: PurchaseOrder = {
      id: purchaseOrderId,
      purchaseOrderId,
      shopId: session.shopId,
      supplierId,
      items: low.map((p) => ({
        productId: p.productId,
        quantity: Math.max(
          1,
          p.minimumStock * 2 - p.currentStock,
        ),
        price:
          p.purchasePrice ||
          p.sellingPrice,
      })),
      estimatedTotal: low.reduce(
        (n, p) =>
          n +
          Math.max(
            1,
            p.minimumStock * 2 -
              p.currentStock,
          ) *
            (p.purchasePrice ||
              p.sellingPrice),
        0,
      ),
      status: 'DRAFT',
      transactionId: id(),
      createdAt: time,
      updatedAt: time,
    }

    await localDb.transaction(
      'rw',
      localDb.purchaseOrders,
      localDb.outbox,
      async () => {
        await localDb.purchaseOrders.put(v)

        await enqueue({
          transactionId: v.transactionId,
          entityId: purchaseOrderId,
          action: 'CREATE',
          endpoint: '/api/purchase-orders',
          method: 'POST',
          payload: v,
        })
      },
    )

    setOrders([...orders, v])

    await refresh()
  }

  return (
    <div className="space-y-5">

      <PageHeader
        eyebrow="SUPPLY CHAIN"
        title="Suppliers"
        description="Manage suppliers and create purchase drafts."
      />

      <Card>

        <form
          onSubmit={add}
          className="grid gap-3 md:grid-cols-[1fr_auto]"
        >

          <Input
            value={name}
            onChange={(e) =>
              setName(e.target.value)
            }
            placeholder="Supplier name"
            required
          />

          <PrimaryButton>
            + Add supplier
          </PrimaryButton>

        </form>

      </Card>

      {items.length === 0 ? (
        <EmptyState
          icon="🚚"
          title="No suppliers yet"
          text="Add your first supplier above."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">

          {items.map((s) => (
            <Card key={s.id}>

              <div className="flex items-start justify-between">

                <div>
                  <h3 className="font-bold">
                    {s.name}
                  </h3>

                  <p className="mt-1 text-sm text-slate-500">
                    {
                      orders.filter(
                        (o) =>
                          o.supplierId ===
                          s.supplierId,
                      ).length
                    }{' '}
                    purchase orders
                  </p>
                </div>

                <span className="rounded-xl bg-slate-100 px-3 py-2 text-lg">
                  🚚
                </span>

              </div>

              <SecondaryButton
                className="mt-5 w-full"
                onClick={() =>
                  void order(s.supplierId)
                }
              >
                Create low-stock draft
              </SecondaryButton>

            </Card>
          ))}

        </div>
      )}

      {orders.length > 0 && (
        <Card>

          <div className="flex items-center justify-between">

            <div>
              <h2 className="font-bold">
                Purchase drafts
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Draft purchase orders generated from low stock.
              </p>
            </div>

            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              {orders.length}
            </span>

          </div>

          <div className="mt-4 space-y-2">

            {orders.map((o) => (
              <div
                className="flex flex-col justify-between gap-2 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center"
                key={o.id}
              >

                <div>
                  <p className="font-semibold">
                    {o.status}
                  </p>

                  <p className="text-xs text-slate-500">
                    {o.items.length} items
                  </p>
                </div>

                <b>
                  {money(o.estimatedTotal)}
                </b>

              </div>
            ))}

          </div>

        </Card>
      )}

    </div>
  )
}

/* =========================================================
   OCR
========================================================= */

function Ocr({
  products,
}: Ctx) {
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!file) return

    setBusy(true)

    try {
      const { createWorker } =
        await import('tesseract.js')

      const worker =
        await createWorker('eng')

      const r = await worker.recognize(file)

      setText(r.data.text)

      await worker.terminate()
    } catch {
      setText(
        'Could not read this image. Please enter the purchase lines manually.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">

      <PageHeader
        eyebrow="SMART TOOLS"
        title="Invoice OCR"
        description="Extract text from supplier invoices and review it before using it."
      />

      <Card>

        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">

          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-2xl">
            📄
          </div>

          <h2 className="mt-4 font-bold">
            Upload supplier invoice
          </h2>

          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
            OCR only creates a review draft. Stock never changes until
            you confirm it.
          </p>

          <input
            className="mx-auto mt-5 block max-w-sm text-sm"
            accept="image/*"
            type="file"
            onChange={(e) =>
              setFile(
                e.target.files?.[0] || null,
              )
            }
          />

          <PrimaryButton
            disabled={!file || busy}
            onClick={run}
            className="mt-5"
          >
            {busy
              ? 'Reading invoice…'
              : 'Extract text'}
          </PrimaryButton>

        </div>

        {text && (
          <div className="mt-5">

            <div className="mb-2 flex items-center justify-between">

              <h3 className="font-bold">
                Extracted text
              </h3>

              <span className="text-xs text-slate-400">
                Review before use
              </span>

            </div>

            <textarea
              className="min-h-56 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
              value={text}
              onChange={(e) =>
                setText(e.target.value)
              }
            />

            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Review product mappings, quantities and prices before creating a purchase.
            </div>

            <p className="mt-2 text-xs text-slate-500">
              {products.length} local products available for matching.
            </p>

          </div>
        )}

      </Card>

    </div>
  )
}

/* =========================================================
   SMALL UI HELPERS
========================================================= */

function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div>

      <p className="text-xs font-bold tracking-[0.16em] text-emerald-700">
        {eyebrow}
      </p>

      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
        {title}
      </h1>

      <p className="mt-2 text-sm text-slate-500">
        {description}
      </p>

    </div>
  )
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: string
  title: string
  text: string
}) {
  return (
    <Card className="py-12 text-center">

      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-2xl">
        {icon}
      </div>

      <h3 className="mt-4 font-bold">
        {title}
      </h3>

      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        {text}
      </p>

    </Card>
  )
}
