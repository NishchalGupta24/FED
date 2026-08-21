import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../app.js'

describe('DukaanSaathi API', () => {
  it('reports health without a database connection', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body.data.status).toBe('ok')
  })
  it('rejects registration without a four digit PIN', async () => {
    const response = await request(app).post('/api/auth/register').send({ name: 'Test Shop', phone: '9999999999', pin: '123' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_INPUT')
  })
})
