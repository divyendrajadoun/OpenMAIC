/**
 * GET /api/lessons/[stageId]/avatar-clips — the avatar clips of a lesson, for
 * the classroom player: { clips, avatar, counts }. Clips still rendering are
 * checked with HeyGen on the way. Any signed-in account may ask; a lesson's
 * id is already what grants access to the lesson itself.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { requireAccount } from '@/lib/server/school/http';
import { clipsView, syncLessonClips } from '@/lib/server/school/lesson-clips';

export const runtime = 'nodejs';

type Params = { params: Promise<{ stageId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { stageId } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    const db = await getSchoolDb();
    const rows = await syncLessonClips(db, stageId);
    return ownerJson(await clipsView(db, rows), 200, headers);
  });
}
