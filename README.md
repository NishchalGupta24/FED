# DukaanSaathi

DukaanSaathi is an offline-first shop operating system for small Indian retailers. The product is split into four independently demonstrable modules: Khata Ledger, Catalogue + Inventory, Billing + OCR, and Suppliers + Dashboard.

## Run the frontend

```bash
npm install
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`.

## Run the API

The API requires a running MongoDB instance. Configure `MONGO_URI`, `JWT_SECRET`, and optionally `PORT` in the environment.

```bash
npm run server
```

The API exposes `/api/auth`, `/api/customers`, `/api/products`, `/api/sales`, `/api/ledger`, `/api/inventory`, `/api/payments`, `/api/suppliers`, `/api/purchase-orders`, `/api/ocr`, and `/api/sync`.

## Validate

```bash
npm run build
npm run server:build
npm test
```

## Architecture

The browser owns the local-first experience through Dexie tables and an outbox. Mutations carry UUID identities and transaction IDs. The sync engine pushes pending events to the Express API, where MongoDB records idempotency events and shop-scoped domain data. Financial records are represented as append-only ledger or stock movement events.

The current UI demo uses local browser data and is usable without a network. To connect it to the API, provide a login token and call `flushOutbox(token)` from `src/sync/syncEngine.ts` after authentication.
