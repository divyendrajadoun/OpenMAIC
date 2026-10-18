/**
 * POST /api/school/[id]/avatars/[avatarId]/consent — start HeyGen's recorded
 * consent for a digital twin. Returns { url }: the teacher opens it and records
 * a short statement on camera; the link is valid for 24 hours.
 *
 * Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { createConsent } from '@/lib/server/heygen';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getAvatar, updateAvatar } from '@/lib/server/school/avatars';
import { getSchoolDb } from '@/lib/server/school/db';
import { heygenFailure } from '@/lib/server/school/heygen-response';
import { requireStaff } from '@/lib/server/school/staff-access';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; avatarId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, avatarId } = await params;
  const origin = req.headers.get('origin') ?? req.nextUrl.origin;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const avatar = await getAvatar(db, id, avatarId);
    if (!avatar) return ownerNotFound(headers);
    if (!avatar.groupId) {
      return ownerApiError('INVALID_REQUEST', 400, 'this avatar has no consent step', headers);
    }
    try {
      const consent = await createConsent(avatar.groupId, `${origin}/teach/avatar?consent=done`);
      const consentStatus = consent.avatar_group?.consent_status ?? avatar.consentStatus;
      if (consentStatus !== avatar.consentStatus)
        await updateAvatar(db, avatar.id, { consentStatus });
      if (!consent.url) {
        return ownerApiError('UPSTREAM_ERROR', 502, 'HeyGen returned no consent link', headers);
      }
      return ownerJson({ url: consent.url }, 200, headers);
    } catch (error) {
      return heygenFailure(error, headers);
    }
  });
}
