/**
 * Referral & Wallet Routes
 *
 * POST /api/referrals/track              — record referral when buyer visits via link
 * GET  /api/referrals/link/:propertyId   — get referral link for a property
 * GET  /api/referrals/my-referrals       — referral history for logged-in user
 * GET  /api/referrals/stats              — earnings summary
 * GET  /api/wallet/balance               — wallet balance
 * GET  /api/wallet/transactions          — wallet ledger
 * GET  /api/wallet/withdrawals           — withdrawal history
 * POST /api/wallet/withdraw              — request withdrawal
 */
import { Router, type Request, type Response } from 'express'
import { body, param } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { supabaseAdmin } from '../lib/supabase.js'

const router = Router()
router.use(requireAuth)

// ─────────────────────────────────────────────
// POST /api/referrals/track
// Called when buyer opens a referral link and is logged in
// ─────────────────────────────────────────────
router.post(
  '/track',
  [
    body('referralCode').notEmpty().isString().isLength({ min: 6, max: 12 }),
    body('propertyId').notEmpty().isString(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as any).user
      const { referralCode, propertyId } = req.body as { referralCode: string; propertyId: string }

      // Find referrer
      const { data: referrer } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('referral_code', referralCode.toUpperCase())
        .maybeSingle()

      if (!referrer) {
        res.status(404).json({ success: false, error: 'Invalid referral code' })
        return
      }

      const referrerId = (referrer as any).id

      // Block self-referral
      if (referrerId === user.userId) {
        res.json({ success: true, message: 'Self-referral ignored' })
        return
      }

      // Check property
      const { data: property } = await supabaseAdmin
        .from('properties')
        .select('id, referral_enabled, referral_commission_percent, availability_status')
        .eq('id', propertyId)
        .maybeSingle()

      if (!property) { res.status(404).json({ success: false, error: 'Property not found' }); return }
      const prop = property as any
      if (!prop.referral_enabled) { res.json({ success: true, message: 'Referral not enabled' }); return }
      if (prop.availability_status !== 'available') { res.json({ success: true, message: 'Property unavailable' }); return }

      // Already tracked this buyer for this property?
      const { data: existing } = await supabaseAdmin
        .from('referrals')
        .select('id')
        .eq('property_id', propertyId)
        .eq('buyer_id', user.userId)
        .maybeSingle()

      if (existing) { res.json({ success: true, message: 'Already tracked' }); return }

      // Create referral record
      await supabaseAdmin.from('referrals').insert({
        referrer_id: referrerId,
        property_id: propertyId,
        buyer_id: user.userId,
        referral_code: referralCode.toUpperCase(),
        status: 'registered',
        commission_percent: prop.referral_commission_percent,
        registered_at: new Date().toISOString(),
      })

      res.json({ success: true, message: 'Referral tracked' })
    } catch (err: any) {
      console.error('referrals/track:', err)
      res.status(500).json({ success: false, error: 'Failed to track referral' })
    }
  },
)

// ─────────────────────────────────────────────
// GET /api/referrals/link/:propertyId
// ─────────────────────────────────────────────
router.get(
  '/link/:propertyId',
  [param('propertyId').notEmpty().isString()],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as any).user
      const { propertyId } = req.params

      const [userRes, propRes] = await Promise.all([
        supabaseAdmin.from('users').select('referral_code').eq('id', user.userId).single(),
        supabaseAdmin.from('properties')
          .select('id, title, referral_enabled, referral_commission_percent')
          .eq('id', propertyId).single(),
      ])

      if (userRes.error || !userRes.data) { res.status(404).json({ success: false, error: 'User not found' }); return }
      if (propRes.error || !propRes.data) { res.status(404).json({ success: false, error: 'Property not found' }); return }

      const prop = propRes.data as any
      if (!prop.referral_enabled) {
        res.status(400).json({ success: false, error: 'Referral not enabled for this property' })
        return
      }

      const code = (userRes.data as any).referral_code
      const FRONTEND = process.env.FRONTEND_URL ?? 'https://realtoba.com'
      const referralLink = `${FRONTEND}/properties/${propertyId}?ref=${code}`

      res.json({
        success: true,
        data: {
          referralLink,
          referralCode: code,
          commissionPercent: Number(prop.referral_commission_percent),
          propertyTitle: prop.title,
        },
      })
    } catch (err: any) {
      console.error('referrals/link:', err)
      res.status(500).json({ success: false, error: 'Failed to generate link' })
    }
  },
)

// ─────────────────────────────────────────────
// GET /api/referrals/my-referrals
// ─────────────────────────────────────────────
router.get('/my-referrals', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user

    const { data, error } = await supabaseAdmin
      .from('referrals')
      .select(`
        *,
        property:properties(id, title, address, city, images, referral_commission_percent)
      `)
      .eq('referrer_id', user.userId)
      .order('created_at', { ascending: false })

    if (error) throw error

    res.json({ success: true, data: data ?? [] })
  } catch (err: any) {
    console.error('my-referrals:', err)
    res.status(500).json({ success: false, error: 'Failed to load referrals' })
  }
})

// ─────────────────────────────────────────────
// GET /api/referrals/stats
// ─────────────────────────────────────────────
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user

    const { data } = await supabaseAdmin
      .from('referrals')
      .select('status, commission_amount')
      .eq('referrer_id', user.userId)

    const list = (data ?? []) as any[]

    res.json({
      success: true,
      data: {
        totalReferrals: list.length,
        successful: list.filter((r) => ['paid', 'commission_approved', 'commission_paid'].includes(r.status)).length,
        pendingCommission: list.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.commission_amount), 0),
        approvedCommission: list.filter((r) => ['commission_approved', 'commission_paid'].includes(r.status)).reduce((s, r) => s + Number(r.commission_amount), 0),
        paidCommission: list.filter((r) => r.status === 'commission_paid').reduce((s, r) => s + Number(r.commission_amount), 0),
      },
    })
  } catch (err: any) {
    console.error('referrals/stats:', err)
    res.status(500).json({ success: false, error: 'Failed to load stats' })
  }
})

// ─────────────────────────────────────────────
// GET /api/wallet/balance
// ─────────────────────────────────────────────
router.get('/wallet/balance', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user

    let { data, error } = await supabaseAdmin
      .from('user_wallets').select('*').eq('user_id', user.userId).maybeSingle()

    if (!data) {
      const res2 = await supabaseAdmin.from('user_wallets').insert({ user_id: user.userId }).select().single()
      data = res2.data
    }

    res.json({ success: true, data })
  } catch (err: any) {
    console.error('wallet/balance:', err)
    res.status(500).json({ success: false, error: 'Failed to load wallet' })
  }
})

// ─────────────────────────────────────────────
// GET /api/wallet/transactions
// ─────────────────────────────────────────────
router.get('/wallet/transactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user
    const { data, error } = await supabaseAdmin
      .from('wallet_transactions')
      .select('*')
      .eq('user_id', user.userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error
    res.json({ success: true, data: data ?? [] })
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to load transactions' })
  }
})

// ─────────────────────────────────────────────
// GET /api/wallet/withdrawals
// ─────────────────────────────────────────────
router.get('/wallet/withdrawals', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user
    const { data, error } = await supabaseAdmin
      .from('withdrawal_requests')
      .select('*')
      .eq('user_id', user.userId)
      .order('requested_at', { ascending: false })

    if (error) throw error
    res.json({ success: true, data: data ?? [] })
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to load withdrawals' })
  }
})

// ─────────────────────────────────────────────
// POST /api/wallet/withdraw
// ─────────────────────────────────────────────
router.post(
  '/wallet/withdraw',
  [
    body('amount').isNumeric().custom((v) => Number(v) >= 500).withMessage('Minimum withdrawal is ₦500'),
    body('bankName').notEmpty().isString(),
    body('bankCode').notEmpty().isString(),
    body('accountNumber').notEmpty().isString().isLength({ min: 10, max: 10 }),
    body('accountName').notEmpty().isString(),
  ],
  validate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as any).user
      const { amount, bankName, bankCode, accountNumber, accountName } = req.body as any
      const withdrawAmount = Number(amount)

      // Get wallet balance
      const { data: wallet } = await supabaseAdmin
        .from('user_wallets').select('balance').eq('user_id', user.userId).single()

      if (!wallet) { res.status(400).json({ success: false, error: 'Wallet not found' }); return }
      const currentBalance = Number((wallet as any).balance)

      if (currentBalance < withdrawAmount) {
        res.status(400).json({
          success: false,
          error: `Insufficient balance. Available: ₦${currentBalance.toLocaleString()}`,
        })
        return
      }

      // Block double withdrawal requests
      const { data: pending } = await supabaseAdmin
        .from('withdrawal_requests')
        .select('id').eq('user_id', user.userId).eq('status', 'pending').maybeSingle()

      if (pending) {
        res.status(400).json({
          success: false,
          error: 'You already have a pending withdrawal. Please wait for it to be processed first.',
        })
        return
      }

      // Deduct from wallet (hold funds)
      await supabaseAdmin.from('user_wallets').update({
        balance: currentBalance - withdrawAmount,
        total_withdrawn: supabaseAdmin.rpc,
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.userId)

      // Better: use raw update
      await supabaseAdmin.from('user_wallets')
        .update({ balance: currentBalance - withdrawAmount, updated_at: new Date().toISOString() })
        .eq('user_id', user.userId)

      // Create withdrawal record
      const { data: wd, error: wdErr } = await supabaseAdmin
        .from('withdrawal_requests')
        .insert({ user_id: user.userId, amount: withdrawAmount, bank_name: bankName, bank_code: bankCode, account_number: accountNumber, account_name: accountName, status: 'pending' })
        .select().single()

      if (wdErr) {
        // Rollback
        await supabaseAdmin.from('user_wallets')
          .update({ balance: currentBalance, updated_at: new Date().toISOString() })
          .eq('user_id', user.userId)
        throw wdErr
      }

      // Record debit in ledger
      await supabaseAdmin.from('wallet_transactions').insert({
        user_id: user.userId, type: 'debit', amount: withdrawAmount,
        description: `Withdrawal to ${bankName} - ${accountNumber}`, status: 'pending',
      })

      // Admin notification
      const { error: notificationError } = await supabaseAdmin.from('admin_notifications').insert({
        type: 'payout_failed',
        title: ' Withdrawal Request',
        body: `A user requested ₦${withdrawAmount.toLocaleString()} withdrawal to ${bankName}.`,
      })

      if(notificationError){
        console.log('Failed to create admin notification:', notificationError)
      }

      res.status(201).json({ success: true, message: 'Withdrawal request submitted. Admin will process within 24 hours.', data: wd })
    } catch (err: any) {
      console.error('wallet/withdraw:', err)
      res.status(500).json({ success: false, error: 'Failed to submit withdrawal' })
    }
  },
)

export default router