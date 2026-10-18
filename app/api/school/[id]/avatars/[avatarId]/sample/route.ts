/**
 * POST /api/school/[id]/avatars/[avatarId]/sample — render a short greeting with
 *      the avatar so the teacher hears it before narrating a lesson.
 *      Body: { language: 'Hindi' | 'English' }.
 * GET  /api/school/[id]/avatars/[avatarId]/sample — poll the greeting; stores the
 *      video URL on the avatar once HeyGen has finished.
 *
 * Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { createAvatarVideo, getVideo } from '@/lib/server/heygen';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getAvatar, updateAvatar } from '@/lib/server/school/avatars';
import { getSchoolDb } from '@/lib/server/school/db';
import { heygenFailure } from '@/lib/server/school/heygen-response';
import { readJsonObject } from '@/lib/server/school/http';
import { requireStaff } from '@/lib/server/school/staff-access';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; avatarId: string }> };

function greeting(name: string, language: string): string {
  return language === 'Hindi'
    ? `नमस्ते बच्चों! मैं ${name}। School of AI की इस क्लास में आपका स्वागत है। चलिए, आज कुछ नया सीखते हैं।`
    : `Namaste! I am ${name}. Welcome to your School of AI classroom. Let us learn something new today.`;
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, avatarId } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const language = parsed.body.language === 'Hindi' ? 'Hindi' : 'English';

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const avatar = await getAvatar(db, id, avatarId);
    if (!avatar) return ownerNotFound(headers);
    if (avatar.status !== 'ready') {
      return ownerApiError('INVALID_REQUEST', 409, 'this avatar is not ready yet', headers);
    }
    try {
      const videoId = await createAvatarVideo({
        avatarId: avatar.lookId,
        voiceId: avatar.voiceId,
        script: greeting(avatar.name, language),
        title: `${avatar.name} · greeting`,
      });
      await updateAvatar(db, avatar.id, { sampleVideoId: videoId, sampleVideoUrl: null });
      return ownerJson(
        { avatar: { ...avatar, sampleVideoId: videoId, sampleVideoUrl: null } },
        202,
        headers,
      );
    } catch (error) {
      return heygenFailure(error, headers);
    }
  });
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, avatarId } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const avatar = await getAvatar(db, id, avatarId);
    if (!avatar) return ownerNotFound(headers);
    if (!avatar.sampleVideoId) return ownerJson({ avatar, status: 'none' }, 200, headers);
    try {
      const video = await getVideo(avatar.sampleVideoId);
      if (video.status === 'completed' && video.video_url) {
        await updateAvatar(db, avatar.id, { sampleVideoUrl: video.video_url });
        avatar.sampleVideoUrl = video.video_url;
      }
      return ownerJson(
        { avatar, status: video.status, error: video.failure_message ?? null },
        200,
        headers,
      );
    } catch (error) {
      return heygenFailure(error, headers);
    }
  });
}
