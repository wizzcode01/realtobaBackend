/**
 * Payment Routes
 *
 * POST /api/payments/webhook
 *   Called by Paystack when a payment succeeds.
 *   Verifies signature, updates transaction, notifies admin.
 *   This endpoint must NOT require auth — Paystack calls it directly.
 *   Security comes from validatePaystackWebhook middleware instead.
 *
 * POST /api/payments/initialize
 *   Called by frontend before showing Paystack popup.
 *   Creates a PENDING transaction record in DB as audit trail.
 *   Returns the reference to use in the Paystack inline popup.
 *
 * GET /api/payments/banks
 *   Returns list of Nigerian banks for agent bank details form.
 *
 * POST /api/payments/verify-bank
 *   Verifies an agent's bank account number is real.
 *
 * GET /api/payments/transactions
 *   Returns current user's transaction history.
 */
import { Router, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { v4 as uuidv4 } from 'uuid'
import { validatePaystackWebhook } from '../middleware/validatePaystack.js'
import { requireAuth } from '../middleware/auth.js'
import { webhookLimiter, strictLimiter } from '../middleware/rateLimiter.js'
import { verifyTransaction, getBanks, verifyBankAccount } from '../lib/paystack.js'
import { supabaseAdmin} from '../lib/supabase.js'
import type { PaystackWebhookEvent } from '../types/index.js'

const router = Router()

// ─────────────────────────────────────────────
// PAYSTACK WEBHOOK
// The most critical endpoint in the system.
// IMPORTANT: express.raw() is applied at the route level (not globally)
// so that the raw buffer is available for signature verification.
// ─────────────────────────────────────────────
router.post(
  '/webhook',
  webhookLimiter,
  // express.raw MUST come before validatePaystackWebhook
  // This is configured in index.ts using router-level middleware
  validatePaystackWebhook,
  async (req: Request, res: Response): Promise<void> => {
    const event = req.body as PaystackWebhookEvent

    // Always respond 200 to Paystack immediately.
    // If we delay, Paystack will retry. Process asynchronously.
    res.status(200).json({ received: true })

    // Only process charge.success events
    if (event.event !== 'charge.success') return

    const { reference, status, metadata } = event.data
   // amount,
    if (status !== 'success') return

    try {
      // Double-verify with Paystack API (don't just trust the webhook body)
      const verified = await verifyTransaction(reference)

      if (verified.status !== 'success') {
        console.warn(`Webhook for ${reference} says success but verify says ${verified.status}`)
        return
      }

      const amountNaira = verified.amount / 100 // convert kobo to naira
      const platformFeePercent = Number(process.env.PLATFORM_FEE_PERCENT ?? 10)
      const platformFee = amountNaira * (platformFeePercent / 100)
      const agentAmount = amountNaira - platformFee

      // Update transaction in Supabase
      const { data: updatedTx, error: txError } = await supabaseAdmin
        .from('transactions')
        .update({
          status: 'paid_to_platform',
          deal_status: 'awaiting_confirmation',
          platform_fee: platformFee,
          agent_amount: agentAmount,
          paid_at: new Date().toISOString(),
        })
        .eq('gateway_reference', reference)
        .select('*, property:properties(title, address, agent_id)')
        .single()

      if (txError) {
        console.error('Failed to update transaction after webhook:', txError)
        return
      }

      // Create admin notification
      await supabaseAdmin.from('admin_notifications').insert({
        type: 'payment_received',
        title: 'New Payment Received',
        body: `₦${amountNaira.toLocaleString()} received for property: ${(updatedTx?.property as { title?: string })?.title ?? 'Unknown'}`,
        transaction_id: updatedTx?.id,
        property_id: metadata?.property_id,
        is_read: false,
      })

      // Auto-create a system message to the client
      if (metadata?.user_id) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: await getOrCreateConversation(metadata.user_id),
          sender_id: null,            // null = system/admin message
          sender_type: 'admin',
          content:
            `Hi there! We've received your payment of ₦${amountNaira.toLocaleString()} ` +
            `for this property. Please confirm with us once you've visited the property ` +
            `and agreed on the terms with the agent. Reply to this message to let us know!`,
          is_system: true,
        })
      }

      console.log(`✅ Payment processed: ${reference} — ₦${amountNaira.toLocaleString()}`)
    } catch (err) {
      console.error('Webhook processing error:', err)
      // Don't re-throw — we already sent 200 to Paystack
    }
  },
)

// ─────────────────────────────────────────────
// INITIALIZE PAYMENT
// Creates a pending transaction BEFORE the Paystack popup opens.
// This ensures every payment attempt is recorded, even abandoned ones.
// ─────────────────────────────────────────────
router.post(
  '/initialize',
  requireAuth,
  [
    body('propertyId').isUUID().withMessage('Valid property ID required'),
    body('amount').isNumeric().withMessage('Amount must be a number').custom((v: unknown) => Number(v) > 0),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: errors.array()[0].msg })
      return
    }

    const user = (req as Request & { user: { userId: string; email: string } }).user
    const { propertyId, amount } = req.body as { propertyId: string; amount: number }

    try {
      // Verify the property exists and is approved
      const { data: property, error: propError } = await supabaseAdmin
        .from('properties')
        .select('id, title, price, agent_id, verification_status')
        .eq('id', propertyId)
        .single()

      if (propError || !property) {
        res.status(404).json({ success: false, error: 'Property not found.' })
        return
      }

      if ((property as { verification_status: string }).verification_status !== 'approved') {
        res.status(400).json({ success: false, error: 'This property is not approved for payment.' })
        return
      }

      const reference = `RB-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`

      // Create PENDING transaction record
      const { data: transaction, error: txError } = await supabaseAdmin
        .from('transactions')
        .insert({
          user_id: user.userId,
          property_id: propertyId,
          agent_id: (property as { agent_id: string }).agent_id,
          amount: Number(amount),
          currency: 'NGN',
          status: 'pending',
          deal_status: null,
          gateway: 'paystack',
          gateway_reference: reference,
        })
        .select()
        .single()

      if (txError) {
        console.error('Failed to create transaction:', txError)
        res.status(500).json({ success: false, error: 'Failed to initialize payment.' })
        return
      }

      res.json({
        success: true,
        data: {
          reference,
          transactionId: (transaction as { id: string }).id,
          amount: Number(amount),
          email: user.email,
        },
      })
    } catch (err) {
      console.error('Initialize payment error:', err)
      res.status(500).json({ success: false, error: 'Internal server error.' })
    }
  },
)

// ─────────────────────────────────────────────
// GET BANKS
// ─────────────────────────────────────────────
router.get('/banks', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const banks = await getBanks()
    res.json({ success: true, data: banks })
  } catch (err) {
    console.error('Get banks error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch bank list.' })
  }
})

// ─────────────────────────────────────────────
// VERIFY BANK ACCOUNT
// ─────────────────────────────────────────────
router.post(
  '/verify-bank',
  requireAuth,
  strictLimiter,
  [
    body('accountNumber').isLength({ min: 10, max: 10 }).withMessage('Account number must be 10 digits'),
    body('bankCode').notEmpty().withMessage('Bank code required'),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: errors.array()[0].msg })
      return
    }

    const { accountNumber, bankCode } = req.body as { accountNumber: string; bankCode: string }

    try {
      const result = await verifyBankAccount(accountNumber, bankCode)
      res.json({ success: true, data: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bank verification failed'
      res.status(400).json({ success: false, error: message })
    }
  },
)

// ─────────────────────────────────────────────
// USER TRANSACTION HISTORY
// ─────────────────────────────────────────────
router.get('/transactions', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = (req as Request & { user: { userId: string } }).user

  try {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*, property:properties(id, title, address, images)')
      .eq('user_id', user.userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    res.json({ success: true, data: data ?? [] })
  } catch (err) {
    console.error('Get transactions error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch transactions.' })
  }
})

// ─────────────────────────────────────────────
// HELPER — Get or create a conversation between a user and admin
// ─────────────────────────────────────────────
async function getOrCreateConversation(userId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('conversations')
    .select('id')
    .eq('participant_user_id', userId)
    .eq('type', 'user_admin')
    .single()

  if (existing) return (existing as { id: string }).id

  const { data: created, error } = await supabaseAdmin
    .from('conversations')
    .insert({ participant_user_id: userId, type: 'user_admin' })
    .select()
    .single()

  if (error) throw error
  return (created as { id: string }).id
}

export default router