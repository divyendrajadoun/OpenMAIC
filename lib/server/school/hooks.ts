/**
 * The school's persistence hooks: what the course library lists for an
 * account.
 *
 * A student's library is the courses assigned to the classes they belong to.
 * A teacher sees their own courses plus those assigned to classes they teach.
 * A school admin sees everything assigned anywhere in their schools. Owned
 * courses always come first; the provider only names ids, and the route's
 * access rule (`lib/persistence/library.ts`) decides what is listable.
 */
import type { LibraryListContext, PersistenceHooks } from '@/lib/server/persistence-hooks';

import { schoolRoleName, userIdFromOwnerId } from './accounts';

interface StageIdRow extends Record<string, unknown> {
  stage_id: string;
}

async function listForAccount(context: LibraryListContext): Promise<readonly string[]> {
  const owned = await context.ownedStageIds();
  const userId = userIdFromOwnerId(context.principal.ownerId);
  if (!userId || context.principal.kind !== 'user') return owned;

  const assignedToMyClasses = await context.queryable.query<StageIdRow>(
    `SELECT DISTINCT cc.stage_id
       FROM school_class_courses AS cc
       JOIN school_class_members AS cm ON cm.class_id = cc.class_id
      WHERE cm.user_id = $1`,
    [userId],
  );
  const ids = [...owned, ...assignedToMyClasses.rows.map((row) => row.stage_id)];

  if (context.principal.roles.has(schoolRoleName('admin'))) {
    const assignedInMySchools = await context.queryable.query<StageIdRow>(
      `SELECT DISTINCT cc.stage_id
         FROM school_class_courses AS cc
         JOIN school_classes AS c ON c.id = cc.class_id
         JOIN school_members AS m ON m.school_id = c.school_id
        WHERE m.user_id = $1 AND m.role = 'admin'`,
      [userId],
    );
    ids.push(...assignedInMySchools.rows.map((row) => row.stage_id));
  }
  return ids;
}

export const schoolPersistenceHooks: PersistenceHooks = {
  name: 'school',
  library: { name: 'school-library', list: listForAccount },
};
