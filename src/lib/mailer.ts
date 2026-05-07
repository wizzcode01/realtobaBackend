import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = 'Realtoba <noreply@realtoba.com>'
// const FROM = 'Realtoba <onboarding@resend.dev>'
const FRONTEND = process.env.FRONTEND_URL ?? 'https://realtoba.com'

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Realtoba</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F8FAFC;padding:40px 16px}
    .wrap{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .hdr{background:#0F766E;padding:28px 32px;text-align:center}
    .hdr h1{color:#fff;font-size:22px;font-weight:700;letter-spacing:-.5px;margin-bottom:4px}
    .hdr p{color:rgba(255,255,255,.7);font-size:13px}
    .body{padding:32px}
    .body p{color:#475569;font-size:15px;line-height:1.7;margin-bottom:16px}
    .body p:last-child{margin-bottom:0}
    .btn{display:inline-block;background:#0F766E;color:#fff!important;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px;margin:8px 0 24px}
    .code{font-size:36px;font-weight:800;letter-spacing:8px;color:#0F766E;background:#F0FDF4;padding:20px 24px;border-radius:12px;text-align:center;margin:16px 0;border:2px dashed #0F766E;font-family:monospace}
    .info{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px 16px;margin:16px 0}
    .info p{color:#475569;font-size:13px;margin:0}
    .warn{background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:12px 16px;margin:16px 0}
    .warn p{color:#9A3412;font-size:13px;margin:0}
    .footer{padding:20px 32px;border-top:1px solid #F1F5F9;text-align:center}
    .footer p{color:#94A3B8;font-size:12px;line-height:1.6}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hdr">
      <h1>Realtoba</h1>
      <p>Nigeria's Trusted Property Platform</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Realtoba Broker Ltd · Lagos, Nigeria</p>
      <p>If you didn't request this email, you can safely ignore it.</p>
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
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: 'Verify your Realtoba email address',
    html: layout(`
      <p>Hi <strong>${name}</strong></p>
      <p>Welcome to Realtoba! Enter this 6-digit code to verify your email address and activate your account.</p>
      <div class="code">${token}</div>
      <div class="warn">
        <p>This code expires in <strong>24 hours</strong>. Do not share it with anyone.</p>
      </div>
      <p>If you didn't create a Realtoba account, please ignore this email.</p>
    `),
  })
  if (error) throw new Error(`sendVerificationEmail failed: ${error.message}`)
}


export async function sendWelcomeEmail(
  to: string,
  name: string,
  role: string,
): Promise<void> {
  const roleLabel =
    role === 'agent' ? 'Property Agent' :
      role === 'nysc' ? 'NYSC Corps Member' :
        'Property Seeker'

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: 'Welcome to Realtoba!',
    html: layout(`
      <p>Hi <strong>${name}</strong></p>
      <p>Your email is verified and your Realtoba account is ready. You've joined as a <strong>${roleLabel}</strong>.</p>
      ${role === 'nysc' ? `
      <div class="info">
        <p><strong>NYSC Benefit Active:</strong> You automatically get 20% off on eligible property listings. Look for the green "NYSC 20% Off" badge on listings.</p>
      </div>` : ''}
      ${role === 'seeker' ? `
      <div class="info">
        <p>Start browsing thousands of verified properties across Nigeria. Use the search bar to find homes near your location.</p>
      </div>` : ''}
      ${role === 'agent' ? `
      <div class="info">
        <p>You can now upload property listings. Each listing goes through admin review before going live — usually within 24 hours.</p>
      </div>` : ''}
      <p style="text-align:center">
        <a href="${FRONTEND}" class="btn">Go to My Dashboard →</a>
      </p>
      <p>Need help? Reply to this email or message us through the platform.</p>
    `),
  })
  if (error) throw new Error(`sendWelcomeEmail failed: ${error.message}`)
}

// role switching confirmation
export async function sendRoleSwitchEmail(
  to: string,
  name: string,
  newRole: string,
): Promise<void> {
  const roleLabel = newRole === 'agent' ? 'Property Agent' : 'Property Seeker'
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Your Realtoba role has been updated`,
    html: layout(`
    <p>Hi <strong>${name}</strong>,</p>
      <p>Your account role has been successfully updated to:</p>
      <div class="code" style="font-size:20px;letter-spacing:0">${roleLabel}</div>
      <p>You can now access all features available to <strong>${newRole}s</strong> on the platform.</p>
      <div class="warn">
        <p>If you did not make this change, contact us immediately at <a href="mailto:support@realtoba.com">support@realtoba.com</a></p>
      </div>
      <p style="text-align:center">
        <a href="${FRONTEND}" class="btn">Go to Dashboard →</a>
      </p>
  `),
  })
  if (error) throw new Error(`sendRoleSwitchEmail failed: ${error.message}`)
}

// nysc service year completion
export async function sendNYSCCompletionEmail(
  to: string,
  name: string,
): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: 'Your NYSC service year is complete — choose your next role',
    html: layout(`
    <p>Hi <strong>${name}</strong></p>
      <p>Congratulations on completing your NYSC service year! Your one-year journey with Realtoba is now complete.</p>
      <p>You can now upgrade your account to:</p>
      <div class="info">
        <p><strong>Property Agent</strong> — List properties, earn commissions, grow your real estate business. (Requires NIN and business details)</p>
        <p style="margin-top:10px"><strong>Property Seeker</strong> — Continue browsing and renting properties across Nigeria.</p>
      </div>
      <p>Log in to your profile page to choose your new role.</p>
      <p style="text-align:center">
        <a href="${FRONTEND}/profile" class="btn">Choose My New Role →</a>
      </p>
  `),
  })

  if (error) throw new Error(`sendNYSCCompletionEmail failed: ${error.message}`)

}

// payment confirmation
export async function sendPaymentConfirmationEmail(
  to: string,
  name: string,
  propertyTitle: string,
  amount: string,
  reference: string,
): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `💳 Payment received — ${propertyTitle}`,
    html: layout(`
     <p>Hi <strong>${name}</strong>,</p>
      <p>We've received your payment for:</p>
      <div class="info">
        <p><strong>Property:</strong> ${propertyTitle}</p>
        <p style="margin-top:8px"><strong>Amount:</strong> ₦${amount}</p>
        <p style="margin-top:8px"><strong>Reference:</strong> <code style="background:#F1F5F9;padding:2px 6px;border-radius:4px;font-size:12px">${reference}</code></p>
      </div>
      <div class="warn">
        <p><strong>Your money is safe in escrow.</strong> Our team will contact you to confirm the deal. Once you confirm, payment is released to the agent. If the deal falls through, you receive a full refund.</p>
      </div>
      <p>Questions? Message us directly on the platform or reply to this email.</p>
      <p style="text-align:center">
        <a href="${FRONTEND}/payment/history" class="btn">View Transaction →</a>
      </p>
  `),
  })
  if (error) throw new Error(`sendPaymentConfirmationEmail failed: ${error.message}`)
}

export async function sendListingSubmittedEmail(
  to: string,
  agentName: string,
  propertyTitle: string,
): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Your listing "${propertyTitle}" is under review`,
    html: layout(`
      <p>Hi <strong>${agentName}</strong>,</p>
      <p>Your property listing has been submitted successfully and is now under review by the Realtoba admin team.</p>
      <div class="info">
        <p><strong>Property:</strong> ${propertyTitle}</p>
        <p style="margin-top:8px"><strong>Status:</strong> Pending Review</p>
        <p style="margin-top:8px"><strong>Expected review time:</strong> Within 24 hours</p>
      </div>
      <p>Once approved, your listing will be visible to thousands of seekers and NYSC corps members on the platform. You will receive another email when your listing goes live.</p>
      <p style="text-align:center">
        <a href="${FRONTEND}/agent/listings" class="btn">View My Listings →</a>
      </p>
    `),
  })
  if (error) throw new Error(`sendListingSubmittedEmail failed: ${error.message}`)
}

export async function sendListingApprovedEmail(
  to: string,
  agentName: string,
  propertyTitle: string,
): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Your listing "${propertyTitle}" is now LIVE!`,
    html: layout(`
      <p>Hi <strong>${agentName}</strong></p>
      <p>Great news! Your property listing has been approved and is now <strong>live on Realtoba</strong>.</p>
      <div class="info">
        <p><strong>Property:</strong> ${propertyTitle}</p>
        <p style="margin-top:8px"><strong>Status:</strong> ✅ Live and visible to seekers</p>
      </div>
      <p>Seekers and NYSC corps members can now find, save, and contact you about this property. Make sure your messages are turned on so you don't miss any inquiries.</p>
      <p style="text-align:center">
        <a href="${FRONTEND}/agent/listings" class="btn">View My Listings →</a>
      </p>
    `),
  })
  if (error) throw new Error(`sendListingApprovedEmail failed: ${error.message}`)
}

export async function sendListingRejectedEmail(
  to: string,
  agentName: string,
  propertyTitle: string,
  reason: string,
): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `Your listing "${propertyTitle}" needs attention`,
    html: layout(`
      <p>Hi <strong>${agentName}</strong>,</p>
      <p>Your property listing could not be approved at this time.</p>
      <div class="info">
        <p><strong>Property:</strong> ${propertyTitle}</p>
        <p style="margin-top:8px"><strong>Reason:</strong> ${reason}</p>
      </div>
      <p>Please update your listing to address the issue above and resubmit. If you believe this is a mistake, contact our support team.</p>
      <p style="text-align:center">
        <a href="${FRONTEND}/agent/listings" class="btn">Edit My Listing →</a>
      </p>
    `),
  })
  if (error) throw new Error(`sendListingRejectedEmail failed: ${error.message}`)
}


export async function verifyMailer(): Promise<boolean> {
  try {
    return !!process.env.RESEND_API_KEY
  } catch {
    return false
  }
}