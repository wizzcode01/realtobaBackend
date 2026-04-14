/**
 * Messaging Routes
 *
 * GET  /api/messages/conversations         — User's conversations
 * GET  /api/messages/conversations/:id     — Messages in a conversation
 * POST /api/messages/conversations/:id     — Send a message
 * POST /api/messages/conversations/start   — Start a conversation with agent
 *
 * Real-time delivery is handled by Supabase Realtime on the frontend.
 * The backend handles writes and reads for security and audit purposes.
 * Admin can view all conversations via /api/admin/* routes.
 *
 * Message security:
 *   - Users can only read/write their own conversations
 *   - Admin can read all conversations
 *   - Content is trimmed and max 2000 chars
 *   - No HTML allowed (prevents XSS injection)
 */

// import { Router, Request, Response } from 'express'
// import { body, validationResult } from 'express-validator'
// import { requireAuth } from '../middleware/auth.js'
// import { messageLimiter } from '../middleware/rateLimiter.js'
// import { supabaseAdmin } from '../lib/supabase.js'

// const router = Router()
// router.use(requireAuth)

// // get users conversations
// router.get('/conversations', async (req: Request, res: Response): Promise<void> => {
//   const user = (req as Request & { user: { userId: string; isAdmin?: boolean } }).user

//   try {
//     let query

//     if (user.isAdmin) {
//       // Admin sees all conversations
//       query = supabaseAdmin
//         .from('conversations')
//         .select(`
//           *,
//           participant:users!conversations_participant_user_id_fkey(id, name, email, role, avatar_url),
//           latest_message:messages(content, created_at, sender_type)
//         `)
//         .order('updated_at', { ascending: false })
//     } else {
//       // Users see only their own conversations
//       query = supabaseAdmin
//         .from('conversations')
//         .select(`
//           *,
//           participant:users!conversations_participant_user_id_fkey(id, name, email, role, avatar_url),
//           latest_message:messages(content, created_at, sender_type)
//         `)
//         .eq('participant_user_id', user.userId)
//         .order('updated_at', { ascending: false })
//     }

//     const { data, error } = await query

//     if (error) throw error

//     res.json({ success: true, data: data ?? [] })
//   } catch (err) {
//     console.error('Get conversations error:', err)
//     res.status(500).json({ success: false, error: 'Failed to fetch conversations.' })
//   }
// })

// // get message in a conversation
// router.get('/conversations/:id/messages', async (req: Request, res: Response): Promise<void> => {
//   const { id } = req.params
//   const user = (req as Request & { user: { userId: string; isAdmin?: boolean } }).user
//   const page = Math.max(0, Number(req.query.page ?? 0))

//   try {
//     // Security: verify user has access to this conversation
//     if (!user.isAdmin) {
//       const { data: conversation } = await supabaseAdmin
//         .from('conversations')
//         .select('participant_user_id')
//         .eq('id', id)
//         .single()

//       if (!conversation || (conversation as { participant_user_id: string }).participant_user_id !== user.userId) {
//         res.status(403).json({ success: false, error: 'Access denied.' })
//         return
//       }
//     }

//     const { data, error } = await supabaseAdmin
//       .from('messages')
//       .select('*, sender:users(id, name, avatar_url, role)')
//       .eq('conversation_id', id)
//       .order('created_at', { ascending: false })
//       .range(page * 50, (page + 1) * 50 - 1)

//     if (error) throw error

//     // Mark messages as read
//     await supabaseAdmin
//       .from('messages')
//       .update({ is_read: true })
//       .eq('conversation_id', id)
//       .neq('sender_id', user.userId)
//       .eq('is_read', false)

//     res.json({ success: true, data: (data ?? []).reverse() }) // oldest first
//   } catch (err) {
//     console.error('Get messages error:', err)
//     res.status(500).json({ success: false, error: 'Failed to fetch messages.' })
//   }
// })

// // send a message
// router.post(
//   '/conversations/:id/messages',
//   messageLimiter,
//   [
//     body('content')
//       .notEmpty()
//       .withMessage('Message cannot be empty')
//       .isLength({ max: 2000 })
//       .withMessage('Message too long (max 2000 characters)')
//       .trim()
//       // Strip HTML tags to prevent XSS
//       .customSanitizer((v: string) => v.replace(/<[^>]*>/g, '')),
//   ],
//   async (req: Request, res: Response): Promise<void> => {
//     const errors = validationResult(req)
//     if (!errors.isEmpty()) {
//       res.status(400).json({ success: false, error: errors.array()[0].msg })
//       return
//     }

//     const { id } = req.params
//     const user = (req as Request & { user: { userId: string; isAdmin?: boolean } }).user
//     const { content } = req.body as { content: string }

//     try {
//       // Security: verify user has access to this conversation
//       if (!user.isAdmin) {
//         const { data: conversation } = await supabaseAdmin
//           .from('conversations')
//           .select('participant_user_id')
//           .eq('id', id)
//           .single()

//         if (!conversation || (conversation as { participant_user_id: string }).participant_user_id !== user.userId) {
//           res.status(403).json({ success: false, error: 'Access denied.' })
//           return
//         }
//       }

//       // Determine sender type (admin, agent, or user)
//       let senderType: 'admin' | 'agent' | 'user' = 'user'
//       if (user.isAdmin) {
//         senderType = 'admin'
//       } else {
//         const { data: senderInfo } = await supabaseAdmin
//           .from('users')
//           .select('role')
//           .eq('id', user.userId)
//           .single()

//         if ((senderInfo as { role?: string } | null)?.role === 'agent') {
//           senderType = 'agent'
//         }
//       }

//       // Insert message
//       const { data: message, error: msgError } = await supabaseAdmin
//         .from('messages')
//         .insert({
//           conversation_id: id,
//           sender_id: user.userId,
//           sender_type: senderType,
//           content: content.trim(),
//           is_read: false,
//           is_system: false,
//         })
//         .select('*, sender:users(id, name, avatar_url)')
//         .single()

//       if (msgError) throw msgError

//       // Update conversation updated_at for sorting
//       await supabaseAdmin
//         .from('conversations')
//         .update({ updated_at: new Date().toISOString() })
//         .eq('id', id)

//       res.status(201).json({ success: true, data: message })
//     } catch (err) {
//       console.error('Send message error:', err)
//       res.status(500).json({ success: false, error: 'Failed to send message.' })
//     }
//   },
// )

// // ─────────────────────────────────────────────
// // START A CONVERSATION (client or agent initiates)
// // Creates a conversation with admin, or with an agent for a specific property
// // ─────────────────────────────────────────────
// router.post(
//   '/conversations/start',
//   messageLimiter,
//   [
//     body('type').isIn(['user_admin', 'agent_admin', 'agent_client']).withMessage('Invalid conversation type'),
//     body('otherUserId').optional().isUUID(),
//     body('propertyId').optional().isUUID(),
//     body('initialMessage').notEmpty().trim().isLength({ max: 2000 }),
//   ],
//   async (req: Request, res: Response): Promise<void> => {
//     const errors = validationResult(req)
//     if (!errors.isEmpty()) {
//       res.status(400).json({ success: false, error: errors.array()[0].msg })
//       return
//     }

//     const user = (req as Request & { user: { userId: string } }).user
//     const { type, otherUserId, propertyId, initialMessage } = req.body as {
//       type: 'user_admin' | 'agent_admin' | 'agent_client'
//       otherUserId?: string
//       propertyId?: string
//       initialMessage: string
//     }

//     try {
//       // Check if conversation already exists
//       let conversationQuery = supabaseAdmin
//         .from('conversations')
//         .select('id')
//         .eq('participant_user_id', user.userId)
//         .eq('type', type)

//       if (propertyId) {
//         conversationQuery = conversationQuery.eq('property_id', propertyId)
//       }

//       const { data: existing } = await conversationQuery.single()

//       let conversationId: string

//       if (existing) {
//         conversationId = (existing as { id: string }).id
//       } else {
//         // Create new conversation
//         const { data: created, error: createError } = await supabaseAdmin
//           .from('conversations')
//           .insert({
//             participant_user_id: user.userId,
//             other_user_id: otherUserId ?? null,
//             property_id: propertyId ?? null,
//             type,
//           })
//           .select()
//           .single()

//         if (createError) throw createError
//         conversationId = (created as { id: string }).id
//       }

//       // Determine sender type from user role
//       const { data: senderUser } = await supabaseAdmin
//         .from('users')
//         .select('role')
//         .eq('id', user.userId)
//         .single()

//       const senderType = (senderUser as { role?: string } | null)?.role === 'agent' ? 'agent' : 'user'

//       // Only send initial message if this is a new conversation
//       let message = null
//       if (!existing) {
//         const { data: msg, error: msgError } = await supabaseAdmin
//           .from('messages')
//           .insert({
//             conversation_id: conversationId,
//             sender_id: user.userId,
//             sender_type: senderType,
//             content: initialMessage.trim().replace(/<[^>]*>/g, ''),
//             is_read: false,
//             is_system: false,
//           })
//           .select()
//           .single()

//         if (msgError) throw msgError
//         message = msg
//       }

//       await supabaseAdmin
//         .from('conversations')
//         .update({ updated_at: new Date().toISOString() })
//         .eq('id', conversationId)

//       res.status(201).json({
//         success: true,
//         data: { conversationId, message },
//       })
//     } catch (err) {
//       console.error('Start conversation error:', err)
//       res.status(500).json({ success: false, error: 'Failed to start conversation.' })
//     }
//   },
// )

// // ─────────────────────────────────────────────
// // UNREAD COUNT — for badge notifications
// // ─────────────────────────────────────────────
// router.get('/unread-count', async (req: Request, res: Response): Promise<void> => {
//   const user = (req as Request & { user: { userId: string } }).user

//   try {
//     const { count, error } = await supabaseAdmin
//       .from('messages')
//       .select('id', { count: 'exact' })
//       .eq('is_read', false)
//       .neq('sender_id', user.userId)
//       .in(
//         'conversation_id',
//         (
//           await supabaseAdmin
//             .from('conversations')
//             .select('id')
//             .eq('participant_user_id', user.userId)
//         ).data?.map((c: { id: string }) => c.id) ?? [],
//       )

//     if (error) throw error

//     res.json({ success: true, data: { unreadCount: count ?? 0 } })
//   } catch (err) {
//     console.error('Unread count error:', err)
//     res.status(500).json({ success: false, error: 'Failed to get unread count.' })
//   }
// })

// export default router

/**
 * Messaging Routes
 *
 * GET  /api/messages/conversations         — User's conversations
 * GET  /api/messages/conversations/:id     — Messages in a conversation
 * POST /api/messages/conversations/:id     — Send a message
 * POST /api/messages/conversations/start   — Start a conversation with agent
 *
 * Real-time delivery is handled by Supabase Realtime on the frontend.
 * The backend handles writes and reads for security and audit purposes.
 * Admin can view all conversations via /api/admin/* routes.
 *
 * Message security:
 *   - Users can only read/write their own conversations
 *   - Admin can read all conversations
 *   - Content is trimmed and max 2000 chars
 *   - No HTML allowed (prevents XSS injection)
 */
import { Router, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { requireAuth } from '../middleware/auth.js'
import { messageLimiter } from '../middleware/rateLimiter.js'
import { supabaseAdmin } from '../lib/supabase.js'

const router = Router()
router.use(requireAuth)

// ─────────────────────────────────────────────
// GET USER'S CONVERSATIONS
// ─────────────────────────────────────────────
router.get('/conversations', async (req: Request, res: Response): Promise<void> => {
  const user = (req as Request & { user: { userId: string; isAdmin?: boolean } }).user

  try {
    let query

    if (user.isAdmin) {
      // Admin sees all conversations
      query = supabaseAdmin
        .from('conversations')
        .select(`
          *,
          participant:users!conversations_participant_user_id_fkey(id, name, email, role, avatar_url),
          latest_message:messages(content, created_at, sender_type)
        `)
        .order('updated_at', { ascending: false })
    } else {
      // Users/agents see conversations where they are either the
      // main participant OR the other participant (agent side of agent_client)
      query = supabaseAdmin
        .from('conversations')
        .select(`
          *,
          participant:users!conversations_participant_user_id_fkey(id, name, email, role, avatar_url),
          latest_message:messages(content, created_at, sender_type)
        `)
        .or(`participant_user_id.eq.${user.userId},other_user_id.eq.${user.userId}`)
        .order('updated_at', { ascending: false })
    }

    const { data, error } = await query

    if (error) throw error

    res.json({ success: true, data: data ?? [] })
  } catch (err) {
    console.error('Get conversations error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch conversations.' })
  }
})

// ─────────────────────────────────────────────
// GET MESSAGES IN A CONVERSATION
// ─────────────────────────────────────────────
router.get('/conversations/:id/messages', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const user = (req as Request & { user: { userId: string; isAdmin?: boolean } }).user
  const page = Math.max(0, Number(req.query.page ?? 0))

  try {
    // Security: verify user has access to this conversation
    if (!user.isAdmin) {
      const { data: conversation } = await supabaseAdmin
        .from('conversations')
        .select('participant_user_id')
        .eq('id', id)
        .single()

      if (!conversation || (conversation as { participant_user_id: string }).participant_user_id !== user.userId) {
        res.status(403).json({ success: false, error: 'Access denied.' })
        return
      }
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('*, sender:users(id, name, avatar_url, role)')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .range(page * 50, (page + 1) * 50 - 1)

    if (error) throw error

    // Mark messages as read
    await supabaseAdmin
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', id)
      .neq('sender_id', user.userId)
      .eq('is_read', false)

    res.json({ success: true, data: (data ?? []).reverse() }) // oldest first
  } catch (err) {
    console.error('Get messages error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch messages.' })
  }
})

// ─────────────────────────────────────────────
// SEND A MESSAGE
// ─────────────────────────────────────────────
router.post(
  '/conversations/:id/messages',
  messageLimiter,
  [
    body('content')
      .notEmpty()
      .withMessage('Message cannot be empty')
      .isLength({ max: 2000 })
      .withMessage('Message too long (max 2000 characters)')
      .trim()
      // Strip HTML tags to prevent XSS
      .customSanitizer((v: string) => v.replace(/<[^>]*>/g, '')),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: errors.array()[0].msg })
      return
    }

    const { id } = req.params
    const user = (req as Request & { user: { userId: string; isAdmin?: boolean } }).user
    const { content } = req.body as { content: string }

    try {
      // Security: user must be participant OR other_user (agent side of agent_client)
      if (!user.isAdmin) {
        const { data: conversation } = await supabaseAdmin
          .from('conversations')
          .select('participant_user_id, other_user_id')
          .eq('id', id)
          .single()

        const conv = conversation as { participant_user_id: string; other_user_id?: string } | null
        const hasAccess = conv?.participant_user_id === user.userId || conv?.other_user_id === user.userId
        if (!conv || !hasAccess) {
          res.status(403).json({ success: false, error: 'Access denied.' })
          return
        }
      }

      // Determine sender type based on role
      let senderType: 'admin' | 'agent' | 'user' = 'user'
      if (user.isAdmin) {
        senderType = 'admin'
      } else {
        const { data: senderInfo } = await supabaseAdmin
          .from('users').select('role').eq('id', user.userId).single()
        if ((senderInfo as { role?: string } | null)?.role === 'agent') {
          senderType = 'agent'
        }
      }

      // Insert message
      const { data: message, error: msgError } = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: id,
          sender_id: user.userId,
          sender_type: senderType,
          content: content.trim(),
          is_read: false,
          is_system: false,
        })
        .select('*, sender:users(id, name, avatar_url)')
        .single()

      if (msgError) throw msgError

      // Update conversation updated_at for sorting
      await supabaseAdmin
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id)

      res.status(201).json({ success: true, data: message })
    } catch (err) {
      console.error('Send message error:', err)
      res.status(500).json({ success: false, error: 'Failed to send message.' })
    }
  },
)

// ─────────────────────────────────────────────
// START A CONVERSATION (client or agent initiates)
// Creates a conversation with admin, or with an agent for a specific property
// ─────────────────────────────────────────────
router.post(
  '/conversations/start',
  messageLimiter,
  [
    body('type').isIn(['user_admin', 'agent_admin', 'agent_client']).withMessage('Invalid conversation type'),
    body('otherUserId').optional({ nullable: true }).isString().isLength({ min: 1, max: 100 }).withMessage('Invalid agent ID'),
    body('propertyId').optional({ nullable: true }).isString().isLength({ min: 1, max: 100 }).withMessage('Invalid property ID'),
    body('initialMessage').notEmpty().withMessage('Message cannot be empty').trim().isLength({ max: 2000 }).withMessage('Message too long'),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({ success: false, error: errors.array()[0].msg })
      return
    }

    const user = (req as Request & { user: { userId: string } }).user
    const { type, otherUserId, propertyId, initialMessage } = req.body as {
      type: 'user_admin' | 'agent_client'
      otherUserId?: string
      propertyId?: string
      initialMessage: string
    }

    try {
      // Check if conversation already exists
      let conversationQuery = supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('participant_user_id', user.userId)
        .eq('type', type)

      if (propertyId) {
        conversationQuery = conversationQuery.eq('property_id', propertyId)
      }

      const { data: existing } = await conversationQuery.single()

      let conversationId: string

      if (existing) {
        conversationId = (existing as { id: string }).id
      } else {
        // Create new conversation
        const { data: created, error: createError } = await supabaseAdmin
          .from('conversations')
          .insert({
            participant_user_id: user.userId,
            other_user_id: otherUserId ?? null,
            property_id: propertyId ?? null,
            type,
          })
          .select()
          .single()

        if (createError) throw createError
        conversationId = (created as { id: string }).id
      }

      // Determine sender type from user role
      const { data: senderUser } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('id', user.userId)
        .single()

      const senderType = (senderUser as { role?: string } | null)?.role === 'agent' ? 'agent' : 'user'

      // Only send initial message if this is a NEW conversation
      // (returning existing conversation — don't duplicate the intro message)
      let message = null
      if (!existing) {
        const { data: msg, error: msgError } = await supabaseAdmin
          .from('messages')
          .insert({
            conversation_id: conversationId,
            sender_id: user.userId,
            sender_type: senderType,
            content: initialMessage.trim().replace(/<[^>]*>/g, ''),
            is_read: false,
            is_system: false,
          })
          .select()
          .single()

        if (msgError) throw msgError
        message = msg
      }

      await supabaseAdmin
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId)

      res.status(201).json({
        success: true,
        data: { conversationId, message },
      })
    } catch (err) {
      console.error('Start conversation error:', err)
      res.status(500).json({ success: false, error: 'Failed to start conversation.' })
    }
  },
)

// ─────────────────────────────────────────────
// UNREAD COUNT — for badge notifications
// ─────────────────────────────────────────────
router.get('/unread-count', async (req: Request, res: Response): Promise<void> => {
  const user = (req as Request & { user: { userId: string } }).user

  try {
    const { count, error } = await supabaseAdmin
      .from('messages')
      .select('id', { count: 'exact' })
      .eq('is_read', false)
      .neq('sender_id', user.userId)
      .in(
        'conversation_id',
        (
          await supabaseAdmin
            .from('conversations')
            .select('id')
            .eq('participant_user_id', user.userId)
        ).data?.map((c: { id: string }) => c.id) ?? [],
      )

    if (error) throw error

    res.json({ success: true, data: { unreadCount: count ?? 0 } })
  } catch (err) {
    console.error('Unread count error:', err)
    res.status(500).json({ success: false, error: 'Failed to get unread count.' })
  }
})

export default router
