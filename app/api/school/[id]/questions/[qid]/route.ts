/**
 * DELETE /api/school/[id]/questions/[qid] — remove a question from the bank. Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { deleteQuestion } from '@/lib/server/school/questions';
import { requireStaff } from '@/lib/server/school/staff-access';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; qid: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, qid } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const deleted = await deleteQuestion(db, id, qid);
    if (!deleted) return ownerNotFound(headers);
    return ownerJson({ deleted: true }, 200, headers);
  });
}
