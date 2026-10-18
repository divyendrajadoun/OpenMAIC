/**
 * POST /api/school/[id]/questions/generate — draft questions for a chapter.
 *
 * Body: { board, classLabel, subject, chapter, language?, count?, types?, difficulty?, notes? }.
 * Returns { questions } for the teacher to review; nothing is saved until they
 * POST the kept ones to /questions. Staff only.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import { getSchoolDb } from '@/lib/server/school/db';
import {
  GenerationError,
  QUESTION_JSON_CONTRACT,
  generateJson,
} from '@/lib/server/school/generate';
import { optionalString, readJsonObject } from '@/lib/server/school/http';
import { requireStaff } from '@/lib/server/school/staff-access';
import { DIFFICULTIES, QUESTION_TYPES, parseQuestionDrafts } from '@/lib/school/question-types';

export const runtime = 'nodejs';
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const board = optionalString(body.board, 60) ?? 'CBSE';
  const classLabel = optionalString(body.classLabel, 60);
  const subject = optionalString(body.subject, 120);
  const chapter = optionalString(body.chapter, 200);
  const language = optionalString(body.language, 40) ?? 'English';
  const notes = optionalString(body.notes, 2000);
  const countRaw = Number(body.count);
  const count = Number.isFinite(countRaw) ? Math.min(Math.max(Math.round(countRaw), 1), 30) : 10;
  const types = Array.isArray(body.types)
    ? body.types.filter((t): t is string => (QUESTION_TYPES as readonly unknown[]).includes(t))
    : [];
  const difficulty = (DIFFICULTIES as readonly unknown[]).includes(body.difficulty)
    ? (body.difficulty as string)
    : 'mixed';

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

    const system = `You are an experienced ${board} school teacher and paper setter in India writing questions for ${classLabel}, subject ${subject}. Write in ${language}. ${QUESTION_JSON_CONTRACT}
Return a JSON object: {"questions": [ ...questions ]}.`;
    const prompt = `Write ${count} questions on the chapter "${chapter}".
Question types to use: ${types.length > 0 ? types.join(', ') : 'a sensible mix of mcq, true_false, fill_blank and short'}.
Difficulty: ${difficulty}.
${notes ? `Teacher's notes: ${notes}\n` : ''}Cover the whole chapter, not just its first topic. Vary the cognitive level (recall, understanding, application).`;

    let result: { questions?: unknown } | null;
    try {
      result = await generateJson<{ questions?: unknown }>(
        req,
        body,
        'school-question-generate',
        system,
        prompt,
      );
    } catch (error) {
      if (error instanceof GenerationError) {
        return ownerApiError('INTERNAL_ERROR', 502, error.message, headers);
      }
      throw error;
    }
    const questions = parseQuestionDrafts(result?.questions, count);
    if (questions.length === 0) {
      return ownerApiError(
        'INTERNAL_ERROR',
        502,
        'the model returned no usable questions',
        headers,
      );
    }
    return ownerJson({ questions }, 200, headers);
  });
}
