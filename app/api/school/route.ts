/**
 * /api/school — the signed-in account's schools.
 *
 * GET lists them with the caller's role; POST creates one and makes the caller
 * its admin. Owner-scoped through the identity seam; an anonymous owner is
 * told to sign in.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { listMemberships, userIdFromOwnerId } from '@/lib/server/school/accounts';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject, requireAccount } from '@/lib/server/school/http';
import { SCHOOL_NAME_MAX_LENGTH, createSchool } from '@/lib/server/school/schools';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    const db = await getSchoolDb();
    const memberships = await listMemberships(db, userIdFromOwnerId(principal.ownerId)!);
    return ownerJson({ schools: memberships }, 200, headers);
  });
}

export async function POST(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const name = optionalString(parsed.body.name, SCHOOL_NAME_MAX_LENGTH);
  const board = optionalString(parsed.body.board, 40);
  const language = optionalString(parsed.body.language, 20);

  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    if (!name) return ownerApiError('MISSING_REQUIRED_FIELD', 400, 'name is required', headers);
    const db = await getSchoolDb();
    const school = await createSchool(db, {
      name,
      ...(board ? { board } : {}),
      ...(language ? { language } : {}),
      createdBy: userIdFromOwnerId(principal.ownerId)!,
    });
    return ownerJson({ school }, 201, headers);
  });
}
