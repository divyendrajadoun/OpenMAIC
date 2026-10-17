/**
 * The access rule the class routes share: the caller must be a member of the
 * class's school, and for a write they must be an admin or the class's
 * teacher. Anything else is the plain 404.
 */
import type { Queryable } from '@openmaic/storage/document/pg';

import type { OwnerPrincipal } from '@/lib/server/identity';

import type { SchoolRole } from './db';
import { type SchoolClass, getClass, isClassTeacher, schoolAccess } from './schools';

export interface ClassAccess {
  userId: string;
  role: SchoolRole;
  klass: SchoolClass;
  /** Admin of the school, or a teacher of this class. */
  canManage: boolean;
}

export async function classAccess(
  db: Queryable,
  schoolId: string,
  classId: string,
  principal: OwnerPrincipal,
): Promise<ClassAccess | null> {
  const access = await schoolAccess(db, schoolId, principal);
  if (!access) return null;
  const klass = await getClass(db, classId);
  if (!klass || klass.schoolId !== schoolId) return null;
  const canManage =
    access.role === 'admin' ||
    (access.role === 'teacher' && (await isClassTeacher(db, classId, access.userId)));
  return { userId: access.userId, role: access.role, klass, canManage };
}
