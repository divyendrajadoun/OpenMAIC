/**
 * Staff-only route guard: the request owner must be a signed-in admin or
 * teacher of the school. Non-members and students get the same 404 the other
 * school routes answer with, so the school's existence is not revealed.
 */
import type { NextResponse } from 'next/server';
import type { Queryable } from '@openmaic/storage/document/pg';

import { ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import type { OwnerPrincipal } from '@/lib/server/identity';

import type { SchoolRole } from './db';
import { requireAccount } from './http';
import { isStaff, schoolAccess } from './schools';

export interface StaffAccess {
  userId: string;
  role: SchoolRole;
}

export async function requireStaff(
  db: Queryable,
  schoolId: string,
  principal: OwnerPrincipal,
  headers: Headers,
): Promise<{ ok: true; access: StaffAccess } | { ok: false; response: NextResponse }> {
  const refused = requireAccount(principal, headers);
  if (refused) return { ok: false, response: refused };
  const access = await schoolAccess(db, schoolId, principal);
  if (!access || !isStaff(access.role)) return { ok: false, response: ownerNotFound(headers) };
  return { ok: true, access };
}
