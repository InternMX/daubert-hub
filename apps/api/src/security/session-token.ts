import { createHash, randomBytes } from 'node:crypto';

// 256 bits of entropy from Node's CSPRNG, base64url-encoded (URL/cookie-safe,
// no padding characters to escape). This raw value exists only transiently
// in memory and inside the HttpOnly cookie — it is never persisted.
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

// Only SHA-256(token) is ever persisted (security.sessions.token_hash).
// Session tokens are already high-entropy random values, not human-chosen
// secrets, so a fast general-purpose hash is the correct tool here — unlike
// passwords, they need no salt and no deliberately slow KDF.
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
