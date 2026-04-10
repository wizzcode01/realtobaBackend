import { createClient } from '@supabase/supabase-js'
const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.\n' +
      'Copy .env.example to .env and fill in your Supabase service role credentials.',
  )
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    headers: {
      'x-app-name': 'realtoba-backend',
    },
  },
})

/**
 * Helper: get a user from Supabase by Firebase UID.
 * Returns null if not found.
 */
export async function getUserByFirebaseUid(firebaseUid: string) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, name, email, role, is_admin')
    .eq('firebase_uid', firebaseUid)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null
    throw new Error(`getUserByFirebaseUid: ${error.message}`)
  }

  return data
}

/**
 * Helper: log every admin action for audit trail.
 * Never throws — audit logging failure should not break the main action.
 */
export async function logAdminAction(
  adminId: string,
  action: string,
  targetId: string,
  targetType: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await supabaseAdmin.from('admin_audit_log').insert({
      admin_id: adminId,
      action,
      target_id: targetId,
      target_type: targetType,
      metadata: metadata ?? {},
    })
  } catch (err) {
    console.error('Failed to write audit log:', err)
  }
}

export default supabaseAdmin