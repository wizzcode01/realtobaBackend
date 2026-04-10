import rateLimit from 'express-rate-limit'

/**
 * General API limiter — applies to all routes.
 * 100 requests per 15 minutes per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
})

/**
 * Strict limiter for sensitive admin operations (payouts).
 * 10 requests per 15 minutes per IP.
 * Prevents bulk fraudulent payout triggers.
 */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many admin operations. Please slow down.' },
})

/**
 * Webhook limiter — allows Paystack IPs to send many events.
 * 500 requests per minute (Paystack can send bursts of events).
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Webhook rate limit exceeded.' },
})

/**
 * Message sending limiter.
 * 30 messages per minute per IP — prevents spam.
 */
export const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many messages. Please wait a moment.' },
})