/**
 * A school's avatars over `school_avatars` (`./db.ts`): digital twins trained
 * from a teacher's footage and library looks a teacher picked. Each row points
 * at a HeyGen look (and group) and mirrors HeyGen's training and consent state.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import type { AvatarKind, AvatarStatus, SchoolAvatar } from '@/lib/school/avatar-types';
import { getGroup, getLook, type HeyGenGroup, type HeyGenLook } from '@/lib/server/heygen';

import { newId } from './accounts';

interface AvatarRow extends Record<string, unknown> {
  id: string;
  school_id: string;
  owner_user_id: string;
  owner_name: string | null;
  name: string;
  kind: AvatarKind;
  look_id: string;
  group_id: string | null;
  voice_id: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  status: AvatarStatus;
  consent_status: string | null;
  error: string | null;
  sample_video_id: string | null;
  sample_video_url: string | null;
  created_at: number | string;
}

const SELECT = `SELECT a.*, u.name AS owner_name
  FROM school_avatars a LEFT JOIN school_users u ON u.id = a.owner_user_id`;

function toAvatar(row: AvatarRow): SchoolAvatar {
  return {
    id: row.id,
    schoolId: row.school_id,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    name: row.name,
    kind: row.kind,
    lookId: row.look_id,
    groupId: row.group_id,
    voiceId: row.voice_id,
    previewImageUrl: row.preview_image_url,
    previewVideoUrl: row.preview_video_url,
    status: row.status,
    consentStatus: row.consent_status,
    error: row.error,
    sampleVideoId: row.sample_video_id,
    sampleVideoUrl: row.sample_video_url,
    createdAt: Number(row.created_at),
  };
}

export interface HeyGenState {
  status: AvatarStatus;
  consentStatus: string | null;
  error: string | null;
}

/**
 * Where an avatar stands, from HeyGen's look and group. A twin needs the
 * subject's recorded consent before it may render; library and photo looks
 * have no consent step.
 */
export function stateFromHeyGen(
  look: Pick<HeyGenLook, 'status' | 'error'>,
  group: Pick<HeyGenGroup, 'consent_status'> | null,
  kind: AvatarKind,
): HeyGenState {
  const consentStatus = group?.consent_status ?? null;
  if (look.status === 'failed') {
    return { status: 'failed', consentStatus, error: look.error?.message ?? 'Training failed' };
  }
  if (look.status !== 'completed') return { status: 'training', consentStatus, error: null };
  if (kind === 'twin' && consentStatus !== 'accepted') {
    return {
      status: 'consent',
      consentStatus,
      error: consentStatus === 'rejected' ? 'Consent was rejected; record it again.' : null,
    };
  }
  return { status: 'ready', consentStatus, error: null };
}

export function kindForLook(look: Pick<HeyGenLook, 'avatar_type'>): AvatarKind {
  return look.avatar_type === 'digital_twin' ? 'twin' : 'stock';
}

export async function insertAvatar(
  db: Queryable,
  input: {
    schoolId: string;
    ownerUserId: string;
    name: string;
    kind: AvatarKind;
    look: HeyGenLook;
    voiceId: string | null;
    state: HeyGenState;
  },
): Promise<SchoolAvatar> {
  const id = newId('avatar');
  const now = Date.now();
  await db.query(
    `INSERT INTO school_avatars (id, school_id, owner_user_id, name, kind, look_id, group_id, voice_id,
       preview_image_url, preview_video_url, status, consent_status, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id,
      input.schoolId,
      input.ownerUserId,
      input.name,
      input.kind,
      input.look.id,
      input.look.group_id,
      input.voiceId,
      input.look.preview_image_url,
      input.look.preview_video_url,
      input.state.status,
      input.state.consentStatus,
      input.state.error,
      now,
    ],
  );
  const saved = await getAvatarById(db, id);
  if (!saved) throw new Error('avatar vanished after insert');
  return saved;
}

export async function listAvatars(db: Queryable, schoolId: string): Promise<SchoolAvatar[]> {
  const result = await db.query<AvatarRow>(
    `${SELECT} WHERE a.school_id = $1 ORDER BY a.created_at DESC LIMIT 100`,
    [schoolId],
  );
  return result.rows.map(toAvatar);
}

export async function getAvatar(
  db: Queryable,
  schoolId: string,
  id: string,
): Promise<SchoolAvatar | null> {
  const result = await db.query<AvatarRow>(`${SELECT} WHERE a.school_id = $1 AND a.id = $2`, [
    schoolId,
    id,
  ]);
  return result.rows[0] ? toAvatar(result.rows[0]) : null;
}

export async function getAvatarById(db: Queryable, id: string): Promise<SchoolAvatar | null> {
  const result = await db.query<AvatarRow>(`${SELECT} WHERE a.id = $1`, [id]);
  return result.rows[0] ? toAvatar(result.rows[0]) : null;
}

type AvatarPatch = Partial<
  Pick<
    SchoolAvatar,
    | 'status'
    | 'consentStatus'
    | 'error'
    | 'previewImageUrl'
    | 'previewVideoUrl'
    | 'voiceId'
    | 'sampleVideoId'
    | 'sampleVideoUrl'
  >
>;

const PATCH_COLUMNS: Record<keyof AvatarPatch, string> = {
  status: 'status',
  consentStatus: 'consent_status',
  error: 'error',
  previewImageUrl: 'preview_image_url',
  previewVideoUrl: 'preview_video_url',
  voiceId: 'voice_id',
  sampleVideoId: 'sample_video_id',
  sampleVideoUrl: 'sample_video_url',
};

export async function updateAvatar(db: Queryable, id: string, patch: AvatarPatch): Promise<void> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(
    ([key], index) => `${PATCH_COLUMNS[key as keyof AvatarPatch]} = $${index + 2}`,
  );
  await db.query(`UPDATE school_avatars SET ${sets.join(', ')} WHERE id = $1`, [
    id,
    ...entries.map(([, value]) => value),
  ]);
}

export async function deleteAvatar(db: Queryable, schoolId: string, id: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM school_avatars WHERE school_id = $1 AND id = $2 RETURNING id`,
    [schoolId, id],
  );
  return result.rows.length > 0;
}

/**
 * Pull the latest training and consent state from HeyGen for an avatar that
 * is not settled yet. Ready and failed avatars are returned as they are.
 */
export async function refreshAvatar(db: Queryable, avatar: SchoolAvatar): Promise<SchoolAvatar> {
  if (avatar.status !== 'training' && avatar.status !== 'consent') return avatar;
  const look = await getLook(avatar.lookId);
  const group = avatar.groupId ? await getGroup(avatar.groupId).catch(() => null) : null;
  const state = stateFromHeyGen(look, group, avatar.kind);
  const patch: AvatarPatch = {
    ...state,
    previewImageUrl: look.preview_image_url ?? avatar.previewImageUrl,
    previewVideoUrl: look.preview_video_url ?? avatar.previewVideoUrl,
    voiceId: avatar.voiceId ?? look.default_voice_id ?? group?.default_voice_id ?? null,
  };
  await updateAvatar(db, avatar.id, patch);
  return { ...avatar, ...patch };
}
