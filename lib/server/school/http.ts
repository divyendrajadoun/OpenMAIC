/**
 * Small request helpers shared by the auth and school routes.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { apiError } from '@/lib/server/api-response';
import type { OwnerPrincipal } from '@/lib/server/identity';

import type { Membership } from './accounts';
import type { SchoolUser } from './accounts';

export type JsonObject = Record<string, unknown>;

/** The parsed JSON object body, or the 400 to answer with. */
export async function readJsonObject(
  req: NextRequest,
): Promise<{ ok: true; body: JsonObject } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: apiError('INVALID_REQUEST', 400, 'invalid JSON body') };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {
      ok: false,
      response: apiError('INVALID_REQUEST', 400, 'request body must be a JSON object'),
    };
  }
  return { ok: true, body: body as JsonObject };
}

export function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

/** The wire shape of an account, with no hash and no internal ids beyond its own. */
export function userResponse(user: SchoolUser, memberships: readonly Membership[]) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    memberships: memberships.map((membership) => ({
      schoolId: membership.schoolId,
      schoolName: membership.schoolName,
      schoolCode: membership.schoolCode,
      role: membership.role,
    })),
  };
}

/** The request owner is a signed-in account, else the 401 to answer with. */
export function requireAccount(
  principal: OwnerPrincipal,
  headers: Headers,
): NextResponse | undefined {
  if (principal.kind === 'user') return undefined;
  return NextResponse.json(
    { success: false, errorCode: 'UNAUTHENTICATED', error: 'sign in required' },
    { status: 401, headers },
  );
}
