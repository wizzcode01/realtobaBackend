/**
 * Key operations:
 *   verifyTransaction   → confirm a payment after webhook
 *   createRecipient     → register an agent's bank account for transfers
 *   initiateTransfer    → send money to an agent
 *   verifyBankAccount   → validate account number before saving
 */
import axios from 'axios'
import type {
  PaystackTransferResponse,
  PaystackRecipientResponse,
  PaystackVerifyResponse,
} from '../types/index.js'

const PAYSTACK_BASE = 'https://api.paystack.co'
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY

if (!SECRET_KEY) {
  throw new Error('Missing PAYSTACK_SECRET_KEY in environment variables.')
}

// Axios instance with auth header pre-configured
const paystackApi = axios.create({
  baseURL: PAYSTACK_BASE,
  headers: {
    Authorization: `Bearer ${SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
})

export async function verifyTransaction(reference: string): Promise<PaystackVerifyResponse['data']> {
  const { data } = await paystackApi.get<PaystackVerifyResponse>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  )

  if (!data.status) {
    throw new Error(`Paystack verification failed: ${data.message}`)
  }

  return data.data
}

// bank account verification
export async function verifyBankAccount(
  accountNumber: string,
  bankCode: string,
): Promise<{ account_name: string; account_number: string }> {
  const { data } = await paystackApi.get('/bank/resolve', {
    params: { account_number: accountNumber, bank_code: bankCode },
  })

  if (!data.status) {
    throw new Error('Could not verify bank account. Check the account number and bank.')
  }

  return data.data
}


export async function getBanks(): Promise<Array<{ name: string; code: string; id: number }>> {
  const { data } = await paystackApi.get('/bank', {
    params: { country: 'nigeria', use_cursor: false, perPage: 200 },
  })

  if (!data.status) {
    throw new Error('Failed to fetch bank list')
  }

  return data.data
}

// transfer recipients (for payouts to agents)
export async function createTransferRecipient(
  name: string,
  accountNumber: string,
  bankCode: string,
  description?: string,
): Promise<PaystackRecipientResponse['data']> {
  const { data } = await paystackApi.post<PaystackRecipientResponse>('/transferrecipient', {
    type: 'nuban',           // Nigerian Uniform Bank Account Number
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'NGN',
    description: description ?? `Realtoba Agent — ${name}`,
  })

  if (!data.status) {
    throw new Error(`Failed to create transfer recipient: ${data.message}`)
  }

  return data.data
}

// ─────────────────────────────────────────────
// TRANSFERS (PAYOUT TO AGENT)
// ─────────────────────────────────────────────

/**
 * Initiate a transfer to an agent's bank account.
 *
 * IMPORTANT: Paystack transfers require OTP verification if enabled on your account.
 * For bulk/automated payouts, disable OTP in Paystack Dashboard:
 *   Settings → Transfers → Disable OTP for transfers
 *
 * @param recipientCode  - The recipient_code from createTransferRecipient
 * @param amountNaira    - Amount in NAIRA (not kobo — we convert internally)
 * @param reference      - Unique reference for this transfer (use our payout ID)
 * @param reason         - Description shown in agent's bank statement
 */
export async function initiateTransfer(
  recipientCode: string,
  amountNaira: number,
  reference: string,
  reason: string,
): Promise<PaystackTransferResponse['data']> {
  const amountKobo = Math.round(amountNaira * 100) // Paystack uses kobo

  const { data } = await paystackApi.post<PaystackTransferResponse>('/transfer', {
    source: 'balance',       // transfer from your Paystack balance
    reason,
    amount: amountKobo,
    recipient: recipientCode,
    reference,
    currency: 'NGN',
  })

  if (!data.status) {
    throw new Error(`Transfer failed: ${data.message}`)
  }

  return data.data
}

/**
 * Verify a transfer status.
 * Used to check if a payout transfer completed successfully.
 */
export async function verifyTransfer(transferCode: string): Promise<{
  status: string
  amount: number
  recipient: string
}> {
  const { data } = await paystackApi.get(`/transfer/${transferCode}`)

  if (!data.status) {
    throw new Error(`Failed to verify transfer: ${data.message}`)
  }

  return {
    status: data.data.status,
    amount: data.data.amount / 100, // convert kobo back to naira
    recipient: data.data.recipient.details.account_number,
  }
}

export default {
  verifyTransaction,
  verifyBankAccount,
  getBanks,
  createTransferRecipient,
  initiateTransfer,
  verifyTransfer,
}