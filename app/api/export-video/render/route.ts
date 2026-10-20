import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { proxyFetch } from '@/lib/server/proxy-fetch';
import { resolveRenderServiceUrl } from '@/lib/server/render-service';
import { capBodyStream } from '@/lib/server/capped-stream';
import { clientIdentity } from '@/lib/server/client-identity';
import { createLogger } from '@/lib/logger';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { createHyperframesRender, uploadAsset } from '@/lib/server/heygen';
import { heygenJobId } from '@/lib/server/hyperframes-jobs';
import { isHeyGenRenderConfigured } from '@/lib/server/render-service';
import { getSchoolDb } from '@/lib/server/school/db';
import { heygenFailure } from '@/lib/server/school/heygen-response';
import { optionalString, readJsonObject } from '@/lib/server/school/http';
import { assembleUpload, deleteUpload, getUpload } from '@/lib/server/school/uploads';

const log = createLogger('ExportVideo Render API');

// Only forwards the upload to the isolated render service; the render itself
// happens there, so this route stays lightweight despite large ZIP bodies. The
// budget must cover *uploading* up to MAX_UPLOAD_BYTES over a slow link (a
// 300 MB body needs ~40 Mbps to finish in 60s), not the render — so it's sized
// for the transfer, well above the old 60s.
export const maxDuration = 300;

/** Reject uploads larger than this (compressed ZIP bytes), enforced on real bytes. */
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

/** Upload-forwarding budget. Covers a large body over a slow link; the render is async. */
const SUBMIT_TIMEOUT_MS = 300_000;

/**
 * Submit an export ZIP for MP4 rendering. Streams the multipart body straight
 * to the render service (no `formData()` buffering here) and relays its
 * `202 { jobId }`. Returns 501 when the service is not configured so the client
 * can degrade to a local ZIP download.
 */
/**
 * The HeyGen path: the bundle arrived in chunks (POST /api/export-video/upload)
 * and is handed to HeyGen's HyperFrames renderer here.
 * Body: { uploadId, fps?, quality?, resolution?, title? }.
 */
async function submitToHeyGen(req: NextRequest) {
  if (!isHeyGenRenderConfigured()) {
    return apiError('PROVIDER_DISABLED', 501, 'Render service is not configured');
  }
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const uploadId = optionalString(parsed.body.uploadId, 80);
  const fps = Math.min(Math.max(Math.round(Number(parsed.body.fps) || 30), 1), 60);
  const quality = (['draft', 'standard', 'high'] as const).find((q) => q === parsed.body.quality);
  const resolution = parsed.body.resolution === '4k' ? '4k' : '1080p';
  const title = optionalString(parsed.body.title, 200) ?? 'Lesson video';

  return withRequestOwner(req, async (principal, headers) => {
    if (!uploadId) return ownerApiError('INVALID_REQUEST', 400, 'uploadId is required', headers);
    const db = await getSchoolDb();
    const upload = await getUpload(db, uploadId);
    if (!upload || upload.ownerId !== principal.ownerId) return ownerNotFound(headers);
    let bundle: Uint8Array;
    try {
      bundle = await assembleUpload(db, upload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upload incomplete';
      return ownerApiError('INVALID_REQUEST', 400, message, headers);
    }
    try {
      const assetId = await uploadAsset({
        filename: upload.filename,
        contentType: 'application/zip',
        bytes: bundle,
      });
      const renderId = await createHyperframesRender({
        assetId,
        fps,
        quality: quality ?? 'standard',
        resolution,
        title,
      });
      await deleteUpload(db, uploadId);
      return ownerJson({ jobId: heygenJobId(renderId), pollIntervalMs: 5000 }, 202, headers);
    } catch (error) {
      return heygenFailure(error, headers);
    }
  });
}

export async function POST(req: NextRequest) {
  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    return submitToHeyGen(req);
  }
  const resolved = resolveRenderServiceUrl();
  if ('error' in resolved) {
    return apiError('PROVIDER_DISABLED', 501, 'Render service is not configured');
  }

  // Fast-path reject an oversized body by its declared length. This is only a
  // courtesy 413 for honest clients — `Content-Length` is client-supplied and
  // omitted on chunked uploads, so the real bound is the byte-counting cap on
  // the stream below (belt-and-suspenders with the service's own archive guards).
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return apiError('INVALID_REQUEST', 413, 'Export archive is too large');
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data') || !req.body) {
    return apiError('INVALID_REQUEST', 400, 'Expected multipart/form-data');
  }

  // Forward the raw multipart body verbatim, bounded to MAX_UPLOAD_BYTES of
  // actual bytes. We deliberately do NOT parse it: the render service derives
  // identity from the header below and ignores any multipart `userId`, so
  // there's nothing to strip — and re-parsing would defeat the streaming bound.
  const capped = capBodyStream(req.body, MAX_UPLOAD_BYTES);

  try {
    // Long enough for the upload of a multi-MB ZIP; the render is async.
    const upstream = await proxyFetch(`${resolved.url}/render`, {
      method: 'POST',
      body: capped.stream,
      // duplex is required to send a streaming request body via fetch.
      duplex: 'half',
      headers: {
        'content-type': contentType,
        'x-openmaic-client': clientIdentity(req),
      },
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    } as RequestInit);

    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    if (!upstream.ok) {
      const detail = typeof data.error === 'string' ? data.error : upstream.statusText;
      const status = upstream.status === 429 ? 429 : upstream.status === 413 ? 413 : 502;
      const code =
        upstream.status === 429
          ? 'RATE_LIMITED'
          : upstream.status === 413
            ? 'INVALID_REQUEST'
            : 'UPSTREAM_ERROR';
      // Keep admission reasons separate from diagnostic prose so clients can
      // localize known rejections and fall back for older/newer services.
      const reason =
        upstream.status === 429 &&
        (data.reason === 'queue_full' || data.reason === 'per_identity_limit')
          ? data.reason
          : undefined;
      return apiError(code, status, 'Render service rejected the request', detail, reason);
    }

    return apiSuccess({ jobId: data.jobId, pollIntervalMs: 3000 }, 202);
  } catch (error) {
    // A cap trip aborts the forwarded stream, surfacing here as a fetch error.
    if (capped.exceeded()) {
      return apiError('INVALID_REQUEST', 413, 'Export archive is too large');
    }
    log.error('Failed to submit render job:', error);
    return apiError(
      'UPSTREAM_ERROR',
      502,
      'Failed to reach render service',
      error instanceof Error ? error.message : String(error),
    );
  }
}
