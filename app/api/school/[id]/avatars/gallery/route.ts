/**
 * GET /api/school/[id]/avatars/gallery — ready-made HeyGen looks (one per
 * character), looks already in the connected HeyGen account, and Hindi and
 * English voices. The library part changes rarely and is cached in memory.
 *
 * Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import type { Gallery, GalleryLook, GalleryVoice } from '@/lib/school/avatar-types';
import { VOICE_LANGUAGES } from '@/lib/school/avatar-types';
import { ownerJson } from '@/lib/server/agent-runtime/route-response';
import {
  listGroups,
  listLooks,
  listVoices,
  type HeyGenGroup,
  type HeyGenLook,
  type HeyGenVoice,
} from '@/lib/server/heygen';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { heygenFailure } from '@/lib/server/school/heygen-response';
import { requireStaff } from '@/lib/server/school/staff-access';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const LIBRARY_CHARACTERS = 24;
const VOICES_PER_LANGUAGE = 16;
const CACHE_MS = 6 * 60 * 60 * 1000;

let cached: { at: number; looks: GalleryLook[]; voices: GalleryVoice[] } | null = null;

function toLook(look: HeyGenLook): GalleryLook {
  return {
    id: look.id,
    name: look.name,
    groupId: look.group_id,
    gender: look.gender,
    previewImageUrl: look.preview_image_url,
    previewVideoUrl: look.preview_video_url,
    defaultVoiceId: look.default_voice_id,
    avatarType: look.avatar_type,
  };
}

function toVoice(voice: HeyGenVoice): GalleryVoice {
  return {
    id: voice.voice_id,
    name: voice.name,
    language: voice.language,
    gender: voice.gender,
    previewUrl: voice.preview_audio_url,
  };
}

/**
 * The library's presenters: one entry per character, women and men alternating
 * (HeyGen's first page is mostly men); the look is chosen when one is added.
 */
async function libraryLooks(): Promise<GalleryLook[]> {
  const result = await listGroups({ ownership: 'public', limit: 50 });
  const groups = result.data.filter((group) => group.preview_image_url);
  const women = groups.filter((group) => group.gender?.toLowerCase().startsWith('f'));
  const men = groups.filter((group) => !women.includes(group));
  const mixed: HeyGenGroup[] = [];
  for (let i = 0; mixed.length < LIBRARY_CHARACTERS && (women[i] || men[i]); i++) {
    if (women[i]) mixed.push(women[i]);
    if (men[i]) mixed.push(men[i]);
  }
  return mixed.slice(0, LIBRARY_CHARACTERS).map(
    (group: HeyGenGroup): GalleryLook => ({
      id: '',
      name: group.name,
      groupId: group.id,
      gender: group.gender?.toLowerCase() ?? null,
      previewImageUrl: group.preview_image_url,
      previewVideoUrl: group.preview_video_url ?? null,
      defaultVoiceId: group.default_voice_id,
      avatarType: 'studio_avatar',
    }),
  );
}

async function library(): Promise<{ looks: GalleryLook[]; voices: GalleryVoice[] }> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  const [looks, ...voicePages] = await Promise.all([
    libraryLooks(),
    ...VOICE_LANGUAGES.map((language) => listVoices({ language, limit: VOICES_PER_LANGUAGE })),
  ]);
  const voices = voicePages.flatMap((page) => page.data.map(toVoice));
  cached = { at: Date.now(), looks, voices };
  return cached;
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    try {
      const [{ looks, voices }, mine] = await Promise.all([
        library(),
        listLooks({ ownership: 'private', limit: 50 }),
      ]);
      const gallery: Gallery = {
        looks,
        mine: mine.data.filter((look) => look.status === 'completed').map(toLook),
        voices,
      };
      return ownerJson(gallery, 200, headers);
    } catch (error) {
      return heygenFailure(error, headers);
    }
  });
}
