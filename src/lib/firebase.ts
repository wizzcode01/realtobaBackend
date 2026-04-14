import admin from 'firebase-admin'
import type { Auth } from 'firebase-admin/auth'

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY

if (!projectId || !clientEmail || !privateKey) {
  throw new Error(
    'Missing Firebase Admin credentials in environment variables.\n' +
      'Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in .env',
  )
}

// Prevent re-initialisation during hot reload in development
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      // The private key comes from .env as a string with \n literals.
      // We replace \\n with actual newlines to make it valid PEM format.
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  })
}

export const firebaseAdmin = admin
export const auth: Auth = admin.auth()

/**
 * Verify a Firebase ID token and return the decoded claims.
 * Throws if the token is invalid, expired, or malformed.
 */
export async function verifyIdToken(token: string): Promise<admin.auth.DecodedIdToken> {
  return auth.verifyIdToken(token)
}

export default admin