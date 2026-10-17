/**
 * POST /api/school/join { inviteCode } — join a school with an invite as an
 * existing, signed-in account.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { listMemberships, userIdFromOwnerId } from '@/lib/server/school/accounts';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject, requireAccount } from '@/lib/server/school/http';
import { redeemInvite } from '@/lib/server/school/invites';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const inviteCode = optionalString(parsed.body.inviteCode, 32);

  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    if (!inviteCode) {
      return ownerApiError('MISSING_REQUIRED_FIELD', 400, 'inviteCode is required', headers);
    }
    const db = await getSchoolDb();
    const userId = userIdFromOwnerId(principal.ownerId)!;
    const invite = await redeemInvite(db, inviteCode, { dryRun: false, userId });
    if (!invite) {
      return ownerApiError('INVALID_REQUEST', 400, 'invite code is invalid or used up', headers);
    }
    return ownerJson({ schools: await listMemberships(db, userId) }, 200, headers);
  });
}
