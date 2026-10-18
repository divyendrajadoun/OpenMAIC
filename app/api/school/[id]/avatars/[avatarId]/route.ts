/**
 * GET    /api/school/[id]/avatars/[avatarId] — one avatar, state refreshed from HeyGen.
 * DELETE /api/school/[id]/avatars/[avatarId] — forget the avatar (its lesson clips go with it).
 *
 * Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { deleteAvatar, getAvatar, refreshAvatar } from '@/lib/server/school/avatars';
import { getSchoolDb } from '@/lib/server/school/db';
import { heygenFailure } from '@/lib/server/school/heygen-response';
import { requireStaff } from '@/lib/server/school/staff-access';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; avatarId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, avatarId } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const avatar = await getAvatar(db, id, avatarId);
    if (!avatar) return ownerNotFound(headers);
    try {
      return ownerJson({ avatar: await refreshAvatar(db, avatar) }, 200, headers);
    } catch (error) {
      return heygenFailure(error, headers);
    }
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, avatarId } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const deleted = await deleteAvatar(db, id, avatarId);
    if (!deleted) return ownerNotFound(headers);
    return ownerJson({ deleted: true }, 200, headers);
  });
}
