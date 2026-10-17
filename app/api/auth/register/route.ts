/**
 * POST /api/auth/register — create an account, optionally joining a school
 * through an invite code, and sign it in.
 *
 * Not owner-scoped: it mints the credential the owner seam later reads.
 * Gated on server persistence like every account route (404 without a
 * database).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { apiError } from '@/lib/server/api-response';
import { sessionCookieHeader } from '@/lib/server/identity/host/school-session';
import {
  EMAIL_MAX_LENGTH,
  EmailTakenError,
  NAME_MAX_LENGTH,
  createSession,
  createUser,
  isUsableEmail,
  listMemberships,
  normalizeEmail,
} from '@/lib/server/school/accounts';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject, userResponse } from '@/lib/server/school/http';
import { redeemInvite } from '@/lib/server/school/invites';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/server/school/passwords';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const name = optionalString(body.name, NAME_MAX_LENGTH);
  const emailRaw = optionalString(body.email, EMAIL_MAX_LENGTH);
  const password = typeof body.password === 'string' ? body.password : undefined;
  const inviteCode = optionalString(body.inviteCode, 32);

  if (!name) return apiError('MISSING_REQUIRED_FIELD', 400, 'name is required');
  const email = emailRaw ? normalizeEmail(emailRaw) : '';
  if (!isUsableEmail(email)) return apiError('INVALID_REQUEST', 400, 'a valid email is required');
  if (!password || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return apiError(
      'INVALID_REQUEST',
      400,
      `password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`,
    );
  }

  const db = await getSchoolDb();
  if (inviteCode) {
    // Checked before the account exists so a bad code does not leave an
    // orphan account behind.
    const invite = await redeemInvite(db, inviteCode, { dryRun: true });
    if (!invite) return apiError('INVALID_REQUEST', 400, 'invite code is invalid or used up');
  }

  let user;
  try {
    user = await createUser(db, { name, email, password });
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return apiError('INVALID_REQUEST', 409, 'this email is already registered');
    }
    throw error;
  }

  if (inviteCode) {
    const invite = await redeemInvite(db, inviteCode, { dryRun: false, userId: user.id });
    if (!invite) return apiError('INVALID_REQUEST', 400, 'invite code is invalid or used up');
  }

  const token = await createSession(db, user.id);
  const memberships = await listMemberships(db, user.id);
  const response = NextResponse.json(
    { success: true, user: userResponse(user, memberships) },
    { status: 201 },
  );
  response.headers.append('Set-Cookie', sessionCookieHeader(token));
  return response;
}
