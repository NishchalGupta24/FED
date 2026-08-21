import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

declare global { namespace Express { interface Request { user?: { userId: string; shopId: string; role: 'OWNER' | 'MANAGER' | 'STAFF' } } } }
export function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.headers.authorization?.replace('Bearer ', '')
  if (!token) return response.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Login required' } })
  try { request.user = jwt.verify(token, env.jwtSecret) as Express.Request['user']; next() } catch { return response.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Session expired' } }) }
}
export function requireRole(...roles: Array<'OWNER' | 'MANAGER' | 'STAFF'>) {
  return (request: Request, response: Response, next: NextFunction) => roles.includes(request.user?.role || 'STAFF')
    ? next()
    : response.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } })
}
