/**
 * GET    /api/school/[id]/papers/[paperId] — one saved paper with its body.
 * DELETE /api/school/[id]/papers/[paperId] — remove it.
 *
 * Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { deletePaper, getPaper } from '@/lib/server/school/papers';
import { requireStaff } from '@/lib/server/school/staff-access';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; paperId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, paperId } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const paper = await getPaper(db, id, paperId);
    if (!paper) return ownerNotFound(headers);
    return ownerJson({ paper }, 200, headers);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, paperId } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const deleted = await deletePaper(db, id, paperId);
    if (!deleted) return ownerNotFound(headers);
    return ownerJson({ deleted: true }, 200, headers);
  });
}
