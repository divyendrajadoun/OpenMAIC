/**
 * Avatar-narrated lessons over `school_lesson_clips` (`./db.ts`).
 *
 * One clip per speech line of a lesson: the avatar speaking exactly that
 * line, so the classroom's own choreography (spotlights, whiteboard strokes,
 * quizzes between lines) plays untouched while the clip's audio replaces the
 * synthesized narration. Clips are keyed by action id and carry the line's
 * text hash; the player ignores a clip whose line has since been edited.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import { narrationTextHash } from '@/lib/avatar/text-hash';
import type {
  ClipStatus,
  LessonClip,
  LessonClipsView,
  NarrationPlan,
  SchoolAvatar,
} from '@/lib/school/avatar-types';
import { createAvatarVideo, getVideo, HeyGenError, mapLimit } from '@/lib/server/heygen';

import { getAvatarById } from './avatars';

/** HeyGen's script limit is generous; this keeps one line's clip under a few minutes. */
const MAX_SCRIPT_CHARS = 3000;
/** Words per minute of a teacher's classroom speech, for the estimate shown before rendering. */
const WORDS_PER_MINUTE = 140;
/** Presigned video URLs are re-read from HeyGen after this long. */
const URL_REFRESH_MS = 6 * 60 * 60 * 1000;

export interface SpeechLine {
  actionId: string;
  sceneTitle: string;
  text: string;
  hash: string;
}

interface SceneLike {
  id: string;
  title?: string;
  order: number;
  actions?: readonly { id: string; type: string; text?: string }[];
}

/** Every spoken line of a lesson, in playback order. */
export function collectSpeechLines(scenes: readonly SceneLike[]): SpeechLine[] {
  const lines: SpeechLine[] = [];
  for (const scene of [...scenes].sort((a, b) => a.order - b.order)) {
    for (const action of scene.actions ?? []) {
      if (action.type !== 'speech') continue;
      const text = (action.text ?? '').trim().slice(0, MAX_SCRIPT_CHARS);
      if (!text) continue;
      lines.push({
        actionId: action.id,
        sceneTitle: scene.title ?? '',
        text,
        hash: narrationTextHash(text),
      });
    }
  }
  return lines;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export interface ClipRow extends Record<string, unknown> {
  stage_id: string;
  action_id: string;
  school_id: string;
  avatar_id: string;
  video_id: string;
  text_hash: string;
  status: ClipStatus;
  video_url: string | null;
  duration: number | string | null;
  error: string | null;
  url_checked_at: number | string | null;
  created_at: number | string;
}

/** Which lines need a new clip for this avatar, and how many finished clips can stay. */
export function planNarration(
  lines: readonly SpeechLine[],
  existing: readonly Pick<ClipRow, 'action_id' | 'avatar_id' | 'text_hash' | 'status'>[],
  avatarId: string,
): { create: SpeechLine[]; reusable: number } {
  const byAction = new Map(existing.map((row) => [row.action_id, row]));
  const create = lines.filter((line) => {
    const row = byAction.get(line.actionId);
    return !(
      row &&
      row.avatar_id === avatarId &&
      row.text_hash === line.hash &&
      row.status !== 'failed'
    );
  });
  return { create, reusable: lines.length - create.length };
}

export function estimateNarration(lines: readonly SpeechLine[], reusable: number): NarrationPlan {
  const words = lines.reduce((sum, line) => sum + countWords(line.text), 0);
  return {
    lines: lines.length,
    words,
    minutes: Math.round((words / WORDS_PER_MINUTE) * 10) / 10,
    reusable,
  };
}

export async function listClipRows(db: Queryable, stageId: string): Promise<ClipRow[]> {
  const result = await db.query<ClipRow>(
    `SELECT * FROM school_lesson_clips WHERE stage_id = $1 ORDER BY created_at`,
    [stageId],
  );
  return result.rows;
}

/**
 * Render the clips a lesson is missing for `avatar`, replacing clips of other
 * avatars and of edited lines, and dropping clips of lines that no longer
 * exist. Rendering is asynchronous at HeyGen; rows start as `processing`.
 */
export async function narrateLesson(
  db: Queryable,
  input: {
    schoolId: string;
    stageId: string;
    stageName: string;
    avatar: SchoolAvatar;
    lines: readonly SpeechLine[];
  },
): Promise<{ created: number; reused: number; failed: number; total: number }> {
  const existing = await listClipRows(db, input.stageId);
  const { create, reusable } = planNarration(input.lines, existing, input.avatar.id);

  const keep = new Set(input.lines.map((line) => line.actionId));
  const stale = existing.filter((row) => !keep.has(row.action_id)).map((row) => row.action_id);
  if (stale.length > 0) {
    await db.query(
      `DELETE FROM school_lesson_clips WHERE stage_id = $1 AND action_id = ANY($2::text[])`,
      [input.stageId, stale],
    );
  }

  let failed = 0;
  const now = Date.now();
  await mapLimit(create, 3, async (line) => {
    let videoId = '';
    let status: ClipStatus = 'processing';
    let error: string | null = null;
    try {
      videoId = await createAvatarVideo({
        avatarId: input.avatar.lookId,
        voiceId: input.avatar.voiceId,
        script: line.text,
        title: `${input.stageName} · ${line.sceneTitle || 'lesson'}`,
      });
    } catch (cause) {
      status = 'failed';
      failed += 1;
      error = cause instanceof HeyGenError ? cause.message : 'Could not start rendering';
    }
    await db.query(
      `INSERT INTO school_lesson_clips (stage_id, action_id, school_id, avatar_id, video_id, text_hash,
         status, video_url, duration, error, url_checked_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, NULL, $9)
       ON CONFLICT (stage_id, action_id) DO UPDATE SET
         school_id = EXCLUDED.school_id, avatar_id = EXCLUDED.avatar_id, video_id = EXCLUDED.video_id,
         text_hash = EXCLUDED.text_hash, status = EXCLUDED.status, video_url = NULL, duration = NULL,
         error = EXCLUDED.error, url_checked_at = NULL, created_at = EXCLUDED.created_at`,
      [
        input.stageId,
        line.actionId,
        input.schoolId,
        input.avatar.id,
        videoId,
        line.hash,
        status,
        error,
        now,
      ],
    );
  });

  return {
    created: create.length - failed,
    reused: reusable,
    failed,
    total: input.lines.length,
  };
}

/**
 * Bring a lesson's clips up to date with HeyGen: finish rows still rendering
 * and re-read download URLs that may have expired. Returns the current rows.
 */
export async function syncLessonClips(db: Queryable, stageId: string): Promise<ClipRow[]> {
  const rows = await listClipRows(db, stageId);
  const now = Date.now();
  const due = rows.filter(
    (row) =>
      row.video_id &&
      (row.status === 'processing' ||
        (row.status === 'completed' && now - Number(row.url_checked_at ?? 0) > URL_REFRESH_MS)),
  );
  if (due.length === 0) return rows;

  await mapLimit(due, 6, async (row) => {
    let video;
    try {
      video = await getVideo(row.video_id);
    } catch {
      return; // transient; the next viewer retries
    }
    const status: ClipStatus =
      video.status === 'completed'
        ? 'completed'
        : video.status === 'failed'
          ? 'failed'
          : 'processing';
    row.status = status;
    row.video_url = video.video_url ?? row.video_url;
    row.duration = video.duration ?? row.duration;
    row.error = status === 'failed' ? (video.failure_message ?? 'Rendering failed') : null;
    row.url_checked_at = now;
    await db.query(
      `UPDATE school_lesson_clips SET status = $3, video_url = $4, duration = $5, error = $6, url_checked_at = $7
       WHERE stage_id = $1 AND action_id = $2`,
      [stageId, row.action_id, status, row.video_url, row.duration, row.error, now],
    );
  });
  return rows;
}

export async function clipsView(db: Queryable, rows: readonly ClipRow[]): Promise<LessonClipsView> {
  const clips: LessonClip[] = rows.map((row) => ({
    actionId: row.action_id,
    textHash: row.text_hash,
    status: row.status,
    videoUrl: row.status === 'completed' ? row.video_url : null,
    duration: row.duration === null ? null : Number(row.duration),
    error: row.error,
  }));
  const counts = { completed: 0, processing: 0, failed: 0 };
  for (const clip of clips) counts[clip.status] += 1;
  const avatarId = rows[0]?.avatar_id;
  const avatar = avatarId ? await getAvatarById(db, avatarId) : null;
  return {
    clips,
    avatar: avatar
      ? { id: avatar.id, name: avatar.name, previewImageUrl: avatar.previewImageUrl }
      : null,
    counts,
  };
}

export async function deleteLessonClips(db: Queryable, stageId: string): Promise<void> {
  await db.query(`DELETE FROM school_lesson_clips WHERE stage_id = $1`, [stageId]);
}
