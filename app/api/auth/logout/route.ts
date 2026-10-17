/**
 * POST /api/auth/logout — drop the session and clear its cookie. Always
 * succeeds: an unknown or malformed cookie is cleared just the same.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import {
  clearSessionCookieHeader,
  readSessionToken,
} from '@/lib/server/identity/host/school-session';
import { deleteSession } from '@/lib/server/school/accounts';
import { getSchoolDb } from '@/lib/server/school/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });

  const token = readSessionToken(req.headers);
  if (token) await deleteSession(await getSchoolDb(), token);
  const response = NextResponse.json({ success: true });
  response.headers.append('Set-Cookie', clearSessionCookieHeader());
  return response;
}
