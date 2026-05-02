/**
 * Mailer — Nodemailer email service
 *
 * Handles all outgoing emails:
 *   - Email verification on registration
 *   - Role switch confirmation
 *   - NYSC service year completion notification
 *   - Payment confirmation
 *
 * Uses Gmail SMTP (easiest to set up, no extra service needed).
 * In production, swap to Brevo/Resend/Mailgun for better deliverability.
 *
 * Required environment variables:
 *   SMTP_USER     = your Gmail address (e.g. hello@realtoba.ng)
 *   SMTP_PASS     = Gmail App Password (NOT your regular Gmail password)
 *                   Generate at: Google Account → Security → App Passwords
 *   SMTP_FROM     = "Realtoba <hello@realtoba.ng>"
 *   FRONTEND_URL  = https://your-frontend.vercel.app
 */
import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

const FROM = process.env.SMTP_FROM ?? `Realtoba <${process.env.SMTP_USER}>`
const FRONTEND = process.env.FRONTEND_URL ?? 'http://localhost:5173'

// ── Shared HTML wrapper ──
function layout(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #F8FAFC; margin: 0; padding: 0; }
    .wrap { max-width: 520px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: #0F766E; padding: 28px 32px; text-align: center; }
    .header h1 { color: white; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { color: rgba(255,255,255,0.75); margin: 4px 0 0; font-size: 13px; }
    .body { padding: 32px; }
    .body p { color: #475569; font-size: 15px; line-height: 1.7; margin: 0 0 16px; }
    .btn { display: inline-block; background: #0F766E; color: white !important; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 15px; margin: 8px 0 24px; }
    .code { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #0F766E; background: #F0FDF4; padding: 16px 24px; border-radius: 12px; text-align: center; margin: 16px 0; border: 2px dashed #0F766E; }
    .footer { padding: 20px 32px; border-top: 1px solid #F1F5F9; text-align: center; }
    .footer p { color: #94A3B8; font-size: 12px; margin: 0; }
    .warning { background: #FFF7ED; border: 1px solid #FED7AA; border-radius: 10px; padding: 12px 16px; margin: 16px 0; }
    .warning p { color: #9A3412; font-size: 13px; margin: 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>Realtoba</h1>
      <p>Nigeria's Trusted Property Platform</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Realtoba Broker Ltd. · Lagos, Nigeria</p>
      <p style="margin-top:4px">If you didn't create an account, please ignore this email.</p>
    </div>
  </div>
</body>
</html>`
}

// email verification
export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string,
): Promise<void> {
  const link = `${FRONTEND}/auth/verify-email?token=${token}`
  const html = layout(`
    <p>Hi <strong>${name}</strong></p>
    <p>Thank you for signing up to Realtoba! Please verify your email address to activate your account.</p>
    <div style="text-align:center">
      <a href="${link}" class="btn">Verify My Email</a>
    </div>
    <div class="warning">
      <p>This link expires in <strong>24 hours</strong>. After that, you'll need to request a new verification.</p>
    </div>
    <p>Or copy this link into your browser:<br/>
      <span style="font-size:12px;color:#64748B;word-break:break-all">${link}</span>
    </p>
  `)

  await transporter.sendMail({
    from: FROM, to, subject: '✉️ Verify your Realtoba email address', html,
  })
}

// role switching confirmation
export async function sendRoleSwitchEmail(
  to: string,
  name: string,
  newRole: string,
): Promise<void> {
  const roleLabel = newRole === 'agent' ? 'Property Agent' : 'Property Seeker'
  const html = layout(`
    <p>Hi <strong>${name}</strong>,</p>
    <p>Your Realtoba account role has been updated to:</p>
    <div class="code">${roleLabel}</div>
    <p>You can now access all features available to <strong>${newRole}s</strong> on the platform.</p>
    <p>If you did not make this change, please contact us immediately at <a href="mailto:hello@realtoba.ng">hello@realtoba.ng</a></p>
    <div style="text-align:center">
      <a href="${FRONTEND}" class="btn">Go to Dashboard</a>
    </div>
  `)
  await transporter.sendMail({
    from: FROM, to, subject: `Your Realtoba role has been updated to ${newRole}`, html,
  })
}

// nysc service year completion
export async function sendNYSCCompletionEmail(
  to: string,
  name: string,
): Promise<void> {
  const html = layout(`
    <p>Hi <strong>${name}</strong></p>
    <p>Congratulations on completing your NYSC service year!</p>
    <p>Your Realtoba account is ready for its next chapter. You can now upgrade to:</p>
    <ul style="color:#475569;font-size:15px;line-height:2">
      <li><strong>Property Agent</strong> — List properties, earn commissions, grow your business</li>
      <li><strong>Property Seeker</strong> — Continue browsing and renting properties</li>
    </ul>
    <p>Log in to your profile page to choose your new role. You'll need to provide additional credentials if switching to Agent.</p>
    <div style="text-align:center">
      <a href="${FRONTEND}/profile" class="btn">Choose My New Role</a>
    </div>
  `)
  await transporter.sendMail({
    from: FROM, to, subject: '🎓 Congratulations! Your NYSC year is complete — choose your new role', html,
  })
}

// payment confirmation
export async function sendPaymentConfirmationEmail(
  to: string,
  name: string,
  propertyTitle: string,
  amount: string,
  reference: string,
): Promise<void> {
  const html = layout(`
    <p>Hi <strong>${name}</strong>,</p>
    <p>We've successfully received your payment for:</p>
    <div class="code" style="font-size:16px;letter-spacing:0">${propertyTitle}</div>
    <p><strong>Amount:</strong> ₦${amount}<br/>
    <strong>Reference:</strong> <code style="background:#F1F5F9;padding:2px 6px;border-radius:4px">${reference}</code></p>
    <div class="warning">
      <p>Your payment is held safely in escrow. Our team will contact you to confirm the deal before releasing funds to the agent. If anything falls through, you will be fully refunded.</p>
    </div>
    <p>Have questions? Message us on the platform or email <a href="mailto:hello@realtoba.ng">hello@realtoba.ng</a></p>
  `)
  await transporter.sendMail({
    from: FROM, to, subject: `💳 Payment received — ${propertyTitle}`, html,
  })
}

export async function verifyMailer(): Promise<boolean> {
  try {
    await transporter.verify()
    return true
  } catch {
    return false
  }
}