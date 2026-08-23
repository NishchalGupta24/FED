import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import { env } from './config/env.js'
import { requireAuth, requireRole } from './middleware/auth.js'
import { CustomerModel, LedgerTransactionModel, PaymentModel, ProductModel, PurchaseOrderModel, SaleModel, ShopModel, StockMovementModel, SupplierModel, SyncEventModel, UserModel } from './models/models.js'

const app = express()
app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '2mb' })); app.use(rateLimit({ windowMs: 60_000, limit: 120 }))
const fail = (res: express.Response, status: number, code: string, message: string) => res.status(status).json({ success: false, error: { code, message } })
const session = (u: any) => ({ token: jwt.sign({ userId: u.userId || String(u._id), shopId: u.shopId, role: u.role, name: u.name }, env.jwtSecret, { expiresIn: '7d' }), userId: u.userId || String(u._id), shopId: u.shopId, role: u.role, name: u.name || 'Shop user' })

export async function seedDemo() {
  if (env.nodeEnv === 'production' || process.env.SEED_DEMO === 'false' || await UserModel.exists({ email: 'demo@dukaansaathi.in' })) return
  const shopId = 'demo-saathi-kirana-store'
  await ShopModel.updateOne({ shopId }, { $setOnInsert: { shopId, name: 'Saathi Kirana Store', phone: '9876543210', upiId: 'saathikirana@upi', payeeName: 'Saathi Kirana Store' } }, { upsert: true })
  await UserModel.create({ userId: 'demo-owner', shopId, name: 'Demo Owner', phone: '9876543210', email: 'demo@dukaansaathi.in', passwordHash: await bcrypt.hash('Password123', 12), role: 'OWNER' })
}

app.get('/api/health', (_req, res) => res.json({ success: true, data: { service: 'dukaansaathi-api', status: 'ok' } }))
app.post('/api/auth/register', async (req, res) => { const { name, phone, email, password, pin, shopName } = req.body, credential = password || pin; if (!name || !phone || !credential || String(credential).length < 4) return fail(res, 400, 'INVALID_INPUT', 'Name, phone and a password of at least 4 characters are required'); if (email && await UserModel.exists({ email })) return fail(res, 409, 'ALREADY_EXISTS', 'An account with this email already exists'); const shopId = randomUUID(), user = await UserModel.create({ userId: randomUUID(), shopId, name, phone, email, passwordHash: await bcrypt.hash(credential, 12), role: 'OWNER' }); await ShopModel.create({ shopId, name: shopName || 'My Kirana Store', phone }); return res.status(201).json({ success: true, data: session(user) }) })
app.post('/api/auth/login', async (req, res) => { const user = await UserModel.findOne(req.body.email ? { email: req.body.email } : { phone: req.body.phone }); if (!user || !(await bcrypt.compare(req.body.password || req.body.pin || '', user.passwordHash || ''))) return fail(res, 401, 'INVALID_CREDENTIALS', 'Email/phone or password is incorrect'); res.json({ success: true, data: session(user) }) })

app.use('/api/customers', requireAuth); app.use('/api/products', requireAuth); app.use('/api/ledger', requireAuth); app.use('/api/inventory', requireAuth); app.use('/api/suppliers', requireAuth); app.use('/api/purchase-orders', requireAuth); app.use('/api/sales', requireAuth); app.use('/api/payments', requireAuth); app.use('/api/ocr', requireAuth); app.use('/api/sync', requireAuth); app.use('/api/notifications', requireAuth)
const scope = (req: express.Request) => ({ shopId: req.user!.shopId })
app.get('/api/customers', async (req, res) => res.json({ success: true, data: await CustomerModel.find(scope(req)) }))
app.post('/api/customers', async (req, res) => res.status(201).json({ success: true, data: await CustomerModel.findOneAndUpdate({ ...scope(req), customerId: req.body.customerId || randomUUID() }, { ...req.body, ...scope(req) }, { new: true, upsert: true, setDefaultsOnInsert: true }) }))
app.get('/api/products', async (req, res) => res.json({ success: true, data: await ProductModel.find(scope(req)) }))
app.post('/api/products', async (req, res) => res.status(201).json({ success: true, data: await ProductModel.findOneAndUpdate({ ...scope(req), productId: req.body.productId || randomUUID() }, { ...req.body, ...scope(req) }, { new: true, upsert: true, setDefaultsOnInsert: true }) }))
app.get('/api/suppliers', async (req, res) => res.json({ success: true, data: await SupplierModel.find(scope(req)) }))
app.post('/api/suppliers', async (req, res) => res.status(201).json({ success: true, data: await SupplierModel.findOneAndUpdate({ ...scope(req), supplierId: req.body.supplierId || randomUUID() }, { ...req.body, ...scope(req) }, { new: true, upsert: true }) }))
app.get('/api/ledger/:customerId', async (req, res) => res.json({ success: true, data: await LedgerTransactionModel.find({ ...scope(req), customerId: req.params.customerId }).sort({ createdAt: 1 }) }))

async function createSale(shopId: string, payload: any) {
  const transactionId = payload.transactionId || randomUUID(); if (await SyncEventModel.exists({ transactionId })) return { duplicate: true, transactionId }
  const items = payload.items || []; for (const i of items) { const product = await ProductModel.findOne({ shopId, productId: i.productId }); if (!product || product.currentStock < i.quantity) throw Object.assign(new Error(`Not enough stock for ${i.productId}`), { code: 'INSUFFICIENT_STOCK' }) }
  const saleId = payload.saleId || randomUUID(); await SaleModel.create({ ...payload, saleId, shopId, transactionId })
  for (const i of items) { await StockMovementModel.create({ transactionId: `${transactionId}:${i.productId}`, shopId, productId: i.productId, quantity: i.quantity, type: 'SALE', direction: 'OUT', referenceId: saleId }); await ProductModel.updateOne({ shopId, productId: i.productId }, { $inc: { currentStock: -i.quantity } }) }
  if (payload.customerId) await LedgerTransactionModel.create({ transactionId: `${transactionId}:ledger`, shopId, customerId: payload.customerId, type: 'SALE', direction: 'DEBIT', amount: payload.total, referenceId: saleId, description: 'Credit sale' })
  await SyncEventModel.create({ transactionId, entityId: saleId, shopId, payload: { ...payload, saleId }, endpoint: '/api/sales' }); return { transactionId, saleId }
}
app.post('/api/sales', async (req, res) => { try { res.status(201).json({ success: true, data: await createSale(req.user!.shopId, req.body) }) } catch (e) { fail(res, 400, (e as any).code || 'SALE_FAILED', (e as Error).message) } })
app.post('/api/payments', requireRole('OWNER', 'MANAGER', 'STAFF'), async (req, res) => { const transactionId = req.body.transactionId || randomUUID(), shopId = req.user!.shopId, existing = await PaymentModel.findOne({ transactionId }); if (existing) return res.json({ success: true, data: existing }); const payment = await PaymentModel.create({ ...req.body, shopId, paymentId: req.body.paymentId || randomUUID(), transactionId, status: req.body.status || 'SUCCESS', verifiedAt: new Date() }); if (payment.status === 'SUCCESS' && payment.customerId) await LedgerTransactionModel.create({ transactionId: `${transactionId}:ledger`, shopId, customerId: payment.customerId, type: 'PAYMENT', direction: 'CREDIT', amount: payment.amount, referenceId: payment.paymentId, description: 'Customer payment' }); res.status(201).json({ success: true, data: payment }) })
type NotificationChannel = 'sms' | 'whatsapp' | 'both'
const asE164 = (phone: string) => {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 10 ? `+91${digits}` : phone.trim().startsWith('+') ? `+${digits}` : `+${digits}`
}
async function sendTextbeeMessage(phone: string, message: string) {
  const response = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
    method: 'POST',
    headers: {
      'x-api-key': env.textbeeApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipients: [phone], message }),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`TextBee request failed (${response.status}): ${body}`)
  return body
}
app.post('/api/notifications/send', requireRole('OWNER', 'MANAGER', 'STAFF'), async (req, res) => {
  const { phone, message, channel = 'both' } = req.body as { phone?: string; message?: string; channel?: NotificationChannel }
  if (!phone || !message || !['sms', 'whatsapp', 'both'].includes(channel || '')) return fail(res, 400, 'INVALID_INPUT', 'Phone, message and a valid channel are required')
  if (channel !== 'sms') return fail(res, 400, 'WHATSAPP_NOT_SUPPORTED', 'TextBee supports SMS only; use channel "sms"')
  if (!env.textbeeApiKey) return fail(res, 503, 'MESSAGING_NOT_CONFIGURED', 'TextBee messaging is not configured')
  const normalizedPhone = asE164(phone)
  try {
    const providerResponse = await sendTextbeeMessage(normalizedPhone, message)
    console.log(`[notifications] TextBee accepted SMS for ${normalizedPhone}: ${providerResponse}`)
    res.json({ success: true, data: { phone: normalizedPhone, channels: ['sms'] } })
  } catch (error) {
    fail(res, 502, 'MESSAGE_SEND_FAILED', (error as Error).message)
  }
})
app.get('/api/purchase-orders', async (req, res) => res.json({ success: true, data: await PurchaseOrderModel.find(scope(req)) }))
app.post('/api/purchase-orders', async (req, res) => res.status(201).json({ success: true, data: await PurchaseOrderModel.create({ ...req.body, ...scope(req), purchaseOrderId: req.body.purchaseOrderId || randomUUID(), transactionId: req.body.transactionId || randomUUID() }) }))
app.post('/api/ocr', async (_req, res) => res.json({ success: true, data: { status: 'REQUIRES_VERIFICATION', message: 'OCR draft created; inventory was not changed' } }))
async function applySyncEvent(shopId: string, event: any) {
  if (event.endpoint === '/api/sales') return createSale(shopId, event.payload)
  const payload = { ...event.payload, shopId }
  if (event.endpoint === '/api/customers') await CustomerModel.findOneAndUpdate({ shopId, customerId: payload.customerId }, payload, { upsert: true })
  else if (event.endpoint === '/api/products') await ProductModel.findOneAndUpdate({ shopId, productId: payload.productId }, payload, { upsert: true })
  else if (event.endpoint === '/api/suppliers') await SupplierModel.findOneAndUpdate({ shopId, supplierId: payload.supplierId }, payload, { upsert: true })
  else if (event.endpoint === '/api/purchase-orders') await PurchaseOrderModel.findOneAndUpdate({ shopId, purchaseOrderId: payload.purchaseOrderId }, payload, { upsert: true })
  else if (event.endpoint === '/api/payments') { await PaymentModel.create(payload); if (payload.customerId && payload.status === 'SUCCESS') await LedgerTransactionModel.create({ transactionId: `${event.transactionId}:ledger`, shopId, customerId: payload.customerId, type: 'PAYMENT', direction: 'CREDIT', amount: payload.amount, referenceId: payload.paymentId, description: 'Customer payment' }) }
  await SyncEventModel.create({ transactionId: event.transactionId, entityId: event.entityId, shopId, payload: event.payload, endpoint: event.endpoint })
}
app.post('/api/sync/push', async (req, res) => { const results = []; for (const event of req.body.events || []) { try { if (await SyncEventModel.exists({ transactionId: event.transactionId })) { results.push({ transactionId: event.transactionId, status: 'duplicate' }); continue } await applySyncEvent(req.user!.shopId, event); results.push({ transactionId: event.transactionId, status: 'processed' }) } catch (e) { results.push({ transactionId: event.transactionId, status: 'failed', error: (e as Error).message }) } } res.json({ success: true, data: results }) })
app.get('/api/sync/pull', async (req, res) => { const cursor = Number(req.query.cursor || 0), changes = await SyncEventModel.find(scope(req)).sort({ createdAt: 1 }).skip(cursor).limit(100); res.json({ success: true, data: { changes, nextCursor: cursor + changes.length } }) })
export default app
