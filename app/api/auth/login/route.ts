/**
 * POST /api/auth/login — sign an existing account in.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { apiError } from '@/lib/server/api-response';
import { sessionCookieHeader } from '@/lib/server/identity/host/school-session';
import {
  EMAIL_MAX_LENGTH,
  createSession,
  listMemberships,
  verifyLogin,
} from '@/lib/server/school/accounts';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject, userResponse } from '@/lib/server/school/http';
import { PASSWORD_MAX_LENGTH } from '@/lib/server/school/passwords';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const email = optionalString(parsed.body.email, EMAIL_MAX_LENGTH);
  const password = typeof parsed.body.password === 'string' ? parsed.body.password : '';
  if (!email || !password || password.length > PASSWORD_MAX_LENGTH) {
    return apiError('INVALID_CREDENTIALS', 401, 'wrong email or password');
  }

  const db = await getSchoolDb();
  const user = await verifyLogin(db, email, password);
  if (!user) return apiError('INVALID_CREDENTIALS', 401, 'wrong email or password');

  const token = await createSession(db, user.id);
  const memberships = await listMemberships(db, user.id);
  const response = NextResponse.json({ success: true, user: userResponse(user, memberships) });
  response.headers.append('Set-Cookie', sessionCookieHeader(token));
  return response;
}
