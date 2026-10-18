/**
 * GET  /api/school/[id]/avatars — the school's avatars, with HeyGen state refreshed
 *      for any still training or awaiting consent.
 * POST /api/school/[id]/avatars — add a HeyGen look (library or from the connected
 *      account). Body: { lookId } or { groupId } (its first look), plus voiceId?, name?.
 *
 * Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { getGroup, getLook, listLooks, mapLimit, type HeyGenLook } from '@/lib/server/heygen';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import {
  insertAvatar,
  kindForLook,
  listAvatars,
  refreshAvatar,
  stateFromHeyGen,
} from '@/lib/server/school/avatars';
import { getSchoolDb } from '@/lib/server/school/db';
import { heygenFailure } from '@/lib/server/school/heygen-response';
import { optionalString, readJsonObject } from '@/lib/server/school/http';
import { requireStaff } from '@/lib/server/school/staff-access';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** A library character's first finished look, landscape when there is one. */
async function firstLook(groupId: string): Promise<HeyGenLook | null> {
  const result = await listLooks({ ownership: 'public', groupId, limit: 20 });
  const completed = result.data.filter((look) => look.status === 'completed');
  return (
    completed.find((look) => look.preferred_orientation === 'landscape') ?? completed[0] ?? null
  );
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const avatars = await mapLimit(await listAvatars(db, id), 4, (avatar) =>
      refreshAvatar(db, avatar).catch(() => avatar),
    );
    return ownerJson({ avatars }, 200, headers);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const lookId = optionalString(parsed.body.lookId, 80);
  const groupId = optionalString(parsed.body.groupId, 80);
  const voiceId = optionalString(parsed.body.voiceId, 80) ?? null;
  const name = optionalString(parsed.body.name, 60);

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    if (!lookId && !groupId) {
      return ownerApiError('INVALID_REQUEST', 400, 'lookId or groupId is required', headers);
    }
    try {
      const look = lookId ? await getLook(lookId) : await firstLook(groupId as string);
      if (!look)
        return ownerApiError('INVALID_REQUEST', 400, 'that presenter has no look', headers);
      const group = look.group_id ? await getGroup(look.group_id).catch(() => null) : null;
      const kind = kindForLook(look);
      const avatar = await insertAvatar(db, {
        schoolId: id,
        ownerUserId: staff.access.userId,
        name: name ?? look.name,
        kind,
        look,
        voiceId: voiceId ?? look.default_voice_id ?? group?.default_voice_id ?? null,
        state: stateFromHeyGen(look, group, kind),
      });
      return ownerJson({ avatar }, 201, headers);
    } catch (error) {
      return heygenFailure(error, headers);
    }
  });
}
