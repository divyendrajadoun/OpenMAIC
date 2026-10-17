/**
 * POST /api/school/[id]/classes — create a class { name, grade?, section? }.
 * Staff only. The creating teacher is added as the class teacher.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject, requireAccount } from '@/lib/server/school/http';
import {
  CLASS_NAME_MAX_LENGTH,
  addClassMember,
  createClass,
  isStaff,
  schoolAccess,
} from '@/lib/server/school/schools';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const name = optionalString(parsed.body.name, CLASS_NAME_MAX_LENGTH);
  const grade = optionalString(parsed.body.grade, 20);
  const section = optionalString(parsed.body.section, 20);

  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    if (!name) return ownerApiError('MISSING_REQUIRED_FIELD', 400, 'name is required', headers);
    const db = await getSchoolDb();
    const access = await schoolAccess(db, id, principal);
    if (!access || !isStaff(access.role)) return ownerNotFound(headers);

    const klass = await createClass(db, {
      schoolId: id,
      name,
      ...(grade ? { grade } : {}),
      ...(section ? { section } : {}),
    });
    if (access.role === 'teacher') await addClassMember(db, klass.id, access.userId, 'teacher');
    return ownerJson({ class: klass }, 201, headers);
  });
}
