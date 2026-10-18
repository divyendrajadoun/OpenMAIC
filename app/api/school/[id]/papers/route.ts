/**
 * GET  /api/school/[id]/papers — saved papers, newest first.
 * POST /api/school/[id]/papers — save a paper. Body: { paper }.
 *
 * Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { readJsonObject } from '@/lib/server/school/http';
import { listPapers, savePaper } from '@/lib/server/school/papers';
import { requireStaff } from '@/lib/server/school/staff-access';
import { parsePaper } from '@/lib/school/question-types';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const papers = await listPapers(db, id);
    return ownerJson({ papers }, 200, headers);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const paper = parsePaper(parsed.body.paper);

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    if (!paper) return ownerApiError('INVALID_REQUEST', 400, 'paper is not well-formed', headers);
    const saved = await savePaper(db, { schoolId: id, createdBy: staff.access.userId, paper });
    return ownerJson({ paper: saved }, 201, headers);
  });
}
