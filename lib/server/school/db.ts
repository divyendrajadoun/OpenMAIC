/**
 * The school tenancy tables: accounts, sessions, schools, classes, rosters,
 * course assignments and invites.
 *
 * They live beside the course tables in the same PostgreSQL database and are
 * created lazily, once per pool, under the same bootstrap lock the persistence
 * provider uses, so two instances starting together cannot race on
 * `CREATE TABLE`. Every statement is idempotent (`IF NOT EXISTS`), the same
 * posture as `lib/persistence/stage-meta.ts`.
 *
 * Owner ids for accounts are `user:<id>`; the auth method in
 * `lib/server/identity/host/school-session.ts` mints them and this module is
 * the only place that knows how they map to `school_users.id`.
 */
import type { Queryable } from '@openmaic/storage/document/pg';
import type { ConnectableQueryable } from '@openmaic/storage/server/reference';

import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { withSchemaBootstrapLock } from '@/lib/persistence/schema-bootstrap-lock';

export const SCHOOL_ROLES = ['admin', 'teacher', 'student', 'parent'] as const;
export type SchoolRole = (typeof SCHOOL_ROLES)[number];
export const CLASS_ROLES = ['teacher', 'student'] as const;
export type ClassRole = (typeof CLASS_ROLES)[number];

export function isSchoolRole(value: unknown): value is SchoolRole {
  return typeof value === 'string' && (SCHOOL_ROLES as readonly string[]).includes(value);
}

export const SCHOOL_SCHEMA = `
CREATE TABLE IF NOT EXISTS school_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS school_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES school_users(id) ON DELETE CASCADE,
  created_at DOUBLE PRECISION NOT NULL,
  expires_at DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS school_sessions_user_idx ON school_sessions (user_id);

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  board TEXT,
  language TEXT NOT NULL DEFAULT 'hinglish',
  created_by TEXT NOT NULL REFERENCES school_users(id),
  created_at DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS school_members (
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES school_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
  created_at DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (school_id, user_id)
);

CREATE INDEX IF NOT EXISTS school_members_user_idx ON school_members (user_id);

CREATE TABLE IF NOT EXISTS school_classes (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grade TEXT,
  section TEXT,
  created_at DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS school_classes_school_idx ON school_classes (school_id);

CREATE TABLE IF NOT EXISTS school_class_members (
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES school_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
  PRIMARY KEY (class_id, user_id)
);

CREATE INDEX IF NOT EXISTS school_class_members_user_idx ON school_class_members (user_id);

CREATE TABLE IF NOT EXISTS school_class_courses (
  class_id TEXT NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES document_stages(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL,
  assigned_at DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (class_id, stage_id)
);

CREATE INDEX IF NOT EXISTS school_class_courses_stage_idx ON school_class_courses (stage_id);

CREATE TABLE IF NOT EXISTS school_invites (
  code TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student', 'parent')),
  class_id TEXT REFERENCES school_classes(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL,
  created_at DOUBLE PRECISION NOT NULL,
  expires_at DOUBLE PRECISION,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS school_parent_links (
  parent_user_id TEXT NOT NULL REFERENCES school_users(id) ON DELETE CASCADE,
  student_user_id TEXT NOT NULL REFERENCES school_users(id) ON DELETE CASCADE,
  PRIMARY KEY (parent_user_id, student_user_id)
);
`;

/** Run every statement of {@link SCHOOL_SCHEMA}; idempotent. */
export async function ensureSchoolSchema(queryable: Queryable): Promise<void> {
  for (const sql of SCHOOL_SCHEMA.split(';')) {
    const statement = sql.trim();
    if (statement) await queryable.query(statement);
  }
}

const STATE_KEY = Symbol.for('soai.school.schema-state');
const globalState = globalThis as typeof globalThis & {
  [STATE_KEY]?: WeakMap<object, Promise<void>>;
};

/**
 * The database the school tables live in, with the schema ensured.
 *
 * Memoised per pool: the first caller on a pool runs the schema under the
 * bootstrap lock and every later caller awaits the same promise. A failed
 * bootstrap is forgotten so the next request retries it.
 */
export async function getSchoolDb(): Promise<Queryable> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('School features require DATABASE_URL');
  const { pool } = await getServerPersistenceProvider(connectionString);
  const state = (globalState[STATE_KEY] ??= new WeakMap());
  let ensured = state.get(pool);
  if (!ensured) {
    ensured = withSchemaBootstrapLock(pool as unknown as ConnectableQueryable, (locked) =>
      ensureSchoolSchema(locked),
    ).catch((error: unknown) => {
      state.delete(pool);
      throw error;
    });
    state.set(pool, ensured);
  }
  await ensured;
  return pool as unknown as Queryable;
}

/** Reset the per-pool memo (tests). */
export function resetSchoolSchemaStateForTests(): void {
  delete globalState[STATE_KEY];
}
