/**
 * GET  /api/school/[id]/questions?classLabel=&subject=&chapter=&type= — the bank, newest first.
 * POST /api/school/[id]/questions — add questions. Body: { classLabel, subject, chapter, questions }.
 *
 * Staff only (admin or teacher of the school).
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject } from '@/lib/server/school/http';
import { insertQuestions, listQuestions } from '@/lib/server/school/questions';
import { requireStaff } from '@/lib/server/school/staff-access';
import { QUESTION_TYPES, parseQuestionDrafts } from '@/lib/school/question-types';
import type { QuestionType } from '@/lib/school/question-types';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const query = req.nextUrl.searchParams;
  const typeRaw = query.get('type');
  const type = (QUESTION_TYPES as readonly string[]).includes(typeRaw ?? '')
    ? (typeRaw as QuestionType)
    : undefined;

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    const questions = await listQuestions(db, id, {
      classLabel: optionalString(query.get('classLabel'), 60),
      subject: optionalString(query.get('subject'), 120),
      chapter: optionalString(query.get('chapter'), 200),
      ...(type ? { type } : {}),
    });
    return ownerJson({ questions }, 200, headers);
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const classLabel = optionalString(parsed.body.classLabel, 60);
  const subject = optionalString(parsed.body.subject, 120);
  const chapter = optionalString(parsed.body.chapter, 200);
  const questions = parseQuestionDrafts(parsed.body.questions);

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    if (!classLabel || !subject || !chapter) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        'classLabel, subject and chapter are required',
        headers,
      );
    }
    if (questions.length === 0) {
      return ownerApiError('INVALID_REQUEST', 400, 'no valid questions', headers);
    }
    const inserted = await insertQuestions(db, {
      schoolId: id,
      createdBy: staff.access.userId,
      classLabel,
      subject,
      chapter,
      questions,
    });
    return ownerJson({ questions: inserted }, 201, headers);
  });
}
