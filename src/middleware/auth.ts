/**
 * Authentication Middleware
 *
 * Verifies Firebase ID tokens sent from the frontend.
 *
 * Flow:
 *   Frontend sends:  Authorization: Bearer <firebase_id_token>
 *   Middleware:      Verifies token with Firebase Admin SDK
 *   If valid:        Attaches { uid, email, userId, isAdmin } to req.user
 *   If invalid:      Returns 401 Unauthorized
 *
 * The Firebase token proves identity. We then look up the Supabase
 * user to get the role and admin status.
 */
import type { Request, Response, NextFunction } from 'express'
import { verifyIdToken } from '../lib/firebase.js'
import { getUserByFirebaseUid } from '../lib/supabase.js'

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Let CORS preflight requests pass through without auth.
    if (req.method === 'OPTIONS') {
      next()
      return
    }

    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'No authentication token provided.' })
      return
    }

    const token = authHeader.split('Bearer ')[1]

    if (!token) {
      res.status(401).json({ success: false, error: 'Invalid authorization format.' })
      return
    }

    // Verify with Firebase Admin SDK
    const decoded = await verifyIdToken(token)

    // Look up Supabase user for role and admin status
    const dbUser = await getUserByFirebaseUid(decoded.uid)

    if (!dbUser) {
      res.status(403).json({
        success: false,
        error: 'User profile not found. Please re-register.',
      })
      return
    }

    // Attach to request for downstream middleware/routes
    ;(req as Request & { user: unknown }).user = {
      uid: decoded.uid,
      email: decoded.email,
      userId: dbUser.id,
      isAdmin: dbUser.is_admin === true,
    }

    next()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token verification failed'

    // Map Firebase error codes to friendly messages
    if (message.includes('expired')) {
      res.status(401).json({ success: false, error: 'Session expired. Please sign in again.' })
    } else if (message.includes('invalid-argument') || message.includes('malformed')) {
      res.status(401).json({ success: false, error: 'Invalid token.' })
    } else {
      console.error('Auth middleware error:', err)
      res.status(401).json({ success: false, error: 'Authentication failed.' })
    }
  }
}

/**
 * Admin-only middleware.
 * Must be used AFTER requireAuth.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = (req as Request & { user?: { isAdmin?: boolean } }).user

  if (!user?.isAdmin) {
    res.status(403).json({
      success: false,
      error: 'Admin access required.',
    })
    return
  }

  next()
}
