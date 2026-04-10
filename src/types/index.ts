/**
 * Realtoba Backend — Shared TypeScript Types
 */

// ── Auth ──
export interface AuthenticatedRequest extends Express.Request {
  user?: {
    uid: string         // Firebase UID
    email?: string
    userId?: string     // Supabase user UUID
    isAdmin?: boolean
  }
}

// Re-export express with augmented request
import type { Request, Response, NextFunction } from 'express'

export interface TypedRequest<B = unknown, P = Record<string, string>, Q = Record<string, string>>
  extends Request<P, unknown, B, Q> {
  user?: {
    uid: string
    email?: string
    userId?: string
    isAdmin?: boolean
  }
}

export type TypedResponse = Response
export type NextFn = NextFunction

// ── Paystack ──
export interface PaystackWebhookEvent {
  event: string
  data: {
    id: number
    reference: string
    amount: number       // in kobo
    status: string
    currency: string
    customer: {
      email: string
      id: number
    }
    metadata?: {
      property_id?: string
      user_id?: string
      custom_fields?: Array<{
        display_name: string
        variable_name: string
        value: string
      }>
    }
    paid_at?: string
    created_at?: string
  }
}

export interface PaystackTransferResponse {
  status: boolean
  message: string
  data: {
    reference: string
    status: string
    transfer_code: string
    amount: number
    currency: string
    recipient: string
    createdAt: string
  }
}

export interface PaystackRecipientResponse {
  status: boolean
  message: string
  data: {
    recipient_code: string
    type: string
    name: string
    details: {
      account_number: string
      bank_code: string
    }
  }
}

export interface PaystackVerifyResponse {
  status: boolean
  message: string
  data: {
    id: number
    reference: string
    amount: number
    status: string
    currency: string
    customer: { email: string }
    metadata?: Record<string, unknown>
  }
}

// ── Transaction States ──
export type TransactionDealStatus =
  | 'awaiting_confirmation'  // payment received, waiting for admin to confirm deal
  | 'deal_confirmed'         // client confirmed deal sealed
  | 'agent_paid'             // admin triggered payout to agent
  | 'refunded'               // deal fell through, client refunded

export type PayoutStatus = 'pending' | 'processing' | 'success' | 'failed'

// ── Admin Audit Log ──
export type AuditAction =
  | 'verify_property'
  | 'reject_property'
  | 'approve_payout'
  | 'refund_transaction'
  | 'suspend_user'
  | 'unsuspend_user'
  | 'send_message'

// ── API Response Shapes ──
export interface ApiSuccess<T = unknown> {
  success: true
  data: T
  message?: string
}

export interface ApiError {
  success: false
  error: string
  code?: string
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError