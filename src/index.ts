import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'

import { generalLimiter } from './middleware/rateLimiter.js'
import paymentRoutes from './routes/payments.js'
import adminRoutes from './routes/admin.js'
import messageRoutes from './routes/messages.js'

const app = express()
const PORT = process.env.PORT ?? 5000

// Helmet sets secure HTTP headers (prevents clickjacking, XSS, etc.)
app.use(helmet())

// CORS — only allow requests from your frontend
const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:5174',
  'http://localhost:5174'
]

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman in dev)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: Origin ${origin} not allowed`))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-paystack-signature'],
}

app.use(
  cors(corsOptions),
)
app.options(/.*/, cors(corsOptions))

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

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  })
})

// ─────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// Catches any unhandled errors from route handlers
// ─────────────────────────────────────────────
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

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`)
})

export default app
