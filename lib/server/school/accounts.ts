/**
 * Accounts and sessions over the school tables (`./db.ts`).
 *
 * A session is a random token the browser holds in a cookie; only its SHA-256
 * is stored, so a database read cannot be replayed as a login. The principal a
 * session resolves to carries the account's school memberships as roles, so
 * every owner-scoped route can authorize from `principal.roles` alone.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { Queryable } from '@openmaic/storage/document/pg';

import { OWNER_ROLES, type OwnerPrincipal } from '@/lib/server/identity';

import { type SchoolRole } from './db';
import { hashPassword, verifyPassword } from './passwords';

export const OWNER_ID_PREFIX = 'user:';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 80;

export interface SchoolUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

export interface Membership {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  role: SchoolRole;
}

/** The role a school membership grants on the owner principal. */
export function schoolRoleName(role: SchoolRole): string {
  return `school:${role}`;
}

export function ownerIdForUser(userId: string): string {
  return `${OWNER_ID_PREFIX}${userId}`;
}

/** The account id behind an owner id this module minted, or `undefined`. */
export function userIdFromOwnerId(ownerId: string): string | undefined {
  return ownerId.startsWith(OWNER_ID_PREFIX) ? ownerId.slice(OWNER_ID_PREFIX.length) : undefined;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Loose on purpose: school logins may be `rollno@school-code`, not a mailbox. */
export function isUsableEmail(email: string): boolean {
  return email.length >= 3 && email.length <= EMAIL_MAX_LENGTH && /^[^\s@]+@[^\s@]+$/.test(email);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export class EmailTakenError extends Error {
  constructor() {
    super('email already registered');
    this.name = 'EmailTakenError';
  }
}

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number | string;
}

function toUser(row: UserRow): SchoolUser {
  return { id: row.id, email: row.email, name: row.name, createdAt: Number(row.created_at) };
}

export async function createUser(
  db: Queryable,
  input: { email: string; name: string; password: string },
): Promise<SchoolUser> {
  const id = newId('usr');
  const now = Date.now();
  const passwordHash = await hashPassword(input.password);
  const email = normalizeEmail(input.email);
  const result = await db.query<UserRow>(
    `INSERT INTO school_users (id, email, name, password_hash, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, name, password_hash, created_at`,
    [id, email, input.name.trim(), passwordHash, now],
  );
  const row = result.rows[0];
  if (!row) throw new EmailTakenError();
  return toUser(row);
}

export async function findUserByEmail(db: Queryable, email: string): Promise<SchoolUser | null> {
  const result = await db.query<UserRow>(
    `SELECT id, email, name, password_hash, created_at FROM school_users WHERE email = $1`,
    [normalizeEmail(email)],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export async function findUserById(db: Queryable, id: string): Promise<SchoolUser | null> {
  const result = await db.query<UserRow>(
    `SELECT id, email, name, password_hash, created_at FROM school_users WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

/** The account when `email`/`password` are right; `null` otherwise, in constant-ish time. */
export async function verifyLogin(
  db: Queryable,
  email: string,
  password: string,
): Promise<SchoolUser | null> {
  const result = await db.query<UserRow>(
    `SELECT id, email, name, password_hash, created_at FROM school_users WHERE email = $1`,
    [normalizeEmail(email)],
  );
  const row = result.rows[0];
  // Verify against a dummy hash when the account is unknown so timing does
  // not reveal which emails exist.
  const stored = row?.password_hash ?? UNKNOWN_ACCOUNT_HASH;
  const ok = await verifyPassword(password, stored);
  return ok && row ? toUser(row) : null;
}

const UNKNOWN_ACCOUNT_HASH =
  'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Mint a session; the returned token goes into the cookie and is never stored. */
export async function createSession(db: Queryable, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await db.query(
    `INSERT INTO school_sessions (token_hash, user_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashToken(token), userId, now, now + SESSION_MAX_AGE_MS],
  );
  return token;
}

export async function deleteSession(db: Queryable, token: string): Promise<void> {
  await db.query(`DELETE FROM school_sessions WHERE token_hash = $1`, [hashToken(token)]);
}

interface SessionRow extends Record<string, unknown> {
  user_id: string;
  expires_at: number | string;
  email: string;
  name: string;
  created_at: number | string;
  school_id: string | null;
  school_name: string | null;
  school_code: string | null;
  role: SchoolRole | null;
}

export interface ResolvedSession {
  user: SchoolUser;
  memberships: Membership[];
  principal: OwnerPrincipal;
}

/** Roles for a principal: one per membership, plus publish for staff. */
export function rolesForMemberships(memberships: readonly Membership[]): ReadonlySet<string> {
  const roles = new Set<string>();
  for (const membership of memberships) {
    roles.add(schoolRoleName(membership.role));
    if (membership.role === 'admin' || membership.role === 'teacher') {
      roles.add(OWNER_ROLES.coursePublish);
    }
  }
  return roles;
}

export function principalForUser(
  userId: string,
  memberships: readonly Membership[],
): OwnerPrincipal {
  return {
    ownerId: ownerIdForUser(userId),
    kind: 'user',
    roles: rolesForMemberships(memberships),
    assurance: 'verified',
    channel: 'web',
  };
}

/**
 * The account and memberships a session token names, or `null` when the token
 * is unknown or expired. Expired rows are dropped as they are met.
 */
export async function readSession(db: Queryable, token: string): Promise<ResolvedSession | null> {
  const result = await db.query<SessionRow>(
    `SELECT s.user_id, s.expires_at, u.email, u.name, u.created_at,
            m.school_id, m.role, sc.name AS school_name, sc.code AS school_code
       FROM school_sessions AS s
       JOIN school_users AS u ON u.id = s.user_id
       LEFT JOIN school_members AS m ON m.user_id = s.user_id
       LEFT JOIN schools AS sc ON sc.id = m.school_id
      WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  const first = result.rows[0];
  if (!first) return null;
  if (Number(first.expires_at) <= Date.now()) {
    await db.query(`DELETE FROM school_sessions WHERE token_hash = $1`, [hashToken(token)]);
    return null;
  }
  const user: SchoolUser = {
    id: first.user_id,
    email: first.email,
    name: first.name,
    createdAt: Number(first.created_at),
  };
  const memberships = membershipsFromRows(result.rows);
  return { user, memberships, principal: principalForUser(user.id, memberships) };
}

function membershipsFromRows(
  rows: readonly Pick<SessionRow, 'school_id' | 'school_name' | 'school_code' | 'role'>[],
): Membership[] {
  const memberships: Membership[] = [];
  for (const row of rows) {
    if (!row.school_id || !row.role) continue;
    memberships.push({
      schoolId: row.school_id,
      schoolName: row.school_name ?? '',
      schoolCode: row.school_code ?? '',
      role: row.role,
    });
  }
  return memberships;
}

export async function listMemberships(db: Queryable, userId: string): Promise<Membership[]> {
  const result = await db.query<
    Pick<SessionRow, 'school_id' | 'school_name' | 'school_code' | 'role'> & Record<string, unknown>
  >(
    `SELECT m.school_id, m.role, sc.name AS school_name, sc.code AS school_code
       FROM school_members AS m
       JOIN schools AS sc ON sc.id = m.school_id
      WHERE m.user_id = $1
      ORDER BY m.created_at`,
    [userId],
  );
  return membershipsFromRows(result.rows);
}
