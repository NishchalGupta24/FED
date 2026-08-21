# PS-08: The Shopkeeper's Day — Project Plan + AI Build Prompt

## 1. The Plan (lock this in first)

### Product name
**Dukan OS** (or pick your own — "digital khata + shop OS" positioning)

### Core idea
One offline-first web app for a small shopkeeper that handles billing, stock, customer credit (khata), and supplier ordering — built as **independent modules** so each one can be demoed, sold, or spun off separately (this satisfies the mandatory "3+ separable modules" rule).

### The 3 (really 4) separable modules
1. **Khata Engine (Ledger Module)** — customer credit accounts, add/settle transactions, running balance, payment reminders (SMS/WhatsApp link stub). This is the most "sellable" module on its own — many shopkeeper apps are just this.
2. **Catalogue + Inventory Module** — product list, stock levels, low-stock alerts, barcode/manual entry, price management.
3. **Billing + Bill OCR Module** — quick POS-style billing screen that deducts stock automatically, plus OCR to scan supplier/purchase bills (using an OCR API or Tesseract.js) to auto-add stock entries instead of manual typing.
4. **Supplier Ordering + Sales Dashboard Module** — reorder suggestions based on stock thresholds, one-tap supplier order generation (PDF/WhatsApp text), and a sales analytics dashboard (daily/weekly revenue, top items, credit outstanding).

Each module should have its own data boundary (own tables/localStorage namespace + its own API routes) so a judge can see they're decoupled, not just tabs sharing one messy database.

### Tech stack (recommended — offline-first, judge-friendly, fast to build)
- **Frontend:** React + Vite + Tailwind, PWA (service worker) for offline-first
- **Local-first storage:** IndexedDB (via Dexie.js) as source of truth on-device
- **Sync layer:** simple REST API (Node/Express or FastAPI) + a sync queue that pushes local changes when connectivity returns — this is your "low-connectivity sync" story
- **Backend DB:** SQLite (hackathon-scale, zero config) or Postgres if you want to look more "production"
- **OCR:** Tesseract.js in-browser (works offline, no API key needed) — good fallback: Google Cloud Vision API if online and you want higher accuracy
- **Auth:** simple phone-number + PIN login (shopkeepers won't use email/password)
- **Charts:** Recharts for the sales dashboard

### Data model (minimum viable)
- `shops` (id, name, owner_phone)
- `products` (id, shop_id, name, sku, stock_qty, cost_price, sell_price, low_stock_threshold)
- `customers` (id, shop_id, name, phone)
- `khata_transactions` (id, customer_id, type[credit/payment], amount, note, date, synced)
- `bills` (id, shop_id, customer_id?, total, items[json], date, synced)
- `supplier_orders` (id, shop_id, supplier_name, items[json], status, date)
- `sync_queue` (id, table_name, record_id, action, payload, synced_at)

### Build order (so there's always a demoable product)
1. Catalogue + Inventory (needed by everything else)
2. Billing screen (depends on inventory) — get a full "sell an item" flow working end-to-end
3. Khata/Ledger module (credit sales flow from billing)
4. Offline-first + sync queue (retrofit onto the above once core flows work)
5. Bill OCR for supplier purchases
6. Supplier ordering + dashboard (this is your "wow" demo layer at the end)

### Demo narrative for judges
Open app offline → sell an item on credit to a known customer (khata updates) → scan a supplier's paper bill with the camera (OCR restocks inventory automatically) → go back online, watch the sync indicator flush the queue → show the dashboard auto-flagging 3 items as low stock and generating a WhatsApp-ready reorder message. This one flow touches all 4 modules and tells a complete story in under 90 seconds.

---

## 2. The Prompt to give your AI coding tool

Copy everything in the box below into Claude Code (or your tool of choice). It's written so the AI treats your plan as fixed spec, not a suggestion.

```
You are building "Dukan OS" for a hackathon (Problem Statement PS-08: "The Shopkeeper's Day" —
FinTech/Retail Tech). I already have a locked project plan. Follow this plan exactly —
do not redesign the architecture, rename the modules, or substitute a different tech stack
unless I explicitly tell you to. If something in the plan is genuinely unworkable, stop and
ask me before deviating — do not silently change direction.

## Product
A single offline-first web app for small shopkeepers, built as 4 clearly separable modules
(each with its own data boundary and API routes), because the hackathon requires at least
3 modules sellable/acquirable independently:

1. Khata Engine (Ledger Module) — customer credit accounts, add/settle transactions,
   running balance per customer, payment reminder text generation.
2. Catalogue + Inventory Module — product CRUD, stock levels, low-stock alerts,
   price management, manual or barcode entry.
3. Billing + Bill OCR Module — POS-style billing screen that deducts stock on sale,
   plus OCR (Tesseract.js, in-browser, offline-capable) to scan supplier purchase bills
   and auto-create stock-in entries.
4. Supplier Ordering + Sales Dashboard Module — low-stock-triggered reorder suggestions,
   one-tap supplier order generation (exportable as text/PDF for WhatsApp), and an
   analytics dashboard (daily/weekly revenue, top-selling items, total outstanding credit).

## Tech stack — use exactly this
- Frontend: React + Vite + Tailwind CSS, configured as a PWA with a service worker
- Local-first storage: IndexedDB via Dexie.js as the on-device source of truth
- Backend: Node.js + Express REST API
- Backend DB: SQLite
- Sync: a local sync_queue table; queued writes flush to the backend when connectivity
  returns; show a visible sync status indicator in the UI
- OCR: Tesseract.js, running client-side
- Auth: phone number + 4-digit PIN (no email/password flows)
- Charts: Recharts

## Data model — implement exactly this, extend only if a module truly requires it
- shops (id, name, owner_phone)
- products (id, shop_id, name, sku, stock_qty, cost_price, sell_price, low_stock_threshold)
- customers (id, shop_id, name, phone)
- khata_transactions (id, customer_id, type[credit|payment], amount, note, date, synced)
- bills (id, shop_id, customer_id nullable, total, items json, date, synced)
- supplier_orders (id, shop_id, supplier_name, items json, status, date)
- sync_queue (id, table_name, record_id, action, payload, synced_at)

## Build order — build and get each step demoable before moving to the next
1. Catalogue + Inventory module (CRUD + low-stock flag)
2. Billing screen: select products, generate a bill, auto-deduct stock
3. Khata module: allow billing "on credit" to a customer, update running balance,
   settle payments
4. Offline-first + sync queue: retrofit IndexedDB-first writes and the sync flush
   onto the above three modules
5. Bill OCR: scan/upload a supplier bill image, extract line items, create stock-in
   entries for confirmation before committing
6. Supplier ordering + dashboard: reorder suggestions from low-stock products,
   exportable order text, and the analytics dashboard

## Non-negotiables
- Each of the 4 modules must have its own API route prefix and its own frontend section,
  so it's obvious they are separable, not entangled.
- The app must be usable offline for billing, inventory, and khata entry — sync is
  best-effort, not required for core flows.
- Keep the UI simple enough for a non-technical shopkeeper: large buttons, minimal text,
  Hindi/English label toggle is a nice-to-have if time permits but not required.
- Do not add scope beyond these 4 modules unless I ask for it.

Start by scaffolding the project structure and the data model, then implement in the
build order above, confirming with me after each numbered step before moving to the next.
```

---

### A couple of notes before you run this
- If your hackathon requires a specific stack (mobile app, specific backend language, a given cloud provider), swap that into the "Tech stack" section before sending — that's the one part you should tailor.
- The "confirming with me after each step" line is deliberate: it stops the AI from sprinting ahead and building things you haven't reviewed, which is the most common way hackathon builds go off the rails.


### PLANNER
1. Product Goal

Build DukaanSaathi, an offline-first, mobile-first PWA for small Indian retail shops covering:

Customer khata / credit ledger
POS billing
Inventory management
Supplier management and purchase orders
UPI payment initiation
Bill/invoice OCR
Interest calculation
Offline operation with automatic synchronization
Owner/manager/staff access control

The application must remain fully usable for core retail operations when the device has no internet connection.

2. Final Architecture
┌──────────────────────────────────────────────────────────┐
│                    DukaanSaathi PWA                      │
│                                                          │
│ React + TypeScript + Vite + Tailwind + PWA              │
│                                                          │
│ Dashboard │ POS │ Khata │ Inventory │ Suppliers │ OCR   │
└──────────────────────────┬───────────────────────────────┘
                           │
                    Repository Layer
                           │
┌──────────────────────────▼───────────────────────────────┐
│                     Dexie / IndexedDB                    │
│                                                          │
│ customers │ products │ sales │ saleItems                 │
│ ledger    │ stockMovements │ payments │ suppliers        │
│ purchaseOrders │ outbox │ syncMetadata                   │
└──────────────────────────┬───────────────────────────────┘
                           │
                     Sync Engine
                           │
                    Online connection
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    Express API Server                    │
│                                                          │
│ Auth │ Sync │ Customers │ Sales │ Ledger │ Inventory     │
│ Payments │ Suppliers │ Purchase Orders │ OCR             │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                         MongoDB                          │
│                                                          │
│ Entities + Append-only Ledger + Stock Events            │
│ Idempotency + Sync Metadata                              │
└──────────────────────────────────────────────────────────┘
3. Technology Stack
Frontend
React
TypeScript
Vite
Tailwind CSS
React Router
Dexie.js
IndexedDB
qrcode.react
Tesseract.js
UUID generation
PWA/service worker
Backend
Node.js
TypeScript
Express
Mongoose
MongoDB
MongoDB transactions
Tesseract.js
JWT authentication
bcrypt/Argon2 password hashing
Scheduled interest worker
Testing
Vitest/Jest
Supertest
MongoDB Memory Server
React Testing Library
Playwright for critical offline/online flows
4. Project Structure
dukaansaathi/
│
├── client/
│   ├── public/
│   │   ├── icons/
│   │   └── manifest.webmanifest
│   │
│   └── src/
│       ├── components/
│       ├── pages/
│       │   ├── auth/
│       │   ├── dashboard/
│       │   ├── pos/
│       │   ├── khata/
│       │   ├── inventory/
│       │   ├── suppliers/
│       │   ├── purchases/
│       │   ├── payments/
│       │   └── ocr/
│       │
│       ├── db/
│       │   ├── localDb.ts
│       │   ├── repositories/
│       │   └── migrations.ts
│       │
│       ├── sync/
│       │   ├── syncEngine.ts
│       │   ├── outbox.ts
│       │   └── conflictResolver.ts
│       │
│       ├── services/
│       ├── hooks/
│       ├── utils/
│       ├── types/
│       └── App.tsx
│
├── server/
│   └── src/
│       ├── server.ts
│       ├── app.ts
│       ├── config/
│       ├── middleware/
│       ├── models/
│       ├── routes/
│       ├── controllers/
│       ├── services/
│       │   ├── sync.service.ts
│       │   ├── ledger.service.ts
│       │   ├── inventory.service.ts
│       │   ├── interest.service.ts
│       │   ├── payment.service.ts
│       │   └── ocr.service.ts
│       └── tests/
│
├── shared/
│   └── types/
│
├── package.json
└── README.md
5. Data Identity Strategy

Every syncable object gets a client-generated UUID.

For example:

customerId
productId
saleId
paymentId
supplierId
purchaseOrderId
transactionId

MongoDB may additionally maintain its normal _id.

Important distinction
entityId
    Identity of the business object


transactionId
    Idempotency key for the business operation


syncEventId
    Individual synchronization event

The server must never create a duplicate business operation simply because the same offline event was retried.

6. MongoDB Data Models
User
id
shopId
name
phone
email
passwordHash
role
createdAt
updatedAt

Roles:

OWNER
MANAGER
STAFF
Shop
shopId
name
phone
address
upiId
payeeName


interestSettings:
  enabled
  rate
  ratePeriod
  gracePeriod


createdAt
updatedAt

ratePeriod:

DAILY
WEEKLY
MONTHLY
YEARLY
Customer
customerId
shopId
name
phone
email
address
openingBalance
creditLimit
interestEnabled
interestRate
interestType
gracePeriod
notes
lastTransactionDate
createdAt
updatedAt

Do not treat outstandingBalance as the financial source of truth.

It may exist as a cached projection.

7. Append-Only Ledger
LedgerTransaction
transactionId
shopId
customerId


type:
  SALE
  PAYMENT
  INTEREST
  REFUND
  ADJUSTMENT


direction:
  DEBIT
  CREDIT


amount
referenceId
description
createdAt

Rules:

Ledger entries cannot be edited.
Ledger entries cannot be physically deleted.
Corrections create new transactions.
Sale on credit → DEBIT
Customer payment → CREDIT
Interest → DEBIT
Refund → appropriate compensating entry

Customer balance is calculated from ledger events.

8. Inventory
Product
productId
shopId
name
sku
barcode
category
brand
unit
purchasePrice
sellingPrice
minimumStock
supplierId
description
image
createdAt
updatedAt
StockMovement
transactionId
productId
shopId
quantity


type:
  SALE
  PURCHASE
  ADJUSTMENT
  OCR_IMPORT


direction:
  IN
  OUT


referenceId
notes
createdAt

currentStock should be treated as a projection/cache.

The authoritative inventory history is StockMovement.

9. Sales

Separate sale and sale items.

Sale
saleId
shopId
customerId?
items[]
subtotal
discount
tax
total
paymentMethod
paymentStatus
transactionId
createdAt
SaleItem
saleItemId
saleId
productId
quantity
price
purchasePrice

A finalized credit sale produces:

Sale
   │
   ├── SaleItems
   │
   ├── StockMovement OUT
   │
   └── LedgerTransaction DEBIT

These operations must be atomic on the server.

10. Payments
paymentId
shopId
saleId?
customerId?
ledgerTransactionId?


amount


status:
  PENDING
  SUCCESS
  FAILED
  EXPIRED
  CANCELLED


provider
transactionReference
transactionId
verifiedAt
createdAt
updatedAt

Payment state transitions must be idempotent.

Repeated payment callbacks must not create repeated ledger credits.

11. Suppliers and Purchase Orders
Supplier
supplierId
shopId
name
phone
email
address
gstNumber
paymentTerms
notes
createdAt
updatedAt
PurchaseOrder
purchaseOrderId
shopId
supplierId
items[]
estimatedTotal


status:
  DRAFT
  SENT
  CONFIRMED
  PARTIALLY_RECEIVED
  RECEIVED
  CANCELLED


transactionId
createdAt
updatedAt

Receiving inventory creates StockMovement(IN) events.

12. Dexie Offline Database

The client database will contain:

customers
products
sales
saleItems
ledgerTransactions
stockMovements
payments
suppliers
purchaseOrders
outbox
syncMetadata

The UI reads from Dexie first.

The network is never required to render core shop data.

13. Outbox / Sync Queue
interface SyncQueueItem {
  id?: number;
  syncEventId: string;
  transactionId: string;
  entityId: string;


  action: SyncAction;


  endpoint: string;
  method: "POST" | "PUT";


  payload: unknown;


  createdAt: Date;


  syncStatus:
    | "PENDING"
    | "SYNCING"
    | "FAILED";


  attempts: number;
  error?: string;
}
Sync process
Local operation
      ↓
Write entity to Dexie
      ↓
Write outbox event
      ↓
UI updates immediately
      ↓
Internet becomes available
      ↓
Sync engine starts
      ↓
Push pending events
      ↓
Server verifies idempotency
      ↓
Server commits transaction
      ↓
Client marks event synced
      ↓
Client pulls remote changes
14. Sync Rules
Idempotency

Every mutation has a unique transactionId.

The server checks:

Does transactionId already exist?
        │
   ┌────┴────┐
   │         │
  YES        NO
   │         │
Return       Process
existing     operation
result
Conflict strategy

Do not use generic last-write-wins for financial records.

Data	Strategy
Ledger	Append-only
Stock	Append-only movements
Sales	Immutable after finalization
Payments	Idempotent state transitions
Customer metadata	Version/LWW
Product metadata	Version/LWW
Deletes	Tombstones
15. Server Transaction Boundary

A credit sale should execute approximately:

BEGIN TRANSACTION


Create Sale
Create SaleItems
Create StockMovement OUT
Create LedgerTransaction DEBIT
Update inventory projection


COMMIT

If any operation fails:

ROLLBACK

This prevents situations such as:

Sale exists
but stock wasn't reduced

or:

Customer was charged
but sale wasn't recorded
16. Interest Engine

Interest will run through a scheduled server job.

The system should calculate interest from ledger balances rather than blindly modifying a customer balance.

Example
Outstanding principal
        ↓
Determine eligible balance period
        ↓
Apply grace period
        ↓
Calculate interest
        ↓
Check whether period was already charged
        ↓
Create INTEREST ledger transaction

Formula:

Interest =
Principal × (Rate / 100) × TimeFactor

The exact TimeFactor depends on the configured rate period.

Idempotency

Create a unique interest-period key such as:

customerId + interestPeriodStart + interestPeriodEnd

The same period must never be charged twice.

17. POS

The POS screen will support:

Product search
Barcode scanning
Cart
Quantity editing
Discount
Tax
Cash payment
UPI payment
Credit sale
Customer selection
Stock validation
Receipt generation
Offline behavior

The POS must work with:

Internet OFF

including:

Product lookup
Cart
Sale creation
Credit sale
Cash payment
Local receipt

The transaction is synchronized later.

18. Khata

The Khata module will provide:

Customer list
Outstanding balance
Customer transaction history
Credit sale
Payment recording
Interest history
Search/filter
Payment reminder action
Customer statement

Ledger display:

Date | Description | Debit | Credit | Balance

Balance is derived from ledger entries.

19. UPI Workflow

For a shop configured with:

upiId
payeeName

generate:

upi://pay?
pa={upiId}
&pn={payeeName}
&am={amount}
&tn={reference}
&tr={transactionId}

The application provides:

QR code
Mobile UPI intent button
Payment reference
Demo verification panel
Demo mode
PENDING
   │
   ├── SUCCESS
   │
   └── FAILED

The demo must clearly be treated as simulated verification.

Production payment verification should be implemented behind a payment-provider/webhook abstraction.

20. OCR Workflow
Invoice image
      ↓
Upload
      ↓
OCR processing
      ↓
Raw text
      ↓
Line/item extraction
      ↓
Product fuzzy matching
      ↓
Draft purchase
      ↓
Human verification
      ↓
Confirm
      ↓
Purchase + StockMovement(IN)

OCR must never automatically modify inventory without confirmation.

The verification screen allows:

Quantity correction
Price correction
Product mapping
New product creation
Removing incorrect OCR rows
21. Authentication

Implement:

Registration
Login
JWT access token
Password hashing
Shop isolation
Role-based authorization
Permissions
Feature	Owner	Manager	Staff
Dashboard	✓	✓	✓
POS	✓	✓	✓
Khata	✓	✓	✓
Inventory	✓	✓	✓
Suppliers	✓	✓	Limited
Interest settings	✓	Limited	—
Staff management	✓	—	—
Shop settings	✓	—	—

Every server query must enforce shopId.

22. Demo Account

Provide a seeded demo environment:

Shop:
Saathi Kirana Store


Role:
OWNER


Email:
demo@dukaansaathi.in


Password:
Password123

The account should only be automatically seeded in development/demo mode.

Production deployments should require explicit credentials/configuration.

23. API Structure
/api/auth
/api/shops
/api/customers
/api/products
/api/sales
/api/ledger
/api/inventory
/api/payments
/api/suppliers
/api/purchase-orders
/api/ocr
/api/sync
Important sync endpoints
POST /api/sync/push
GET  /api/sync/pull

push accepts batches of idempotent events.

pull uses a cursor/version so the client can retrieve only changes since its last successful synchronization.

24. Sync Cursor

Dexie maintains:

syncMetadata
  lastServerCursor
  lastSuccessfulSync

Pull:

GET /api/sync/pull?cursor=12345

Server responds with:

changes[]
nextCursor

The client updates its cursor only after successfully committing the downloaded changes locally.

25. PWA Requirements

The PWA will include:

Installable app
Service worker
App shell caching
Offline fallback
IndexedDB persistence
Online/offline indicator
Automatic synchronization
Retry with exponential backoff
Sync status indicator

Example UI:

● Offline
3 changes waiting to sync

and:

✓ Synced just now
26. Dashboard

The dashboard should prioritize information useful to a shopkeeper:

Today's Sales
₹12,450


Outstanding Khata
₹48,200


Low Stock
7 items


Pending Payments
4


Pending Supplier Orders
2

Quick actions:

+ New Sale
+ Add Customer
+ Record Payment
+ Add Product
Scan Bill
27. Security

Implement:

Password hashing
JWT authentication
Request validation
Rate limiting
CORS configuration
Helmet/security headers
Shop-level authorization
Input sanitization
Maximum OCR upload size
File-type validation
No sensitive credentials in frontend code
Environment-based secrets
28. Error Handling

Every mutation should return structured errors.

Example:

{
  success: false,
  error: {
    code: "INSUFFICIENT_STOCK",
    message: "Not enough stock available"
  }
}

Offline failures remain in the outbox and are retried.

Permanent failures are marked:

FAILED

and shown to the user for resolution.

29. Testing Strategy
Unit Tests
Ledger
Debit increases outstanding
Payment decreases outstanding
Refund reverses appropriate amount
Interest adds debit
Opening balance is handled correctly
Inventory
Purchase increases stock
Sale decreases stock
Adjustment works
Stock projection matches movement history
Sync
Duplicate transaction is ignored
Retry is safe
Failed request remains queued
Successful request is removed/marked synced
Pull cursor advances correctly
Payments
Duplicate callback is safe
Invalid state transition is rejected
Successful payment produces correct ledger effect
Interest
Grace period works
Correct period calculation
Duplicate job execution does not duplicate interest
30. Integration Tests

Test complete workflows:

Credit Sale
Create customer
     ↓
Create sale
     ↓
Stock decreases
     ↓
Ledger debit created
     ↓
Customer balance updated
Payment
Create payment
     ↓
Payment succeeds
     ↓
Ledger credit created
     ↓
Outstanding decreases
Offline Sale
Disable network
     ↓
Create sale
     ↓
Verify Dexie
     ↓
Restore network
     ↓
Sync
     ↓
Verify MongoDB
     ↓
Verify no duplicate records
31. End-to-End Tests

Use Playwright for:

Login
Dashboard
Create customer
Create product
Make cash sale
Make credit sale
Record customer payment
Go offline
Make offline sale
Return online
Verify synchronization
Scan/import OCR bill
Verify OCR result
Create purchase
Verify stock
32. Development Database

Use:

mongodb-memory-server

for:

Automated tests
Demo mode
Local development when explicitly enabled

For normal persistent development:

MongoDB local instance or configured MongoDB deployment

Never silently use an ephemeral database where the user expects persistent data.

33. Implementation Phases
Phase 1 — Foundation
Monorepo setup
React/Vite
Express
TypeScript
Tailwind
MongoDB/Mongoose
Environment configuration
Shared types
Basic authentication
Shop/user models
Phase 2 — Offline Database
Dexie schema
Repository layer
UUID identity
Local migrations
Online/offline detection
Outbox
Phase 3 — Sync Engine
Push API
Pull API
Sync cursor
Idempotency
Retry handling
Conflict resolution
Sync status UI
Phase 4 — Customers & Khata
Customer CRUD
Ledger
Credit transactions
Payments
Balance projection
Customer statements
Phase 5 — Inventory
Products
Categories
Barcode
Stock movements
Low-stock alerts
Inventory dashboard
Phase 6 — POS
Product search
Cart
Checkout
Cash
Credit
Receipt
Atomic sale processing
Phase 7 — UPI
UPI deep links
QR generation
Payment records
Demo verification
Payment/ledger reconciliation
Phase 8 — Suppliers
Supplier CRUD
Purchase orders
Receiving
Stock-in
Supplier history
Phase 9 — OCR
Image upload
Tesseract processing
Item extraction
Fuzzy matching
Verification interface
Purchase creation
Phase 10 — Interest
Interest configuration
Scheduled worker
Grace periods
Period calculations
Duplicate prevention
Interest ledger entries
Phase 11 — Hardening
Security
Error handling
Database indexes
Performance
Offline recovery
Data migration
Comprehensive tests
Phase 12 — PWA Release
Service worker
Manifest
Install experience
Production build
Deployment configuration
Monitoring/logging
Production documentation
34. Required Database Indexes

At minimum:

User:
  phone
  shopId


Customer:
  shopId
  phone
  customerId


Product:
  shopId + sku
  shopId + barcode
  productId


LedgerTransaction:
  shopId + customerId + createdAt
  transactionId


StockMovement:
  shopId + productId + createdAt
  transactionId


Sale:
  shopId + createdAt
  transactionId


Payment:
  paymentId
  transactionId
  shopId + customerId


Supplier:
  shopId + supplierId


PurchaseOrder:
  shopId + supplierId
  transactionId

Unique constraints should be carefully scoped by shopId where appropriate.

35. Definition of Done

The implementation is considered complete when:

 User can register/login
 Demo account works
 Shop isolation is enforced
 Customer khata works offline
 POS works offline
 Inventory works offline
 Sales generate correct stock movements
 Credit sales generate ledger debits
 Payments generate ledger credits
 Duplicate sync events are harmless
 Offline data automatically syncs
 Sync retries after failures
 Interest is calculated without duplicate charges
 UPI QR/deep-link workflow works
 Demo payment verification works
 Supplier purchase orders work
 OCR extracts invoice data
 OCR requires user verification before stock changes
 PWA installs successfully
 Core application works with network disabled
 Automated tests pass
 End-to-end offline/online test passes
 Production configuration does not use ephemeral MongoDB
Final Architecture Decision

The final implementation should follow event-oriented accounting with local-first projections:

                  AUTHORITATIVE
                       │
          ┌────────────┴────────────┐
          │                         │
     Ledger Events             Stock Events
          │                         │
          ▼                         ▼
   Balance Projection         Stock Projection
          │                         │
          └────────────┬────────────┘
                       │
                Application UI
                       ▲
                       │
                 Dexie / IndexedDB
                       │
                    Outbox
                       │
                 Sync Engine
                       │
                    Server
                       │
                    MongoDB

This gives DukaanSaathi the most important property for a retail application: the shopkeeper can continue selling and maintaining khata/inventory without internet, while synchronization remains idempotent and financial records remain auditable and recoverable.