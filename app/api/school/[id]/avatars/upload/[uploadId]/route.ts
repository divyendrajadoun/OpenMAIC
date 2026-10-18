/**
 * PUT /api/school/[id]/avatars/upload/[uploadId]?index=n — one raw chunk of a
 * footage upload opened by POST /api/school/[id]/avatars/upload. Only the
 * teacher who opened the upload may add to it.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { UPLOAD_CHUNK_BYTES } from '@/lib/school/avatar-types';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { requireStaff } from '@/lib/server/school/staff-access';
import { getUpload, putChunk } from '@/lib/server/school/uploads';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; uploadId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, uploadId } = await params;
  const index = Number(req.nextUrl.searchParams.get('index'));
  const bytes = new Uint8Array(await req.arrayBuffer());

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const upload = await getUpload(db, uploadId);
    if (!upload || upload.schoolId !== id || upload.userId !== staff.access.userId) {
      return ownerNotFound(headers);
    }
    if (!Number.isInteger(index) || index < 0 || bytes.byteLength === 0) {
      return ownerApiError('INVALID_REQUEST', 400, 'chunk index and body are required', headers);
    }
    if (bytes.byteLength > UPLOAD_CHUNK_BYTES) {
      return ownerApiError('INVALID_REQUEST', 413, 'chunk is too large', headers);
    }
    await putChunk(db, uploadId, index, bytes);
    return ownerJson({ received: bytes.byteLength }, 200, headers);
  });
}
