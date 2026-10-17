/**
 * GET /api/school/[id] — one school as the caller sees it: the school, their
 * role, the classes (all of them for staff, their own for students), and for
 * admins the member list and open invites.
 *
 * A non-member gets the same plain 404 as a missing school.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { requireAccount } from '@/lib/server/school/http';
import { listInvites } from '@/lib/server/school/invites';
import {
  getSchool,
  isStaff,
  listClasses,
  listClassesForMember,
  listSchoolMembers,
  schoolAccess,
} from '@/lib/server/school/schools';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    const db = await getSchoolDb();
    const access = await schoolAccess(db, id, principal);
    const school = access ? await getSchool(db, id) : null;
    if (!access || !school) return ownerNotFound(headers);

    const staff = isStaff(access.role);
    const classes = staff
      ? await listClasses(db, id)
      : await listClassesForMember(db, id, access.userId);
    const members = access.role === 'admin' ? await listSchoolMembers(db, id) : undefined;
    const invites = access.role === 'admin' ? await listInvites(db, id) : undefined;
    return ownerJson(
      {
        school,
        role: access.role,
        classes,
        ...(members ? { members } : {}),
        ...(invites ? { invites } : {}),
      },
      200,
      headers,
    );
  });
}
