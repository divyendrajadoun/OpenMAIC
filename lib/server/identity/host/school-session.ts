/**
 * The School of AI account method: a session cookie backed by
 * `school_sessions` (see `lib/server/school/accounts.ts`).
 *
 * - Cookie absent: `not-applicable`, so a visitor without an account keeps the
 *   anonymous owner the core fallback mints (a free trial that is claimed into
 *   the account on sign-in).
 * - Cookie present but unknown or expired: `invalid` (a 401), as the contract
 *   requires. `/api/auth/me` and `/api/auth/logout` clear such a cookie so the
 *   browser recovers on its next page load.
 *
 * This is the only file that reads or writes the session cookie, so the auth
 * routes import the helpers below rather than parsing it themselves.
 */
import type {
  OwnerAuthMethod,
  OwnerAuthMethodResult,
  OwnerAuthRequest,
  StoredOwnerDescription,
} from '@/lib/server/identity';
import { readSession, userIdFromOwnerId } from '@/lib/server/school/accounts';
import { getSchoolDb } from '@/lib/server/school/db';

export const SESSION_COOKIE = 'soai_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

/** Same rule as the anonymous owner cookie: `Secure` in production unless COOKIE_SECURE=0. */
function cookieSecure(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== '0';
}

export function sessionCookieHeader(token: string): string {
  const secure = cookieSecure() ? '; Secure' : '';
  return (
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}${secure}`
  );
}

export function clearSessionCookieHeader(): string {
  const secure = cookieSecure() ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** The raw session token a request carries, or `undefined` when absent or malformed. */
export function readSessionToken(headers: Headers): string | undefined {
  const encoded = headers.get('cookie');
  if (!encoded) return undefined;
  for (const item of encoded.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = item.slice(separator + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : '';
  }
  return undefined;
}

async function authenticate(req: OwnerAuthRequest): Promise<OwnerAuthMethodResult> {
  const token = readSessionToken(req.headers);
  if (token === undefined) return { status: 'not-applicable' };
  if (token === '') return { status: 'invalid', reason: 'malformed session cookie' };
  const session = await readSession(await getSchoolDb(), token);
  if (!session) return { status: 'invalid', reason: 'unknown or expired session' };
  return { status: 'authenticated', principal: session.principal };
}

function describeStoredOwner(ownerId: string): StoredOwnerDescription | undefined {
  return userIdFromOwnerId(ownerId) ? { kind: 'user' } : undefined;
}

export const schoolSessionAuthMethod: OwnerAuthMethod = {
  name: 'schoolSession',
  authenticate,
  describeStoredOwner,
};
