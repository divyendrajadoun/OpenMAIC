/**
 * POST /api/school/[id]/avatars/twin — train a digital twin from uploaded
 * footage. Body: { uploadId, name? }. The footage is reassembled from its
 * chunks, handed to HeyGen, and the twin starts training; the new avatar row
 * is returned in `training` state. Consent is collected afterwards through
 * POST /api/school/[id]/avatars/[avatarId]/consent.
 *
 * Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { createDigitalTwin, uploadAsset } from '@/lib/server/heygen';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { findUserById } from '@/lib/server/school/accounts';
import { insertAvatar, stateFromHeyGen } from '@/lib/server/school/avatars';
import { getSchoolDb } from '@/lib/server/school/db';
import { heygenFailure } from '@/lib/server/school/heygen-response';
import { optionalString, readJsonObject } from '@/lib/server/school/http';
import { requireStaff } from '@/lib/server/school/staff-access';
import { assembleUpload, deleteUpload, getUpload } from '@/lib/server/school/uploads';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const uploadId = optionalString(parsed.body.uploadId, 80);
  const requestedName = optionalString(parsed.body.name, 60);

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    if (!uploadId) return ownerApiError('INVALID_REQUEST', 400, 'uploadId is required', headers);
    const upload = await getUpload(db, uploadId);
    if (!upload || upload.ownerId !== principal.ownerId) {
      return ownerNotFound(headers);
    }

    let footage: Uint8Array;
    try {
      footage = await assembleUpload(db, upload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upload incomplete';
      return ownerApiError('INVALID_REQUEST', 400, message, headers);
    }

    const user = await findUserById(db, staff.access.userId);
    const name = requestedName ?? user?.name ?? 'My twin';
    try {
      const assetId = await uploadAsset({
        filename: upload.filename,
        contentType: upload.contentType,
        bytes: footage,
      });
      const created = await createDigitalTwin({ name, assetId });
      const avatar = await insertAvatar(db, {
        schoolId: id,
        ownerUserId: staff.access.userId,
        name,
        kind: 'twin',
        look: created.avatar_item,
        voiceId:
          created.avatar_item.default_voice_id ?? created.avatar_group?.default_voice_id ?? null,
        state: stateFromHeyGen(created.avatar_item, created.avatar_group ?? null, 'twin'),
      });
      await deleteUpload(db, uploadId);
      return ownerJson({ avatar }, 201, headers);
    } catch (error) {
      return heygenFailure(error, headers);
    }
  });
}
