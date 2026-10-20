/**
 * HeyGen v3 API client for the school features (digital twins, library
 * avatars, narrated lesson clips). The key is the deployment's
 * `VIDEO_HEYGEN_API_KEY`; teachers never bring their own.
 *
 * Only the calls the product makes are wrapped. Every call returns the `data`
 * envelope's content and throws {@link HeyGenError} with HeyGen's own message
 * on failure, which is safe to show a teacher.
 */

const BASE_URL = 'https://api.heygen.com';

export function isHeyGenConfigured(): boolean {
  return !!process.env.VIDEO_HEYGEN_API_KEY?.trim();
}

export class HeyGenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HeyGenError';
  }
}

export interface HeyGenLook {
  id: string;
  name: string;
  avatar_type: string;
  group_id: string | null;
  gender: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  default_voice_id: string | null;
  status: 'processing' | 'completed' | 'failed' | string;
  supported_api_engines?: string[];
  preferred_orientation?: string | null;
  error?: { code?: string; message?: string } | null;
}

export interface HeyGenGroup {
  id: string;
  name: string;
  gender?: string | null;
  status?: string;
  consent_status?: 'pending' | 'accepted' | 'rejected' | null;
  default_voice_id: string | null;
  preview_image_url: string | null;
  preview_video_url?: string | null;
  looks_count: number;
}

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  language: string;
  gender: string | null;
  preview_audio_url: string | null;
  type: string;
}

export type HeyGenVideoStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface HeyGenVideo {
  video_id?: string;
  id?: string;
  status: HeyGenVideoStatus;
  video_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  failure_code?: string | null;
  failure_message?: string | null;
}

interface Page<T> {
  data: T[];
  has_more?: boolean;
  next_token?: string | null;
}

type Query = Record<string, string | number | undefined>;

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Query; attempt?: number; raw?: boolean } = {},
): Promise<T> {
  const key = process.env.VIDEO_HEYGEN_API_KEY?.trim();
  if (!key) throw new HeyGenError('HeyGen is not configured on this server', 503);

  const url = new URL(path, BASE_URL);
  for (const [name, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
  }
  const headers: Record<string, string> = { 'X-Api-Key': key, Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (res.status === 429 && (init.attempt ?? 0) < 3) {
    const wait = Math.min(Number(res.headers.get('retry-after')) || 2, 15) * 1000;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return call<T>(path, { ...init, attempt: (init.attempt ?? 0) + 1 });
  }

  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string } | string | null;
    message?: string;
  };
  if (!res.ok) {
    const message =
      (typeof json.error === 'object' && json.error?.message) ||
      (typeof json.error === 'string' && json.error) ||
      json.message ||
      `HeyGen request failed (${res.status})`;
    const code = typeof json.error === 'object' ? json.error?.code : undefined;
    throw new HeyGenError(message, res.status, code);
  }
  // List endpoints carry `has_more` / `next_token` beside `data`; they ask for the whole envelope.
  return (init.raw ? json : (json.data ?? json)) as T;
}

// Avatars ---------------------------------------------------------------------

export function listLooks(query: {
  ownership: 'public' | 'private';
  limit?: number;
  token?: string;
  groupId?: string;
}): Promise<Page<HeyGenLook>> {
  return call<Page<HeyGenLook>>('/v3/avatars/looks', {
    raw: true,
    query: {
      ownership: query.ownership,
      limit: query.limit ?? 50,
      token: query.token,
      group_id: query.groupId,
    },
  });
}

/** Avatar groups are characters; the library lists one entry per presenter. */
export function listGroups(query: {
  ownership: 'public' | 'private';
  limit?: number;
  token?: string;
}): Promise<Page<HeyGenGroup>> {
  return call<Page<HeyGenGroup>>('/v3/avatars', {
    raw: true,
    query: { ownership: query.ownership, limit: query.limit ?? 50, token: query.token },
  });
}

export function getLook(lookId: string): Promise<HeyGenLook> {
  return call<HeyGenLook>(`/v3/avatars/looks/${encodeURIComponent(lookId)}`);
}

export function getGroup(groupId: string): Promise<HeyGenGroup> {
  return call<HeyGenGroup>(`/v3/avatars/${encodeURIComponent(groupId)}`);
}

export function createDigitalTwin(input: {
  name: string;
  assetId: string;
}): Promise<{ avatar_item: HeyGenLook; avatar_group: HeyGenGroup }> {
  return call('/v3/avatars', {
    body: {
      type: 'digital_twin',
      name: input.name,
      file: { type: 'asset_id', asset_id: input.assetId },
    },
  });
}

/** Starts HeyGen's webcam consent flow; the subject opens `url` (valid 24 h). */
export function createConsent(
  groupId: string,
  rerouteUrl?: string,
): Promise<{ url?: string; avatar_group?: HeyGenGroup }> {
  return call(`/v3/avatars/${encodeURIComponent(groupId)}/consent`, {
    body: rerouteUrl ? { reroute_url: rerouteUrl } : {},
  });
}

// Voices ----------------------------------------------------------------------

export function listVoices(query: {
  language?: string;
  gender?: string;
  limit?: number;
  token?: string;
}): Promise<Page<HeyGenVoice>> {
  return call<Page<HeyGenVoice>>('/v3/voices', {
    raw: true,
    query: {
      type: 'public',
      language: query.language,
      gender: query.gender,
      limit: query.limit ?? 24,
      token: query.token,
    },
  });
}

// Assets ----------------------------------------------------------------------

export interface DirectUpload {
  asset_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
  expires_in_seconds: number;
}

export function createDirectUpload(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<DirectUpload> {
  return call<DirectUpload>('/v3/assets/direct-uploads', {
    body: {
      filename: input.filename,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
    },
  });
}

/**
 * Upload file bytes as a HeyGen asset: presigned slot, PUT, complete. The PUT
 * goes to HeyGen's storage, which only accepts server-side uploads (its CORS
 * policy refuses browsers), so the bytes are assembled on this server first.
 */
export async function uploadAsset(input: {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<string> {
  const slot = await createDirectUpload({
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
  });
  const put = await fetch(slot.upload_url, {
    method: 'PUT',
    headers: slot.upload_headers,
    body: input.bytes as BodyInit,
  });
  if (!put.ok) throw new HeyGenError(`Footage upload failed (${put.status})`, 502);
  await call(`/v3/assets/${encodeURIComponent(slot.asset_id)}/complete`, { body: {} });
  return slot.asset_id;
}

// Videos ----------------------------------------------------------------------

export interface AvatarVideoInput {
  avatarId: string;
  voiceId?: string | null;
  script: string;
  title: string;
}

/**
 * Render one avatar clip; resolves to the HeyGen video id. Square output suits
 * the classroom's picture-in-picture window; a look that cannot be framed
 * square is rendered at its own aspect ratio instead.
 */
export async function createAvatarVideo(input: AvatarVideoInput): Promise<string> {
  const body = {
    type: 'avatar',
    avatar_id: input.avatarId,
    ...(input.voiceId ? { voice_id: input.voiceId } : {}),
    script: input.script,
    title: input.title,
    resolution: '720p',
  };
  try {
    const created = await call<{ video_id: string }>('/v3/videos', {
      body: { ...body, aspect_ratio: '1:1' },
    });
    return created.video_id;
  } catch (error) {
    if (!(error instanceof HeyGenError) || error.status !== 400) throw error;
    const created = await call<{ video_id: string }>('/v3/videos', {
      body: { ...body, aspect_ratio: 'auto' },
    });
    return created.video_id;
  }
}

export function getVideo(videoId: string): Promise<HeyGenVideo> {
  return call<HeyGenVideo>(`/v3/videos/${encodeURIComponent(videoId)}`);
}

// HyperFrames cloud rendering ---------------------------------------------------

export type HyperframesStatus = 'queued' | 'rendering' | 'completed' | 'failed';

export interface HyperframesRender {
  render_id: string;
  status: HyperframesStatus;
  video_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  failure_message?: string | null;
}

/**
 * Render an uploaded HyperFrames project zip (a lesson's video export) to an
 * MP4 on HeyGen's renderers. Resolves to the render id; poll with
 * {@link getHyperframesRender}.
 */
export async function createHyperframesRender(input: {
  assetId: string;
  fps: number;
  quality: 'draft' | 'standard' | 'high';
  resolution: '1080p' | '4k';
  title: string;
}): Promise<string> {
  const created = await call<{ render_id: string }>('/v3/hyperframes/renders', {
    body: {
      project: { type: 'asset_id', asset_id: input.assetId },
      fps: input.fps,
      quality: input.quality,
      format: 'mp4',
      resolution: input.resolution,
      aspect_ratio: '16:9',
      composition: 'index.html',
      title: input.title,
    },
  });
  return created.render_id;
}

export function getHyperframesRender(renderId: string): Promise<HyperframesRender> {
  return call<HyperframesRender>(`/v3/hyperframes/renders/${encodeURIComponent(renderId)}`);
}

export function deleteHyperframesRender(renderId: string): Promise<unknown> {
  return call(`/v3/hyperframes/renders/${encodeURIComponent(renderId)}`, { method: 'DELETE' });
}

/** Run `fn` over `items` with at most `limit` in flight; HeyGen rate-limits bursts. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
