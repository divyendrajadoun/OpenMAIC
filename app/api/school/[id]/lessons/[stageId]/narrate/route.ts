/**
 * Avatar narration of one of the teacher's lessons.
 *
 * GET    /api/school/[id]/lessons/[stageId]/narrate?avatarId= — what rendering would
 *        involve: { plan: { lines, words, minutes, reusable } }.
 * POST   /api/school/[id]/lessons/[stageId]/narrate — render the missing clips.
 *        Body: { avatarId }. Returns { created, reused, failed, total }.
 * DELETE /api/school/[id]/lessons/[stageId]/narrate — remove the lesson's clips.
 *
 * Staff only, and the lesson must be the caller's own course.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import type { OwnerPrincipal } from '@/lib/server/identity';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getAvatar } from '@/lib/server/school/avatars';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject } from '@/lib/server/school/http';
import {
  collectSpeechLines,
  deleteLessonClips,
  estimateNarration,
  listClipRows,
  narrateLesson,
  planNarration,
} from '@/lib/server/school/lesson-clips';
import { requireStaff } from '@/lib/server/school/staff-access';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Params = { params: Promise<{ id: string; stageId: string }> };

async function loadLesson(principal: OwnerPrincipal, stageId: string) {
  const store = await getOwnerScopedDocumentStore(principal);
  const document = await store.loadDocument(stageId);
  if (!document) return null;
  const stage = document.stage as { name?: string };
  return { name: stage.name ?? 'Lesson', lines: collectSpeechLines(document.scenes) };
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, stageId } = await params;
  const avatarId = req.nextUrl.searchParams.get('avatarId') ?? '';
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const lesson = await loadLesson(principal, stageId);
    if (!lesson) return ownerNotFound(headers);
    const existing = await listClipRows(db, stageId);
    const { reusable } = planNarration(lesson.lines, existing, avatarId);
    return ownerJson({ plan: estimateNarration(lesson.lines, reusable) }, 200, headers);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, stageId } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const avatarId = optionalString(parsed.body.avatarId, 80);

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    if (!avatarId) return ownerApiError('INVALID_REQUEST', 400, 'avatarId is required', headers);
    const avatar = await getAvatar(db, id, avatarId);
    if (!avatar) return ownerNotFound(headers);
    if (avatar.status !== 'ready') {
      return ownerApiError('INVALID_REQUEST', 409, 'this avatar is not ready yet', headers);
    }
    const lesson = await loadLesson(principal, stageId);
    if (!lesson) return ownerNotFound(headers);
    if (lesson.lines.length === 0) {
      return ownerApiError('INVALID_REQUEST', 400, 'this lesson has no narration yet', headers);
    }
    const result = await narrateLesson(db, {
      schoolId: id,
      stageId,
      stageName: lesson.name,
      avatar,
      lines: lesson.lines,
    });
    return ownerJson(result, 202, headers);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, stageId } = await params;
  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const lesson = await loadLesson(principal, stageId);
    if (!lesson) return ownerNotFound(headers);
    await deleteLessonClips(db, stageId);
    return ownerJson({ deleted: true }, 200, headers);
  });
}
