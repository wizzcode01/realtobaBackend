/**
 * Admin Routes — Protected by requireAuth + requireAdmin
 *
 * GET  /api/admin/dashboard         — Stats overview
 * GET  /api/admin/transactions       — All platform transactions
 * POST /api/admin/transactions/:id/confirm-deal  — Mark deal confirmed
 * POST /api/admin/transactions/:id/pay-agent     — Trigger agent payout
 * POST /api/admin/transactions/:id/refund        — Refund a client
 *
 * GET  /api/admin/properties         — All properties (all statuses)
 * POST /api/admin/properties/:id/approve  — Approve a listing
 * POST /api/admin/properties/:id/reject   — Reject a listing
 *
 * GET  /api/admin/users             — All users
 * POST /api/admin/users/:id/suspend — Suspend user
 *
 * GET  /api/admin/notifications     — Admin notifications
 * POST /api/admin/notifications/:id/read — Mark notification read
 *
 * GET  /api/admin/conversations     — All conversations for monitoring
 *
 * POST /api/admin/agents/:id/bank-account — Save agent bank details
 */
import { Router, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { v4 as uuidv4 } from 'uuid'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { strictLimiter } from '../middleware/rateLimiter.js'
import { createTransferRecipient, initiateTransfer } from '../lib/paystack.js'
import { supabaseAdmin, logAdminAction } from '../lib/supabase.js'

const router = Router()

// All admin routes require authentication and admin role
router.use(requireAuth, requireAdmin)

// ─────────────────────────────────────────────
// DASHBOARD STATS
// ─────────────────────────────────────────────
router.get('/dashboard', async (req: Request, res: Response): Promise<void> => {
  try {
    const [txResult, usersResult, propertiesResult, pendingResult] = await Promise.all([
      supabaseAdmin.from('transactions').select('amount, status, deal_status, agent_amount'),
      supabaseAdmin.from('users').select('id', { count: 'exact' }),
      supabaseAdmin.from('properties').select('id, verification_status', { count: 'exact' }),
      supabaseAdmin.from('transactions').select('id', { count: 'exact' }).eq('deal_status', 'awaiting_confirmation'),
    ])

    const transactions = txResult.data ?? []
    const totalCollected = transactions
      .filter((t: { status: string }) => t.status === 'paid_to_platform' || t.status === 'agent_paid')
      .reduce((sum: number, t: { amount: number }) => sum + Number(t.amount), 0)

    const totalPaidOut = transactions
      .filter((t: { deal_status: string }) => t.deal_status === 'agent_paid')
      .reduce((sum: number, t: { agent_amount: number }) => sum + Number(t.agent_amount), 0)

    const pendingProperties = ((propertiesResult.data ?? []) as { verification_status: string }[])
      .filter((p) => p.verification_status === 'pending').length

    res.json({
      success: true,
      data: {
        totalCollected,
        totalPaidOut,
        platformBalance: totalCollected - totalPaidOut,
        totalUsers: usersResult.count ?? 0,
        totalProperties: propertiesResult.count ?? 0,
        pendingApprovals: pendingProperties,
        pendingPayouts: pendingResult.count ?? 0,
      },
    })
  } catch (err) {
    console.error('Admin dashboard error:', err)
    res.status(500).json({ success: false, error: 'Failed to load dashboard stats.' })
  }
})

// ─────────────────────────────────────────────
// TRANSACTIONS — VIEW ALL
// ─────────────────────────────────────────────
router.get('/transactions', async (req: Request, res: Response): Promise<void> => {
  const { status, page = '0', limit = '20' } = req.query as Record<string, string>
  const pageNum = Math.max(0, Number(page))
  const pageSize = Math.min(100, Number(limit))

  try {
    let query = supabaseAdmin
      .from('transactions')
      .select(
        `*,
        user:users!transactions_user_id_fkey(id, name, email, phone),
        property:properties(id, title, address, images),
        agent:users!transactions_agent_id_fkey(id, name, email, phone)`,
      )
      .order('created_at', { ascending: false })
      .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1)

    if (status) {
      query = query.eq('deal_status', status)
    }

    const { data, error, count } = await query

    if (error) throw error

    res.json({ success: true, data: data ?? [], total: count })
  } catch (err) {
    console.error('Admin transactions error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch transactions.' })
  }
})

// ─────────────────────────────────────────────
// CONFIRM DEAL
// Admin marks that the client confirmed the deal is sealed
// ─────────────────────────────────────────────
router.post(
  '/transactions/:id/confirm-deal',
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as { id: string }
    const admin = (req as Request & { user: { userId: string } }).user

    try {
      const { data, error } = await supabaseAdmin
        .from('transactions')
        .update({ deal_status: 'deal_confirmed', deal_confirmed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('deal_status', 'awaiting_confirmation') // prevent double-confirm
        .select()
        .single()

      if (error || !data) {
        res.status(400).json({ success: false, error: 'Transaction not found or already confirmed.' })
        return
      }

      await logAdminAction(admin.userId, 'confirm_deal', id, 'transaction')

      res.json({ success: true, data, message: 'Deal confirmed. Ready for agent payout.' })
    } catch (err) {
      console.error('Confirm deal error:', err)
      res.status(500).json({ success: false, error: 'Failed to confirm deal.' })
    }
  },
)

// ─────────────────────────────────────────────
// PAY AGENT — The most critical and sensitive operation
// ─────────────────────────────────────────────
router.post(
  '/transactions/:id/pay-agent',
  strictLimiter,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const { id } = req.params
    const admin = (req as Request<{ id: string }> & { user: { userId: string } }).user

    try {
      // Step 1: Get the transaction and verify it's ready for payout
      const { data: transaction, error: txError } = await supabaseAdmin
        .from('transactions')
        .select('*, agent:users!transactions_agent_id_fkey(id, name, email)')
        .eq('id', id)
        .single()

      if (txError || !transaction) {
        res.status(404).json({ success: false, error: 'Transaction not found.' })
        return
      }

      const tx = transaction as {
        id: string
        deal_status: string
        agent_amount: number
        gateway_reference: string
        agent_id: string
        agent: { id: string; name: string; email: string }
      }

      if (tx.deal_status !== 'deal_confirmed') {
        res.status(400).json({
          success: false,
          error: `Cannot pay agent — deal status is "${tx.deal_status}". Deal must be confirmed first.`,
        })
        return
      }

      // Step 2: Get agent's bank details and Paystack recipient code
      const { data: bankAccount, error: bankError } = await supabaseAdmin
        .from('agent_bank_accounts')
        .select('*')
        .eq('agent_id', tx.agent_id)
        .eq('is_verified', true)
        .single()

      if (bankError || !bankAccount) {
        res.status(400).json({
          success: false,
          error: "Agent has no verified bank account on file. Ask the agent to add their bank details first.",
        })
        return
      }

      const bank = bankAccount as {
        paystack_recipient_code: string
        account_name: string
        bank_name: string
      }

      // Step 3: Create a payout record (status: processing) — idempotency check
      const payoutReference = `PAYOUT-${uuidv4().slice(0, 12).toUpperCase()}`

      const { data: payout, error: payoutError } = await supabaseAdmin
        .from('payouts')
        .insert({
          transaction_id: id,
          agent_id: tx.agent_id,
          amount: tx.agent_amount,
          status: 'processing',
          reference: payoutReference,
        })
        .select()
        .single()

      if (payoutError) {
        // If it's a unique constraint violation, a payout already exists
        if (payoutError.code === '23505') {
          res.status(400).json({ success: false, error: 'A payout for this transaction already exists.' })
        } else {
          throw payoutError
        }
        return
      }

      // Step 4: Initiate Paystack transfer
      let transferResult
      try {
        transferResult = await initiateTransfer(
          bank.paystack_recipient_code,
          tx.agent_amount,
          payoutReference,
          `Realtoba property payout — ${(payout as { id: string }).id}`,
        )
      } catch (transferErr) {
        // Payout failed — mark as failed, don't update transaction
        await supabaseAdmin
          .from('payouts')
          .update({ status: 'failed', failed_reason: (transferErr as Error).message })
          .eq('id', (payout as { id: string }).id)

        res.status(500).json({
          success: false,
          error: `Transfer failed: ${(transferErr as Error).message}`,
        })
        return
      }

      // Step 5: Update payout and transaction as successful
      await Promise.all([
        supabaseAdmin.from('payouts').update({
          status: 'success',
          paystack_transfer_code: transferResult.transfer_code,
          paid_at: new Date().toISOString(),
        }).eq('id', (payout as { id: string }).id),

        supabaseAdmin.from('transactions').update({
          deal_status: 'agent_paid',
          agent_paid_at: new Date().toISOString(),
          payout_reference: payoutReference,
        }).eq('id', id),
      ])

      await logAdminAction(admin.userId, 'approve_payout', id, 'transaction', {
        amount: tx.agent_amount,
        agent_id: tx.agent_id,
        reference: payoutReference,
      })

      res.json({
        success: true,
        message: `₦${tx.agent_amount.toLocaleString()} successfully transferred to ${bank.account_name} (${bank.bank_name})`,
        data: { payoutReference, transferCode: transferResult.transfer_code },
      })
    } catch (err) {
      console.error('Pay agent error:', err)
      res.status(500).json({ success: false, error: 'Payout failed. Please try again.' })
    }
  },
)

// ─────────────────────────────────────────────
// PROPERTY MANAGEMENT
// ─────────────────────────────────────────────

// Get all properties with filters
router.get('/properties', async (req: Request, res: Response): Promise<void> => {
  const { status = 'pending', page = '0' } = req.query as Record<string, string>
  const pageNum = Math.max(0, Number(page))

  try {
    const { data, error, count } = await supabaseAdmin
      .from('properties')
     .select('*, agent:users!properties_agent_id_fkey(id, name, email, phone)', { count: 'exact' })
      .eq('verification_status', status)
      .order('created_at', { ascending: false })
      .range(pageNum * 20, (pageNum + 1) * 20 - 1)

    if (error) throw error

    res.json({ success: true, data: data ?? [], total: count })
  } catch (err) {
    console.error('Admin properties error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch properties.' })
  }
})

// Approve a property listing
router.post(
  '/properties/:id/approve',
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params as { id: string }
    const admin = (req as Request & { user: { userId: string } }).user
    const { note } = req.body as { note?: string }

    try {
      const { error } = await supabaseAdmin
        .from('properties')
        .update({
          verification_status: 'approved',
          admin_note: note ?? null,
          verified_at: new Date().toISOString(),
          verified_by: admin.userId,
        })
        .eq('id', id)

      if (error) throw error

      await logAdminAction(admin.userId, 'verify_property', id, 'property', { note })

      // Notify the agent their listing is approved
      await notifyAgent(id, 'Your property listing has been approved and is now live on Realtoba!')

      res.json({ success: true, message: 'Property approved and is now live.' })
    } catch (err) {
      console.error('Approve property error:', err)
      res.status(500).json({ success: false, error: 'Failed to approve property.' })
    }
  },
)

// Reject a property listing (requires a reason)
router.post(
  '/properties/:id/reject',
  [body('reason').notEmpty().withMessage('A rejection reason is required')],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: errors.array()[0].msg })
      return
    }

    const { id } = req.params as { id: string }
    const admin = (req as Request & { user: { userId: string } }).user
    const { reason } = req.body as { reason: string }

    try {
      const { error } = await supabaseAdmin
        .from('properties')
        .update({
          verification_status: 'rejected',
          admin_note: reason,
          verified_at: new Date().toISOString(),
          verified_by: admin.userId,
        })
        .eq('id', id)

      if (error) throw error

      await logAdminAction(admin.userId, 'reject_property', id, 'property', { reason })

      // Notify the agent with the reason
      await notifyAgent(id, `Your property listing was not approved. Reason: ${reason}. Please update and resubmit.`)

      res.json({ success: true, message: 'Property rejected. Agent has been notified.' })
    } catch (err) {
      console.error('Reject property error:', err)
      res.status(500).json({ success: false, error: 'Failed to reject property.' })
    }
  },
)

// ─────────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────────
router.get('/users', async (req: Request, res: Response): Promise<void> => {
  const { role, page = '0', search } = req.query as Record<string, string>
  const pageNum = Math.max(0, Number(page))

  try {
    let query = supabaseAdmin
      .from('users')
      .select('id, name, email, role, phone, is_suspended, created_at, is_admin', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(pageNum * 20, (pageNum + 1) * 20 - 1)

    if (role) query = query.eq('role', role)
    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)

    const { data, error, count } = await query

    if (error) throw error

    res.json({ success: true, data: data ?? [], total: count })
  } catch (err) {
    console.error('Admin users error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch users.' })
  }
})

router.post('/users/:id/suspend', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const { id } = req.params
  const admin = (req as Request<{ id: string }> & { user: { userId: string } }).user
  const { reason } = req.body as { reason?: string }

  try {
    const { data: user } = await supabaseAdmin.from('users').select('is_suspended').eq('id', id).single()
    const newStatus = !(user as { is_suspended: boolean } | null)?.is_suspended

    await supabaseAdmin.from('users').update({ is_suspended: newStatus }).eq('id', id)
    await logAdminAction(
      admin.userId,
      newStatus ? 'suspend_user' : 'unsuspend_user',
      id,
      'user',
      { reason },
    )

    res.json({ success: true, message: `User ${newStatus ? 'suspended' : 'unsuspended'}.` })
  } catch (err) {
    console.error('Suspend user error:', err)
    res.status(500).json({ success: false, error: 'Failed to update user status.' })
  }
})

// ─────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────
router.get('/notifications', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    res.json({ success: true, data: data ?? [] })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch notifications.' })
  }
})

router.post('/notifications/:id/read', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  try {
    await supabaseAdmin.from('admin_notifications').update({ is_read: true }).eq('id', id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to mark notification read.' })
  }
})

// ─────────────────────────────────────────────
// AGENT BANK ACCOUNT
// ─────────────────────────────────────────────
router.post(
  '/agents/:agentId/bank-account',
  [
    body('accountNumber').isLength({ min: 10, max: 10 }),
    body('bankCode').notEmpty(),
    body('accountName').notEmpty(),
    body('bankName').notEmpty(),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: errors.array()[0].msg })
      return
    }

    const { agentId } = req.params
    const { accountNumber, bankCode, accountName, bankName } = req.body as {
      accountNumber: string
      bankCode: string
      accountName: string
      bankName: string
    }

    try {
      // Create Paystack recipient for this agent
      const recipient = await createTransferRecipient(accountName, accountNumber, bankCode)

      // Upsert bank account record
      const { error } = await supabaseAdmin.from('agent_bank_accounts').upsert({
        agent_id: agentId,
        account_number: accountNumber,
        bank_code: bankCode,
        account_name: accountName,
        bank_name: bankName,
        paystack_recipient_code: recipient.recipient_code,
        is_verified: true,
      }, { onConflict: 'agent_id' })

      if (error) throw error

      res.json({ success: true, message: 'Bank account saved and verified with Paystack.' })
    } catch (err) {
      console.error('Save bank account error:', err)
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to save bank account.',
      })
    }
  },
)

// ─────────────────────────────────────────────
// HELPER — Notify agent about their property status
// ─────────────────────────────────────────────
async function notifyAgent(propertyId: string, message: string): Promise<void> {
  try {
    const { data: property } = await supabaseAdmin
      .from('properties')
      .select('agent_id')
      .eq('id', propertyId)
      .single()

    if (!property) return

    await supabaseAdmin.from('messages').insert({
      conversation_id: await getOrCreateAgentConversation((property as { agent_id: string }).agent_id),
      sender_type: 'admin',
      content: message,
      is_system: true,
    })
  } catch (err) {
    console.error('Failed to notify agent:', err)
  }
}

async function getOrCreateAgentConversation(agentId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('participant_user_id', agentId)
    .eq('type', 'agent_admin')
    .single()

  if (existing) return (existing as { id: string }).id

  const { data: created } = await supabaseAdmin
    .from('conversations')
    .insert({ participant_user_id: agentId, type: 'agent_admin' })
    .select()
    .single()

  return (created as { id: string }).id
}

export default router