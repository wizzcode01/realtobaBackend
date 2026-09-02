import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'

import { generalLimiter } from './middleware/rateLimiter.js'
import paymentRoutes from './routes/payments.js'
import adminRoutes from './routes/admin.js'
import messageRoutes from './routes/messages.js'
import authRoutes from './routes/auth.js'
import referralRoutes, { walletRouter } from './routes/referrals.js'

const app = express()
const PORT = process.env.PORT ?? 5000

// Helmet sets secure HTTP headers (prevents clickjacking, XSS, etc.)
app.use(helmet())

const allowedOrigins: (string | RegExp)[] = [
  // Always allow any localhost port (dev + staging testing)
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
]
 
// Add production frontend URL if set
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL)
  const wwwVersion = process.env.FRONTEND_URL.replace('https://', 'https://www.')
  if (wwwVersion !== process.env.FRONTEND_URL) {
    allowedOrigins.push(wwwVersion)
  }
}
// Also allow any Vercel preview URLs for the project
if (process.env.VERCEL_PROJECT) {
  allowedOrigins.push(new RegExp(`https:\/\/${process.env.VERCEL_PROJECT}.*\.vercel\.app$`))
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (Postman, mobile apps, curl, server-to-server)
      if (!origin) { callback(null, true); return }
 
      const allowed = allowedOrigins.some((o) =>
        typeof o === 'string' ? o === origin : o.test(origin),
      )
 
      if (allowed) {
        callback(null, true)
      } else {
        console.warn(`CORS blocked origin: ${origin}`)
        callback(new Error(`CORS: Origin ${origin} not allowed`))
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-paystack-signature'],
  }),
)

// Apply general rate limiter to all routes
app.use(generalLimiter)

// Request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// Webhook route — raw buffer needed for signature verification
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
)

// All other routes — parsed JSON
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.use('/api/payments', paymentRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/referrals', referralRoutes)
app.use('/api/wallet', walletRouter)

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  })
})


app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('Unhandled error:', err)

    // Don't expose internal error details in production
    const message =
      process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message

    res.status(500).json({ success: false, error: message })
  },
)

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' })
})

if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(() => {
      fetch(`${process.env.RENDER_EXTERNAL_URL}/health`)
        .catch(() => {})
    }, 14 * 60 * 1000)
    console.log('Keep-alive ping enabled for Render deployment')
  }

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`)
})

export default app
