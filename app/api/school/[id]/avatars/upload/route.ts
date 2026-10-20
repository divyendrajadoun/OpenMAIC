/**
 * POST /api/school/[id]/avatars/upload — open a chunked footage upload.
 * Body: { filename, contentType, sizeBytes }. Returns { uploadId, chunkBytes }.
 * Chunks then go to PUT /api/school/[id]/avatars/upload/[uploadId]?index=n.
 *
 * Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { UPLOAD_CHUNK_BYTES, UPLOAD_MAX_BYTES } from '@/lib/school/avatar-types';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject } from '@/lib/server/school/http';
import { requireStaff } from '@/lib/server/school/staff-access';
import { createUpload } from '@/lib/server/school/uploads';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const FOOTAGE_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const filename = optionalString(parsed.body.filename, 120) ?? 'footage';
  const contentType = optionalString(parsed.body.contentType, 60)?.split(';')[0].trim() ?? '';
  const sizeBytes = Number(parsed.body.sizeBytes);

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    if (!FOOTAGE_TYPES.has(contentType)) {
      return ownerApiError('INVALID_REQUEST', 400, 'footage must be mp4, webm or mov', headers);
    }
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > UPLOAD_MAX_BYTES) {
      return ownerApiError('INVALID_REQUEST', 400, 'footage is too large', headers);
    }
    const uploadId = await createUpload(db, {
      ownerId: principal.ownerId,
      filename,
      contentType,
      sizeBytes,
    });
    return ownerJson({ uploadId, chunkBytes: UPLOAD_CHUNK_BYTES }, 201, headers);
  });
}
