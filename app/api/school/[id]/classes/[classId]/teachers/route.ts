/**
 * POST /api/school/[id]/classes/[classId]/teachers — put a teacher on a class
 * by email. Admin only. The account must already be a teacher or admin of the
 * school (teachers join through an invite).
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { EMAIL_MAX_LENGTH, findUserByEmail } from '@/lib/server/school/accounts';
import { classAccess } from '@/lib/server/school/class-access';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject, requireAccount } from '@/lib/server/school/http';
import { addClassMember, isStaff, roleInSchool } from '@/lib/server/school/schools';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; classId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, classId } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const email = optionalString(parsed.body.email, EMAIL_MAX_LENGTH);

  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    if (!email) return ownerApiError('MISSING_REQUIRED_FIELD', 400, 'email is required', headers);
    const db = await getSchoolDb();
    const access = await classAccess(db, id, classId, principal);
    if (!access || access.role !== 'admin') return ownerNotFound(headers);

    const teacher = await findUserByEmail(db, email);
    const role = teacher ? await roleInSchool(db, id, teacher.id) : null;
    if (!teacher || !role || !isStaff(role)) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        'no teacher with that email in this school',
        headers,
      );
    }
    await addClassMember(db, classId, teacher.id, 'teacher');
    return ownerJson(
      { teacher: { userId: teacher.id, name: teacher.name, email: teacher.email } },
      200,
      headers,
    );
  });
}
