/**
 * POST /api/export-video/upload — open a chunked upload of a lesson's video
 * export bundle (the HyperFrames project zip), for rendering on HeyGen.
 * Body: { filename, sizeBytes }. Returns { uploadId, chunkBytes }. Chunks go
 * to PUT /api/export-video/upload/[uploadId]?index=n.
 */
import type { NextRequest } from 'next/server';

import { UPLOAD_CHUNK_BYTES } from '@/lib/school/avatar-types';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { isHeyGenRenderConfigured } from '@/lib/server/render-service';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject } from '@/lib/server/school/http';
import { createUpload } from '@/lib/server/school/uploads';

export const runtime = 'nodejs';

/** The same bound the render-service path applies to an export archive. */
const MAX_EXPORT_BYTES = 300 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!isHeyGenRenderConfigured()) return new Response('Not found', { status: 404 });
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const filename = optionalString(parsed.body.filename, 120) ?? 'project.zip';
  const sizeBytes = Number(parsed.body.sizeBytes);

  return withRequestOwner(req, async (principal, headers) => {
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_EXPORT_BYTES) {
      return ownerApiError('INVALID_REQUEST', 413, 'Export archive is too large', headers);
    }
    const db = await getSchoolDb();
    const uploadId = await createUpload(db, {
      ownerId: principal.ownerId,
      filename,
      contentType: 'application/zip',
      sizeBytes,
    });
    return ownerJson({ uploadId, chunkBytes: UPLOAD_CHUNK_BYTES }, 201, headers);
  });
}
