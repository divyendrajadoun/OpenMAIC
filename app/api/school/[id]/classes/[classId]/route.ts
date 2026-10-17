/**
 * GET /api/school/[id]/classes/[classId] — the class, its roster and its
 * assigned courses. Any school member who belongs to the class, or any staff.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { classAccess } from '@/lib/server/school/class-access';
import { getSchoolDb } from '@/lib/server/school/db';
import { requireAccount } from '@/lib/server/school/http';
import { isStaff, listClassCourses, listClassMembers } from '@/lib/server/school/schools';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; classId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, classId } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    const db = await getSchoolDb();
    const access = await classAccess(db, id, classId, principal);
    if (!access) return ownerNotFound(headers);
    const members = await listClassMembers(db, classId);
    const isMember = members.some((member) => member.userId === access.userId);
    if (!isStaff(access.role) && !isMember) return ownerNotFound(headers);
    const courses = await listClassCourses(db, classId);
    return ownerJson(
      {
        class: access.klass,
        canManage: access.canManage,
        // Students see names only; staff see the login ids they hand out.
        members: isStaff(access.role)
          ? members
          : members.map(({ userId, name, role }) => ({ userId, name, role })),
        courses,
      },
      200,
      headers,
    );
  });
}
