/**
 * Saved question papers over `school_papers` (`./db.ts`). The paper body is
 * the shared {@link Paper} JSON; the DOCX is rendered from it in the browser.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import type { Paper, SavedPaperSummary } from '@/lib/school/question-types';

import { newId } from './accounts';

export interface SavedPaper {
  id: string;
  schoolId: string;
  createdBy: string;
  title: string;
  paper: Paper;
  createdAt: number;
}

interface PaperRow extends Record<string, unknown> {
  id: string;
  school_id: string;
  created_by: string;
  title: string;
  paper: Paper;
  created_at: number | string;
}

function toSavedPaper(row: PaperRow): SavedPaper {
  return {
    id: row.id,
    schoolId: row.school_id,
    createdBy: row.created_by,
    title: row.title,
    paper: row.paper,
    createdAt: Number(row.created_at),
  };
}

export async function savePaper(
  db: Queryable,
  input: { schoolId: string; createdBy: string; paper: Paper },
): Promise<SavedPaper> {
  const id = newId('paper');
  const now = Date.now();
  await db.query(
    `INSERT INTO school_papers (id, school_id, created_by, title, paper, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, input.schoolId, input.createdBy, input.paper.title, JSON.stringify(input.paper), now],
  );
  return {
    id,
    schoolId: input.schoolId,
    createdBy: input.createdBy,
    title: input.paper.title,
    paper: input.paper,
    createdAt: now,
  };
}

export async function getPaper(
  db: Queryable,
  schoolId: string,
  id: string,
): Promise<SavedPaper | null> {
  const result = await db.query<PaperRow>(
    `SELECT * FROM school_papers WHERE school_id = $1 AND id = $2`,
    [schoolId, id],
  );
  const row = result.rows[0];
  return row ? toSavedPaper(row) : null;
}

export async function listPapers(db: Queryable, schoolId: string): Promise<SavedPaperSummary[]> {
  const result = await db.query<PaperRow>(
    `SELECT * FROM school_papers WHERE school_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [schoolId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    classLabel: row.paper.classLabel,
    subject: row.paper.subject,
    totalMarks: row.paper.totalMarks,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
  }));
}

export async function deletePaper(db: Queryable, schoolId: string, id: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM school_papers WHERE school_id = $1 AND id = $2 RETURNING id`,
    [schoolId, id],
  );
  return result.rows.length > 0;
}
