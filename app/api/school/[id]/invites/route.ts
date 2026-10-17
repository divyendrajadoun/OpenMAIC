/**
 * POST /api/school/[id]/invites — mint an invite code.
 *
 * Admins may invite any role; a teacher may invite students into a class they
 * teach. Body: { role, classId?, maxUses?, expiresInDays? }.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { isSchoolRole } from '@/lib/server/school/db';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject, requireAccount } from '@/lib/server/school/http';
import { createInvite } from '@/lib/server/school/invites';
import { getClass, isClassTeacher, schoolAccess } from '@/lib/server/school/schools';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

function positiveInt(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    return undefined;
  }
  return value;
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const role = parsed.body.role;
  const classId = optionalString(parsed.body.classId, 64);
  const maxUses = positiveInt(parsed.body.maxUses, 10_000);
  const expiresInDays = positiveInt(parsed.body.expiresInDays, 365);

  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    if (!isSchoolRole(role)) {
      return ownerApiError('INVALID_REQUEST', 400, 'role must be a school role', headers);
    }
    const db = await getSchoolDb();
    const access = await schoolAccess(db, id, principal);
    if (!access) return ownerNotFound(headers);

    if (classId) {
      const klass = await getClass(db, classId);
      if (!klass || klass.schoolId !== id) {
        return ownerApiError('INVALID_REQUEST', 400, 'unknown class', headers);
      }
    }
    const allowed =
      access.role === 'admin' ||
      (access.role === 'teacher' &&
        role === 'student' &&
        !!classId &&
        (await isClassTeacher(db, classId, access.userId)));
    if (!allowed) return ownerNotFound(headers);

    const invite = await createInvite(db, {
      schoolId: id,
      role,
      ...(classId ? { classId } : {}),
      createdBy: access.userId,
      ...(maxUses === undefined ? {} : { maxUses }),
      ...(expiresInDays === undefined ? {} : { expiresInDays }),
    });
    return ownerJson({ invite }, 201, headers);
  });
}
