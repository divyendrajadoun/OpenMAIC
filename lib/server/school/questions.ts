/**
 * The question bank: questions a school's teachers keep, tagged by class,
 * subject and chapter, over `school_questions` (`./db.ts`).
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import type { BankQuestion, QuestionDraft, QuestionType } from '@/lib/school/question-types';

import { newId } from './accounts';

interface QuestionRow extends Record<string, unknown> {
  id: string;
  school_id: string;
  created_by: string;
  class_label: string;
  subject: string;
  chapter: string;
  type: QuestionType;
  text: string;
  options: string[] | null;
  answer: string | number | null;
  explanation: string | null;
  marks: number;
  difficulty: BankQuestion['difficulty'];
  created_at: number | string;
}

function toQuestion(row: QuestionRow): BankQuestion {
  return {
    id: row.id,
    schoolId: row.school_id,
    createdBy: row.created_by,
    classLabel: row.class_label,
    subject: row.subject,
    chapter: row.chapter,
    type: row.type,
    text: row.text,
    ...(row.options ? { options: row.options } : {}),
    answer: row.answer,
    ...(row.explanation ? { explanation: row.explanation } : {}),
    marks: Number(row.marks),
    difficulty: row.difficulty,
    createdAt: Number(row.created_at),
  };
}

export interface QuestionTags {
  classLabel: string;
  subject: string;
  chapter: string;
}

export async function insertQuestions(
  db: Queryable,
  input: QuestionTags & {
    schoolId: string;
    createdBy: string;
    questions: readonly QuestionDraft[];
  },
): Promise<BankQuestion[]> {
  const now = Date.now();
  const inserted: BankQuestion[] = [];
  for (const question of input.questions) {
    const result = await db.query<QuestionRow>(
      `INSERT INTO school_questions
         (id, school_id, created_by, class_label, subject, chapter, type, text, options, answer,
          explanation, marks, difficulty, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        newId('q'),
        input.schoolId,
        input.createdBy,
        input.classLabel,
        input.subject,
        input.chapter,
        question.type,
        question.text,
        question.options ? JSON.stringify(question.options) : null,
        question.answer === null ? null : JSON.stringify(question.answer),
        question.explanation ?? null,
        question.marks,
        question.difficulty,
        now,
      ],
    );
    inserted.push(toQuestion(result.rows[0]));
  }
  return inserted;
}

export interface QuestionFilter {
  classLabel?: string;
  subject?: string;
  chapter?: string;
  type?: QuestionType;
  limit?: number;
}

export async function listQuestions(
  db: Queryable,
  schoolId: string,
  filter: QuestionFilter = {},
): Promise<BankQuestion[]> {
  const clauses = ['school_id = $1'];
  const values: unknown[] = [schoolId];
  const add = (column: string, value: string | undefined) => {
    if (!value) return;
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  };
  add('class_label', filter.classLabel);
  add('subject', filter.subject);
  add('chapter', filter.chapter);
  add('type', filter.type);
  values.push(Math.min(Math.max(filter.limit ?? 200, 1), 500));
  const result = await db.query<QuestionRow>(
    `SELECT * FROM school_questions WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC LIMIT $${values.length}`,
    values,
  );
  return result.rows.map(toQuestion);
}

/** Distinct class / subject / chapter combinations, for the bank's filters. */
export async function listQuestionFacets(
  db: Queryable,
  schoolId: string,
): Promise<Array<QuestionTags & { count: number }>> {
  const result = await db.query<
    {
      class_label: string;
      subject: string;
      chapter: string;
      count: string | number;
    } & Record<string, unknown>
  >(
    `SELECT class_label, subject, chapter, COUNT(*) AS count
     FROM school_questions WHERE school_id = $1
     GROUP BY class_label, subject, chapter
     ORDER BY class_label, subject, chapter`,
    [schoolId],
  );
  return result.rows.map((row) => ({
    classLabel: row.class_label,
    subject: row.subject,
    chapter: row.chapter,
    count: Number(row.count),
  }));
}

/** True when a row was deleted. */
export async function deleteQuestion(
  db: Queryable,
  schoolId: string,
  id: string,
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM school_questions WHERE school_id = $1 AND id = $2 RETURNING id`,
    [schoolId, id],
  );
  return result.rows.length > 0;
}
