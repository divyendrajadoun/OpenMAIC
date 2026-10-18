/**
 * GET /api/school/[id]/questions/facets — distinct class / subject / chapter
 * combinations in the bank with counts, for the bank's filter menus. Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { listQuestionFacets } from '@/lib/server/school/questions';
import { requireStaff } from '@/lib/server/school/staff-access';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const facets = await listQuestionFacets(db, id);
    return ownerJson({ facets }, 200, headers);
  });
}
