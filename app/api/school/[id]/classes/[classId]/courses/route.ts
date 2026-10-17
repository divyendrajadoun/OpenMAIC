/**
 * /api/school/[id]/classes/[classId]/courses — assign a course to a class.
 *
 * POST { stageId } assigns one the caller owns; DELETE { stageId } removes an
 * assignment. Admin of the school or teacher of the class. Once assigned, the
 * course appears in every class member's library through the school library
 * hook (`lib/server/school/hooks.ts`).
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { classAccess } from '@/lib/server/school/class-access';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject, requireAccount } from '@/lib/server/school/http';
import {
  assignCourse,
  listClassCourses,
  stageOwner,
  unassignCourse,
} from '@/lib/server/school/schools';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; classId: string }> };

async function withManagedClass(
  req: NextRequest,
  params: Params['params'],
  body: (
    context: { db: Awaited<ReturnType<typeof getSchoolDb>>; userId: string; classId: string },
    headers: Headers,
  ) => Promise<Response>,
) {
  const { id, classId } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    const db = await getSchoolDb();
    const access = await classAccess(db, id, classId, principal);
    if (!access?.canManage) return ownerNotFound(headers);
    return body({ db, userId: access.userId, classId }, headers);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const stageId = optionalString(parsed.body.stageId, 128);
  return withManagedClass(req, params, async ({ db, userId, classId }, headers) => {
    if (!stageId) {
      return ownerApiError('MISSING_REQUIRED_FIELD', 400, 'stageId is required', headers);
    }
    const owner = await stageOwner(db, stageId);
    if (!owner || owner !== `user:${userId}`) {
      return ownerApiError('INVALID_REQUEST', 400, 'you can only assign a course you own', headers);
    }
    await assignCourse(db, classId, stageId, userId);
    return ownerJson({ courses: await listClassCourses(db, classId) }, 201, headers);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const stageId = optionalString(parsed.body.stageId, 128);
  return withManagedClass(req, params, async ({ db, classId }, headers) => {
    if (!stageId) {
      return ownerApiError('MISSING_REQUIRED_FIELD', 400, 'stageId is required', headers);
    }
    await unassignCourse(db, classId, stageId);
    return ownerJson({ courses: await listClassCourses(db, classId) }, 200, headers);
  });
}
