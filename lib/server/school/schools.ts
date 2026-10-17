/**
 * Schools, memberships, classes, rosters and course assignments over the
 * school tables (`./db.ts`).
 */
import { randomBytes } from 'node:crypto';

import type { Queryable } from '@openmaic/storage/document/pg';

import type { OwnerPrincipal } from '@/lib/server/identity';

import { newId, userIdFromOwnerId } from './accounts';
import type { ClassRole, SchoolRole } from './db';

export const SCHOOL_NAME_MAX_LENGTH = 120;
export const CLASS_NAME_MAX_LENGTH = 60;

export interface School {
  id: string;
  name: string;
  code: string;
  board: string | null;
  language: string;
  createdAt: number;
}

export interface SchoolClass {
  id: string;
  schoolId: string;
  name: string;
  grade: string | null;
  section: string | null;
  createdAt: number;
}

export interface ClassSummary extends SchoolClass {
  studentCount: number;
  teacherCount: number;
  courseCount: number;
}

export interface MemberInfo {
  userId: string;
  name: string;
  email: string;
  role: SchoolRole;
  createdAt: number;
}

export interface ClassMemberInfo {
  userId: string;
  name: string;
  email: string;
  role: ClassRole;
}

export interface AssignedCourse {
  stageId: string;
  name: string;
  description: string | null;
  sceneCount: number;
  assignedBy: string;
  assignedAt: number;
}

interface SchoolRow extends Record<string, unknown> {
  id: string;
  name: string;
  code: string;
  board: string | null;
  language: string;
  created_at: number | string;
}

function toSchool(row: SchoolRow): School {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    board: row.board,
    language: row.language,
    createdAt: Number(row.created_at),
  };
}

/** 6 characters, no look-alikes; also the suffix of generated student logins. */
export function generateSchoolCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

export async function createSchool(
  db: Queryable,
  input: { name: string; board?: string; language?: string; createdBy: string },
): Promise<School> {
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = newId('sch');
    const code = generateSchoolCode();
    const result = await db.query<SchoolRow>(
      `INSERT INTO schools (id, name, code, board, language, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (code) DO NOTHING
       RETURNING id, name, code, board, language, created_at`,
      [
        id,
        input.name,
        code,
        input.board ?? null,
        input.language ?? 'hinglish',
        input.createdBy,
        now,
      ],
    );
    const row = result.rows[0];
    if (!row) continue;
    await addSchoolMember(db, id, input.createdBy, 'admin');
    return toSchool(row);
  }
  throw new Error('could not mint a unique school code');
}

export async function getSchool(db: Queryable, schoolId: string): Promise<School | null> {
  const result = await db.query<SchoolRow>(
    `SELECT id, name, code, board, language, created_at FROM schools WHERE id = $1`,
    [schoolId],
  );
  const row = result.rows[0];
  return row ? toSchool(row) : null;
}

export async function addSchoolMember(
  db: Queryable,
  schoolId: string,
  userId: string,
  role: SchoolRole,
): Promise<void> {
  await db.query(
    `INSERT INTO school_members (school_id, user_id, role, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (school_id, user_id) DO NOTHING`,
    [schoolId, userId, role, Date.now()],
  );
}

export async function roleInSchool(
  db: Queryable,
  schoolId: string,
  userId: string,
): Promise<SchoolRole | null> {
  const result = await db.query<{ role: SchoolRole } & Record<string, unknown>>(
    `SELECT role FROM school_members WHERE school_id = $1 AND user_id = $2`,
    [schoolId, userId],
  );
  return result.rows[0]?.role ?? null;
}

/** The account id and school role of a request owner, or `null` when not a member. */
export async function schoolAccess(
  db: Queryable,
  schoolId: string,
  principal: OwnerPrincipal,
): Promise<{ userId: string; role: SchoolRole } | null> {
  const userId = userIdFromOwnerId(principal.ownerId);
  if (!userId || principal.kind !== 'user') return null;
  const role = await roleInSchool(db, schoolId, userId);
  return role ? { userId, role } : null;
}

export function isStaff(role: SchoolRole): boolean {
  return role === 'admin' || role === 'teacher';
}

export async function listSchoolMembers(db: Queryable, schoolId: string): Promise<MemberInfo[]> {
  const result = await db.query<
    {
      user_id: string;
      name: string;
      email: string;
      role: SchoolRole;
      created_at: number | string;
    } & Record<string, unknown>
  >(
    `SELECT m.user_id, u.name, u.email, m.role, m.created_at
       FROM school_members AS m
       JOIN school_users AS u ON u.id = m.user_id
      WHERE m.school_id = $1
      ORDER BY m.role, u.name`,
    [schoolId],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: Number(row.created_at),
  }));
}

interface ClassRow extends Record<string, unknown> {
  id: string;
  school_id: string;
  name: string;
  grade: string | null;
  section: string | null;
  created_at: number | string;
}

function toClass(row: ClassRow): SchoolClass {
  return {
    id: row.id,
    schoolId: row.school_id,
    name: row.name,
    grade: row.grade,
    section: row.section,
    createdAt: Number(row.created_at),
  };
}

export async function createClass(
  db: Queryable,
  input: { schoolId: string; name: string; grade?: string; section?: string },
): Promise<SchoolClass> {
  const id = newId('cls');
  const result = await db.query<ClassRow>(
    `INSERT INTO school_classes (id, school_id, name, grade, section, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, input.schoolId, input.name, input.grade ?? null, input.section ?? null, Date.now()],
  );
  return toClass(result.rows[0]!);
}

export async function getClass(db: Queryable, classId: string): Promise<SchoolClass | null> {
  const result = await db.query<ClassRow>(`SELECT * FROM school_classes WHERE id = $1`, [classId]);
  const row = result.rows[0];
  return row ? toClass(row) : null;
}

export async function listClasses(db: Queryable, schoolId: string): Promise<ClassSummary[]> {
  const result = await db.query<
    ClassRow & { student_count: string; teacher_count: string; course_count: string }
  >(
    `SELECT c.*,
            (SELECT COUNT(*) FROM school_class_members AS m
              WHERE m.class_id = c.id AND m.role = 'student')::text AS student_count,
            (SELECT COUNT(*) FROM school_class_members AS m
              WHERE m.class_id = c.id AND m.role = 'teacher')::text AS teacher_count,
            (SELECT COUNT(*) FROM school_class_courses AS cc
              WHERE cc.class_id = c.id)::text AS course_count
       FROM school_classes AS c
      WHERE c.school_id = $1
      ORDER BY c.grade NULLS LAST, c.section NULLS LAST, c.name`,
    [schoolId],
  );
  return result.rows.map((row) => ({
    ...toClass(row),
    studentCount: Number(row.student_count),
    teacherCount: Number(row.teacher_count),
    courseCount: Number(row.course_count),
  }));
}

/** The classes `userId` belongs to in `schoolId`, in either class role. */
export async function listClassesForMember(
  db: Queryable,
  schoolId: string,
  userId: string,
): Promise<SchoolClass[]> {
  const result = await db.query<ClassRow>(
    `SELECT c.*
       FROM school_classes AS c
       JOIN school_class_members AS m ON m.class_id = c.id
      WHERE c.school_id = $1 AND m.user_id = $2
      ORDER BY c.grade NULLS LAST, c.section NULLS LAST, c.name`,
    [schoolId, userId],
  );
  return result.rows.map(toClass);
}

export async function addClassMember(
  db: Queryable,
  classId: string,
  userId: string,
  role: ClassRole,
): Promise<void> {
  await db.query(
    `INSERT INTO school_class_members (class_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (class_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [classId, userId, role],
  );
}

export async function isClassTeacher(
  db: Queryable,
  classId: string,
  userId: string,
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM school_class_members WHERE class_id = $1 AND user_id = $2 AND role = 'teacher'`,
    [classId, userId],
  );
  return result.rows.length > 0;
}

export async function listClassMembers(db: Queryable, classId: string): Promise<ClassMemberInfo[]> {
  const result = await db.query<
    { user_id: string; name: string; email: string; role: ClassRole } & Record<string, unknown>
  >(
    `SELECT m.user_id, u.name, u.email, m.role
       FROM school_class_members AS m
       JOIN school_users AS u ON u.id = m.user_id
      WHERE m.class_id = $1
      ORDER BY m.role, u.name`,
    [classId],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
  }));
}

/** The owner of a live course, or `null` when it does not exist or is deleted. */
export async function stageOwner(db: Queryable, stageId: string): Promise<string | null> {
  const result = await db.query<{ owner_id: string } & Record<string, unknown>>(
    `SELECT owner_id FROM stage_meta WHERE stage_id = $1 AND deleted_at IS NULL`,
    [stageId],
  );
  return result.rows[0]?.owner_id ?? null;
}

export async function assignCourse(
  db: Queryable,
  classId: string,
  stageId: string,
  assignedBy: string,
): Promise<void> {
  await db.query(
    `INSERT INTO school_class_courses (class_id, stage_id, assigned_by, assigned_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (class_id, stage_id) DO NOTHING`,
    [classId, stageId, assignedBy, Date.now()],
  );
}

export async function unassignCourse(
  db: Queryable,
  classId: string,
  stageId: string,
): Promise<void> {
  await db.query(`DELETE FROM school_class_courses WHERE class_id = $1 AND stage_id = $2`, [
    classId,
    stageId,
  ]);
}

export async function listClassCourses(db: Queryable, classId: string): Promise<AssignedCourse[]> {
  const result = await db.query<
    {
      stage_id: string;
      name: string;
      description: string | null;
      scene_count: string;
      assigned_by: string;
      assigned_at: number | string;
    } & Record<string, unknown>
  >(
    `SELECT cc.stage_id, s.name, s.description, cc.assigned_by, cc.assigned_at,
            (SELECT COUNT(*) FROM document_scenes AS sc WHERE sc.stage_id = s.id)::text AS scene_count
       FROM school_class_courses AS cc
       JOIN document_stages AS s ON s.id = cc.stage_id
       JOIN stage_meta AS meta ON meta.stage_id = s.id
      WHERE cc.class_id = $1 AND meta.deleted_at IS NULL
      ORDER BY cc.assigned_at DESC`,
    [classId],
  );
  return result.rows.map((row) => ({
    stageId: row.stage_id,
    name: row.name,
    description: row.description,
    sceneCount: Number(row.scene_count),
    assignedBy: row.assigned_by,
    assignedAt: Number(row.assigned_at),
  }));
}
