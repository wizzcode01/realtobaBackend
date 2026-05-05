/**
 * Auth Routes
 *
 * POST /api/auth/send-verification     — send verification email after registration
 * GET  /api/auth/verify-email?token=   — verify the token from the email link
 * POST /api/auth/switch-role           — switch role (with rules)
 * GET  /api/auth/nysc-status           — check NYSC year completion
 * POST /api/auth/resend-verification   — resend verification email
 */
import { Router } from 'express'
import { body, query } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { sendVerificationEmail, sendRoleSwitchEmail, sendNYSCCompletionEmail } from '../lib/mailer.js'
import crypto from 'crypto'

const router = Router()

// ── Generate a secure 6-digit OTP and store it in DB ──
function generateToken(): string {
  return crypto.randomInt(100000, 999999).toString()
}

// ─────────────────────────────────────────────
// POST /api/auth/send-verification
// Called right after user registers — sends the email
// ─────────────────────────────────────────────
router.post(
  '/send-verification',
  requireAuth,
  async (req: any, res: any): Promise<void> => {
    try {
      const { userId } = req.user

      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('id, name, email, email_verified')
        .eq('id', userId)
        .single()

      if (error || !user) { res.status(404).json({ success: false, error: 'User not found' }); return }
      if ((user as any).email_verified) { res.json({ success: true, message: 'Email already verified' }); return }

      const token = generateToken()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      // Store token in DB
      await supabaseAdmin.from('email_verifications').upsert({
        user_id: userId,
        token,
        expires_at: expiresAt,
        used: false,
      }, { onConflict: 'user_id' })

      await sendVerificationEmail((user as any).email, (user as any).name, token)

      res.json({ success: true, message: 'Verification email sent' })
    } catch (err) {
      console.error('send-verification:', err)
      res.status(500).json({ success: false, error: 'Failed to send verification email' })
    }
  },
)

// ─────────────────────────────────────────────
// POST /api/auth/verify-email
// User submits the 6-digit code from their email
// ─────────────────────────────────────────────
router.post(
  '/verify-email',
  requireAuth,
  [body('token').notEmpty().isLength({ min: 6, max: 6 })],
  validate,
  async (req: any, res: any): Promise<void> => {
    try {
      const { userId } = req.user
      const { token } = req.body

      const { data: record } = await supabaseAdmin
        .from('email_verifications')
        .select('*')
        .eq('user_id', userId)
        .eq('token', token)
        .eq('used', false)
        .single()

      if (!record) { res.status(400).json({ success: false, error: 'Invalid or expired code' }); return }

      const expiry = record as any
      if (new Date(expiry.expires_at) < new Date()) {
        res.status(400).json({ success: false, error: 'Code has expired. Please request a new one.' })
        return
      }

      // Mark verified
      await Promise.all([
        supabaseAdmin.from('users').update({ email_verified: true }).eq('id', userId),
        supabaseAdmin.from('email_verifications').update({ used: true }).eq('user_id', userId),
      ])

      res.json({ success: true, message: 'Email verified successfully' })
    } catch (err) {
      console.error('verify-email:', err)
      res.status(500).json({ success: false, error: 'Verification failed' })
    }
  },
)

// ─────────────────────────────────────────────
// POST /api/auth/resend-verification
// ─────────────────────────────────────────────
router.post(
  '/resend-verification',
  requireAuth,
  async (req: any, res: any): Promise<void> => {
    try {
      const { userId } = req.user
      const { data: user } = await supabaseAdmin
        .from('users').select('name, email, email_verified').eq('id', userId).single()

      if (!user || (user as any).email_verified) {
        res.json({ success: true, message: 'Already verified' }); return
      }

      // Rate limit: max 1 resend per 5 minutes
      const { data: existing } = await supabaseAdmin
        .from('email_verifications')
        .select('created_at').eq('user_id', userId).single()

      if (existing) {
        const created = new Date((existing as any).created_at)
        const minsSince = (Date.now() - created.getTime()) / 60000
        if (minsSince < 5) {
          res.status(429).json({
            success: false,
            error: `Please wait ${Math.ceil(5 - minsSince)} more minute(s) before requesting a new code`,
          })
          return
        }
      }

      const token = generateToken()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      await supabaseAdmin.from('email_verifications').upsert({
        user_id: userId, token, expires_at: expiresAt, used: false,
      }, { onConflict: 'user_id' })

      await sendVerificationEmail((user as any).email, (user as any).name, token)
      res.json({ success: true, message: 'Verification email resent' })
    } catch (err) {
      console.error('resend-verification:', err)
      res.status(500).json({ success: false, error: 'Failed to resend' })
    }
  },
)

// ─────────────────────────────────────────────
// GET /api/auth/nysc-status
// Returns whether the NYSC service year is complete
// and triggers the completion email if just finished
// ─────────────────────────────────────────────
router.get(
  '/nysc-status',
  requireAuth,
  async (req: any, res: any): Promise<void> => {
    try {
      const { userId } = req.user

      const { data: user } = await supabaseAdmin
        .from('users').select('role, name, email').eq('id', userId).single()

      if (!user || (user as any).role !== 'nysc') {
        res.status(400).json({ success: false, error: 'Not an NYSC member' }); return
      }

      const { data: profile } = await supabaseAdmin
        .from('nysc_profiles')
        .select('created_at, service_completed, completion_notified')
        .eq('user_id', userId).single()

      if (!profile) { res.status(404).json({ success: false, error: 'NYSC profile not found' }); return }

      const p = profile as any
      const createdAt = new Date(p.created_at)
      const oneYearLater = new Date(createdAt)
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1)

      const isComplete = new Date() >= oneYearLater || p.service_completed === true
      const daysRemaining = isComplete ? 0 : Math.ceil((oneYearLater.getTime() - Date.now()) / 86400000)

      // If just completed and not yet notified, send email
      if (isComplete && !p.completion_notified) {
        await Promise.all([
          supabaseAdmin.from('nysc_profiles').update({ service_completed: true, completion_notified: true }).eq('user_id', userId),
          sendNYSCCompletionEmail((user as any).email, (user as any).name),
        ])
      }

      res.json({
        success: true,
        data: {
          isComplete,
          serviceStartDate: createdAt.toISOString(),
          serviceEndDate: oneYearLater.toISOString(),
          daysRemaining,
          canSwitchRole: isComplete,
        },
      })
    } catch (err) {
      console.error('nysc-status:', err)
      res.status(500).json({ success: false, error: 'Failed to check NYSC status' })
    }
  },
)

router.post(
  '/switch-role',
  requireAuth,
  [
    body('newRole').isIn(['agent', 'seeker']).withMessage('Can only switch to agent or seeker'),
    body('nin').optional().isString().isLength({ min: 11, max: 11 }).withMessage('NIN must be 11 digits'),
    body('businessName').optional().isString(),
    body('businessLocation').optional().isString(),
  ],
  validate,
  async (req: any, res: any): Promise<void> => {
    try {
      const { userId } = req.user
      const { newRole, nin, businessName, businessLocation } = req.body

      const { data: user } = await supabaseAdmin
        .from('users').select('role, name, email').eq('id', userId).single()

      if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }

      const u = user as any
      const currentRole = u.role

      // ── Rule enforcement ──

      // Seeker cannot switch at all (must re-register as agent)
      if (currentRole === 'seeker') {
        res.status(400).json({
          success: false,
          error: 'Property seekers cannot switch roles. Please register a new account as an agent.',
        })
        return
      }

      // Agent can only switch to seeker
      if (currentRole === 'agent' && newRole !== 'seeker') {
        res.status(400).json({ success: false, error: 'Agents can only switch to Property Seeker.' })
        return
      }

      // NYSC must complete service year first
      if (currentRole === 'nysc') {
        const { data: profile } = await supabaseAdmin
          .from('nysc_profiles').select('created_at, service_completed').eq('user_id', userId).single()

        if (!profile) {
          res.status(400).json({ success: false, error: 'NYSC profile not found.' }); return
        }

        const p = profile as any
        const createdAt = new Date(p.created_at)
        const oneYearLater = new Date(createdAt)
        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1)
        const isComplete = new Date() >= oneYearLater || p.service_completed === true

        if (!isComplete) {
          const daysLeft = Math.ceil((oneYearLater.getTime() - Date.now()) / 86400000)
          res.status(400).json({
            success: false,
            error: `Your NYSC service year is not complete yet. ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining.`,
            daysRemaining: daysLeft,
          })
          return
        }

        // Switching to agent — create agent profile
        if (newRole === 'agent') {
          if (!nin || !businessName) {
            res.status(400).json({
              success: false,
              error: 'To become an agent, you must provide your NIN and business name.',
            })
            return
          }

          // Check NIN not already used
          const { data: ninCheck } = await supabaseAdmin
            .from('agent_profiles').select('id').eq('nin', nin).single()
          if (ninCheck) {
            res.status(400).json({ success: false, error: 'This NIN is already registered.' }); return
          }

          // Create agent profile
          await supabaseAdmin.from('agent_profiles').insert({
            user_id: userId,
            business_name: businessName,
            business_location: businessLocation ?? '',
            nin,
            is_verified: false,
          })
        }
      }

      // Do the switch
      await supabaseAdmin.from('users').update({ role: newRole }).eq('id', userId)

      // Send confirmation email
      await sendRoleSwitchEmail(u.email, u.name, newRole)

      res.json({
        success: true,
        message: `Role switched to ${newRole} successfully`,
        data: { newRole },
      })
    } catch (err) {
      console.error('switch-role:', err)
      res.status(500).json({ success: false, error: 'Failed to switch role' })
    }
  },
)

export default router