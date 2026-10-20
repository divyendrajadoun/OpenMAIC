/**
 * PUT /api/export-video/upload/[uploadId]?index=n — one raw chunk of an export
 * bundle opened by POST /api/export-video/upload, from the same owner.
 */
import type { NextRequest } from 'next/server';

import { UPLOAD_CHUNK_BYTES } from '@/lib/school/avatar-types';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { isHeyGenRenderConfigured } from '@/lib/server/render-service';
import { getSchoolDb } from '@/lib/server/school/db';
import { getUpload, putChunk } from '@/lib/server/school/uploads';

export const runtime = 'nodejs';

type Params = { params: Promise<{ uploadId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  if (!isHeyGenRenderConfigured()) return new Response('Not found', { status: 404 });
  const { uploadId } = await params;
  const index = Number(req.nextUrl.searchParams.get('index'));
  const bytes = new Uint8Array(await req.arrayBuffer());

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const upload = await getUpload(db, uploadId);
    if (!upload || upload.ownerId !== principal.ownerId) return ownerNotFound(headers);
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
