/**
 * POST /api/school/[id]/papers/generate — a board-pattern question paper.
 *
 * Body: {
 *   board, classLabel, subject, chapters: string[], totalMarks?, durationMinutes?,
 *   language?, difficulty?, notes?,
 *   blueprint?: [{ title, type, count, marksEach }]   // sections; omitted → board default
 * }
 * Returns { paper } for review. Nothing is saved until POST /papers. Staff only.
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
import { QUESTION_TYPES, parsePaper } from '@/lib/school/question-types';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

interface BlueprintSection {
  title: string;
  type: string;
  count: number;
  marksEach: number;
}

function readBlueprint(value: unknown): BlueprintSection[] {
  if (!Array.isArray(value)) return [];
  const out: BlueprintSection[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const section = item as Record<string, unknown>;
    const count = Number(section.count);
    const marksEach = Number(section.marksEach);
    if (!(QUESTION_TYPES as readonly unknown[]).includes(section.type)) continue;
    if (!Number.isFinite(count) || count < 1 || count > 40) continue;
    if (!Number.isFinite(marksEach) || marksEach < 1 || marksEach > 20) continue;
    out.push({
      title:
        optionalString(section.title, 100) ?? `Section ${String.fromCharCode(65 + out.length)}`,
      type: section.type as string,
      count: Math.round(count),
      marksEach: Math.round(marksEach),
    });
    if (out.length >= 8) break;
  }
  return out;
}

/** The common CBSE/RBSE shape for an 80-mark paper, scaled to the asked total. */
function defaultBlueprint(totalMarks: number): BlueprintSection[] {
  const scale = totalMarks / 80;
  const n = (count: number) => Math.max(1, Math.round(count * scale));
  return [
    { title: 'Section A', type: 'mcq', count: n(16), marksEach: 1 },
    { title: 'Section B', type: 'short', count: n(8), marksEach: 2 },
    { title: 'Section C', type: 'short', count: n(8), marksEach: 3 },
    { title: 'Section D', type: 'long', count: n(4), marksEach: 5 },
    { title: 'Section E', type: 'long', count: n(1), marksEach: 4 },
  ];
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const board = optionalString(body.board, 60) ?? 'CBSE';
  const classLabel = optionalString(body.classLabel, 60);
  const subject = optionalString(body.subject, 120);
  const chapters = Array.isArray(body.chapters)
    ? body.chapters.map((c) => optionalString(c, 200)).filter((c): c is string => Boolean(c))
    : [];
  const language = optionalString(body.language, 40) ?? 'English';
  const notes = optionalString(body.notes, 2000);
  const difficulty = optionalString(body.difficulty, 40) ?? 'balanced';
  const totalRaw = Number(body.totalMarks);
  const totalMarks = Number.isFinite(totalRaw)
    ? Math.min(Math.max(Math.round(totalRaw), 5), 200)
    : 80;
  const durationRaw = Number(body.durationMinutes);
  const durationMinutes = Number.isFinite(durationRaw)
    ? Math.min(Math.max(Math.round(durationRaw), 10), 300)
    : 180;
  const blueprint = readBlueprint(body.blueprint);
  const sections = blueprint.length > 0 ? blueprint : defaultBlueprint(totalMarks);

  return withRequestOwner(req, async (principal, headers) => {
    const db = await getSchoolDb();
    const staff = await requireStaff(db, id, principal, headers);
    if (!staff.ok) return staff.response;
    if (!classLabel || !subject || chapters.length === 0) {
      return ownerApiError(
        'INVALID_REQUEST',
        400,
        'classLabel, subject and at least one chapter are required',
        headers,
      );
    }

    const blueprintText = sections
      .map(
        (s, i) =>
          `${i + 1}. "${s.title}": ${s.count} questions of type ${s.type}, ${s.marksEach} mark(s) each`,
      )
      .join('\n');
    const plannedTotal = sections.reduce((sum, s) => sum + s.count * s.marksEach, 0);

    const system = `You are a senior ${board} paper setter in India. Set a complete, exam-ready question paper for ${classLabel}, subject ${subject}, in ${language}, following the board's phrasing and difficulty norms. ${QUESTION_JSON_CONTRACT}
Return a JSON object:
{
  "title": "paper title",
  "board": "${board}",
  "classLabel": "${classLabel}",
  "subject": "${subject}",
  "chapters": [...],
  "durationMinutes": ${durationMinutes},
  "language": "${language}",
  "generalInstructions": ["...", "..."],   // 4 to 6 lines as printed on a board paper
  "sections": [ { "title": "Section A", "instructions": "...", "questions": [ ...questions ] } ]
}`;
    const prompt = `Chapters covered: ${chapters.join('; ')}.
Blueprint (follow the counts and marks exactly; total ${plannedTotal} marks):
${blueprintText}
Difficulty profile: ${difficulty}.
${notes ? `Teacher's notes: ${notes}\n` : ''}Spread the questions across all the chapters in proportion to their weight. Long-answer questions should carry an internal choice where the board does that. Set the "marks" of every question to its section's marks.`;

    let result: unknown;
    try {
      result = await generateJson<unknown>(req, body, 'school-paper-generate', system, prompt);
    } catch (error) {
      if (error instanceof GenerationError) {
        return ownerApiError('INTERNAL_ERROR', 502, error.message, headers);
      }
      throw error;
    }
    const paper = parsePaper(result);
    if (!paper) {
      return ownerApiError('INTERNAL_ERROR', 502, 'the model returned no usable paper', headers);
    }
    return ownerJson({ paper }, 200, headers);
  });
}
