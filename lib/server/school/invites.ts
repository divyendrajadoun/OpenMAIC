/**
 * Invite codes: a school admin (or a teacher, for their class) mints a code;
 * registering with it joins the school in that role, and the class when the
 * invite names one.
 */
import { randomBytes } from 'node:crypto';

import type { Queryable } from '@openmaic/storage/document/pg';

import type { SchoolRole } from './db';
import { addClassMember, addSchoolMember } from './schools';

export interface Invite {
  code: string;
  schoolId: string;
  role: SchoolRole;
  classId: string | null;
  createdBy: string;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
}

interface InviteRow extends Record<string, unknown> {
  code: string;
  school_id: string;
  role: SchoolRole;
  class_id: string | null;
  created_by: string;
  created_at: number | string;
  expires_at: number | string | null;
  max_uses: number | null;
  uses: number;
}

function toInvite(row: InviteRow): Invite {
  return {
    code: row.code,
    schoolId: row.school_id,
    role: row.role,
    classId: row.class_id,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    maxUses: row.max_uses,
    uses: Number(row.uses),
  };
}

/** 8 characters, no look-alikes, easy to read out over the phone. */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

export function normalizeInviteCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export async function createInvite(
  db: Queryable,
  input: {
    schoolId: string;
    role: SchoolRole;
    classId?: string;
    createdBy: string;
    expiresInDays?: number;
    maxUses?: number;
  },
): Promise<Invite> {
  const now = Date.now();
  const expiresAt =
    input.expiresInDays === undefined ? null : now + input.expiresInDays * 24 * 60 * 60 * 1000;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    const result = await db.query<InviteRow>(
      `INSERT INTO school_invites
         (code, school_id, role, class_id, created_by, created_at, expires_at, max_uses)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (code) DO NOTHING
       RETURNING *`,
      [
        code,
        input.schoolId,
        input.role,
        input.classId ?? null,
        input.createdBy,
        now,
        expiresAt,
        input.maxUses ?? null,
      ],
    );
    const row = result.rows[0];
    if (row) return toInvite(row);
  }
  throw new Error('could not mint a unique invite code');
}

export async function listInvites(db: Queryable, schoolId: string): Promise<Invite[]> {
  const result = await db.query<InviteRow>(
    `SELECT * FROM school_invites WHERE school_id = $1 ORDER BY created_at DESC`,
    [schoolId],
  );
  return result.rows.map(toInvite);
}

function isRedeemable(invite: Invite, now: number): boolean {
  if (invite.expiresAt !== null && invite.expiresAt <= now) return false;
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return false;
  return true;
}

/**
 * Look an invite up (`dryRun: true`), or consume one use and join `userId` to
 * its school and class (`dryRun: false`). `null` when the code is unknown,
 * expired or used up.
 */
export async function redeemInvite(
  db: Queryable,
  code: string,
  options: { dryRun: true } | { dryRun: false; userId: string },
): Promise<Invite | null> {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return null;
  const now = Date.now();
  if (options.dryRun) {
    const result = await db.query<InviteRow>(`SELECT * FROM school_invites WHERE code = $1`, [
      normalized,
    ]);
    const row = result.rows[0];
    if (!row) return null;
    const invite = toInvite(row);
    return isRedeemable(invite, now) ? invite : null;
  }
  const result = await db.query<InviteRow>(
    `UPDATE school_invites
        SET uses = uses + 1
      WHERE code = $1
        AND (expires_at IS NULL OR expires_at > $2)
        AND (max_uses IS NULL OR uses < max_uses)
      RETURNING *`,
    [normalized, now],
  );
  const row = result.rows[0];
  if (!row) return null;
  const invite = toInvite(row);
  await addSchoolMember(db, invite.schoolId, options.userId, invite.role);
  if (invite.classId && (invite.role === 'student' || invite.role === 'teacher')) {
    await addClassMember(db, invite.classId, options.userId, invite.role);
  }
  return invite;
}
