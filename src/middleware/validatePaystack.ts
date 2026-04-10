/**
 * Paystack Webhook Signature Verification
 *
 * Paystack signs every webhook with HMAC-SHA512 using your webhook secret.
 * We verify this signature BEFORE processing any webhook event.
 *
 * This is critical security. Without this check, anyone could send
 * a fake "payment succeeded" webhook to your server and trigger a
 * fraudulent payout to an agent.
 *
 * Reference: https://paystack.com/docs/payments/webhooks/#verify-event-origin
 */
import type { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

export function validatePaystackWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('PAYSTACK_WEBHOOK_SECRET not set — webhook validation skipped (DANGEROUS in production!)')
    if (process.env.NODE_ENV === 'production') {
      res.status(500).json({ error: 'Webhook secret not configured' })
      return
    }
    next()
    return
  }

  // Get the signature Paystack sent in the header
  const paystackSignature = req.headers['x-paystack-signature'] as string

  if (!paystackSignature) {
    res.status(401).json({ error: 'Missing Paystack signature header.' })
    return
  }

  // Recreate the expected signature using our webhook secret
  // IMPORTANT: req.body must be the RAW buffer, not parsed JSON.
  // This is why we use express.raw() on the webhook route (see payments.ts).
  const rawBody = req.body as Buffer
  const expectedSignature = crypto
    .createHmac('sha512', webhookSecret)
    .update(rawBody)
    .digest('hex')

  // Constant-time comparison to prevent timing attacks
  const sigBuffer = Buffer.from(paystackSignature, 'hex')
  const expectedBuffer = Buffer.from(expectedSignature, 'hex')

  if (sigBuffer.length !== expectedBuffer.length) {
    res.status(401).json({ error: 'Webhook signature mismatch — invalid request.' })
    return
  }

  const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer)

  if (!isValid) {
    console.warn('Invalid Paystack webhook signature received — possible fraud attempt')
    res.status(401).json({ error: 'Webhook signature invalid.' })
    return
  }

  // Signature is valid — parse the body and continue
  try {
    req.body = JSON.parse(rawBody.toString())
    next()
  } catch {
    res.status(400).json({ error: 'Invalid JSON payload.' })
  }
}