/**
 * GET /api/auth/me — the signed-in account, or `{ user: null }`.
 *
 * A present but unusable session cookie is cleared here (the owner seam
 * answers 401 for it everywhere else), so a browser whose session expired
 * recovers on its next page load instead of being locked out.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import {
  clearSessionCookieHeader,
  readSessionToken,
} from '@/lib/server/identity/host/school-session';
import { readSession } from '@/lib/server/school/accounts';
import { getSchoolDb } from '@/lib/server/school/db';
import { userResponse } from '@/lib/server/school/http';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isServerPersistenceConfigured()) {
    return NextResponse.json({ success: true, enabled: false, user: null });
  }

  const token = readSessionToken(req.headers);
  if (token === undefined) return NextResponse.json({ success: true, enabled: true, user: null });

  const session = token ? await readSession(await getSchoolDb(), token) : null;
  if (!session) {
    const response = NextResponse.json({ success: true, enabled: true, user: null });
    response.headers.append('Set-Cookie', clearSessionCookieHeader());
    return response;
  }
  return NextResponse.json({
    success: true,
    enabled: true,
    user: userResponse(session.user, session.memberships),
  });
}
