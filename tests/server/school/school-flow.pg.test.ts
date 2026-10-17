/**
 * The school foundation end to end on a real PostgreSQL: an account signs up,
 * its session resolves to a `user:` principal with school roles, a school and
 * class are created, a student is enrolled and a course assigned, and the
 * library hook lists that course for the student. Runs only with
 * PG_CONTRACT_URL, like the other `.pg` suites.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { schoolSessionAuthMethod } from '@/lib/server/identity/host/school-session';
import {
  createSession,
  createUser,
  deleteSession,
  listMemberships,
  readSession,
  verifyLogin,
} from '@/lib/server/school/accounts';
import { ensureSchoolSchema, resetSchoolSchemaStateForTests } from '@/lib/server/school/db';
import { schoolPersistenceHooks } from '@/lib/server/school/hooks';
import { createInvite, redeemInvite } from '@/lib/server/school/invites';
import { hashPassword, verifyPassword } from '@/lib/server/school/passwords';
import {
  addClassMember,
  assignCourse,
  createClass,
  createSchool,
  listClassCourses,
  roleInSchool,
} from '@/lib/server/school/schools';

const contractUrl = process.env.PG_CONTRACT_URL;
const TEST_SCHEMA = 'soai_school_flow_test';
const NOW = 1_800_000_000_000;

describe.skipIf(!contractUrl)('school foundation on PostgreSQL', () => {
  let admin: Pool;
  let pool: Pool;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    admin = new Pool({ connectionString: contractUrl });
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    pool = new Pool({
      connectionString: contractUrl,
      options: `-c search_path=${TEST_SCHEMA}`,
      max: 4,
    });
    const databaseUrl = `${contractUrl}${contractUrl!.includes('?') ? '&' : '?'}application_name=school-flow`;
    process.env.DATABASE_URL = databaseUrl;
    resetSchoolSchemaStateForTests();
    await getServerPersistenceProvider(databaseUrl, () => pool);
    await ensureSchoolSchema(pool);
  });

  afterAll(async () => {
    process.env.DATABASE_URL = previousDatabaseUrl;
    await pool.end().catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await admin.end();
  });

  it('hashes and verifies passwords', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored.startsWith('scrypt$16384$')).toBe(true);
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('runs the sign-up, school, class, assignment and library flow', async () => {
    const principalUser = await createUser(pool, {
      email: 'Principal@Example.org',
      name: 'Principal',
      password: 'principal-pass',
    });
    expect(principalUser.email).toBe('principal@example.org');
    await expect(
      createUser(pool, { email: 'principal@example.org', name: 'Dup', password: 'xxxxxxxx' }),
    ).rejects.toThrow('email already registered');

    expect(await verifyLogin(pool, 'principal@example.org', 'wrong')).toBeNull();
    expect((await verifyLogin(pool, 'PRINCIPAL@example.org', 'principal-pass'))?.id).toBe(
      principalUser.id,
    );
    expect(await verifyLogin(pool, 'nobody@example.org', 'principal-pass')).toBeNull();

    // A session resolves to a user principal; before any school, no roles.
    const token = await createSession(pool, principalUser.id);
    const resolved = await readSession(pool, token);
    expect(resolved?.principal).toMatchObject({
      ownerId: `user:${principalUser.id}`,
      kind: 'user',
      assurance: 'verified',
    });
    expect(resolved?.principal.roles.size).toBe(0);

    // The auth method: absent cookie is not-applicable, bad cookie is invalid.
    expect(await schoolSessionAuthMethod.authenticate({ headers: new Headers() })).toEqual({
      status: 'not-applicable',
    });
    expect(
      (
        await schoolSessionAuthMethod.authenticate({
          headers: new Headers({ cookie: 'soai_session=not-a-real-token-value-at-all' }),
        })
      ).status,
    ).toBe('invalid');
    const viaMethod = await schoolSessionAuthMethod.authenticate({
      headers: new Headers({ cookie: `other=1; soai_session=${token}` }),
    });
    expect(viaMethod.status).toBe('authenticated');

    // Create a school: the creator is its admin and gains publish.
    const school = await createSchool(pool, {
      name: 'Sunrise Public School',
      createdBy: principalUser.id,
    });
    expect(school.code).toMatch(/^[a-z0-9]{6}$/);
    expect(await roleInSchool(pool, school.id, principalUser.id)).toBe('admin');
    const afterSchool = await readSession(pool, token);
    expect([...afterSchool!.principal.roles].sort()).toEqual(['course:publish', 'school:admin']);
    expect(await listMemberships(pool, principalUser.id)).toEqual([
      {
        schoolId: school.id,
        schoolName: 'Sunrise Public School',
        schoolCode: school.code,
        role: 'admin',
      },
    ]);

    // A class, a teacher invite redeemed by a new teacher, a student enrolled.
    const klass = await createClass(pool, {
      schoolId: school.id,
      name: 'Class 8 A',
      grade: '8',
      section: 'A',
    });
    const invite = await createInvite(pool, {
      schoolId: school.id,
      role: 'teacher',
      classId: klass.id,
      createdBy: principalUser.id,
      maxUses: 1,
    });
    expect(await redeemInvite(pool, invite.code.toLowerCase(), { dryRun: true })).not.toBeNull();
    const teacher = await createUser(pool, {
      email: 't@example.org',
      name: 'Teacher',
      password: 'teacher-pass',
    });
    expect(
      await redeemInvite(pool, invite.code, { dryRun: false, userId: teacher.id }),
    ).not.toBeNull();
    // Used up now.
    expect(await redeemInvite(pool, invite.code, { dryRun: true })).toBeNull();
    expect(await roleInSchool(pool, school.id, teacher.id)).toBe('teacher');

    const student = await createUser(pool, {
      email: 'aarav.123@' + school.code,
      name: 'Aarav',
      password: 'student-pass',
    });
    await addClassMember(pool, klass.id, student.id, 'student');

    // A course the teacher owns, assigned to the class.
    const stageId = 'stage-school-flow-1';
    await pool.query(
      `INSERT INTO document_stages (id, name, created_at, updated_at, data) VALUES ($1, $2, $3, $3, '{}'::jsonb)`,
      [stageId, 'Photosynthesis', NOW],
    );
    await pool.query(`INSERT INTO stage_meta (stage_id, owner_id) VALUES ($1, $2)`, [
      stageId,
      `user:${teacher.id}`,
    ]);
    await assignCourse(pool, klass.id, stageId, teacher.id);
    expect((await listClassCourses(pool, klass.id)).map((course) => course.stageId)).toEqual([
      stageId,
    ]);

    // The library hook lists it for the student, who owns nothing.
    const studentPrincipal = (await readSession(pool, await createSession(pool, student.id)))!
      .principal;
    const listed = await schoolPersistenceHooks.library!.list({
      principal: studentPrincipal,
      queryable: pool,
      ownedStageIds: async () => [],
    });
    expect(listed).toEqual([stageId]);

    // And for the admin, through the school-wide rule, after their own.
    const adminListed = await schoolPersistenceHooks.library!.list({
      principal: afterSchool!.principal,
      queryable: pool,
      ownedStageIds: async () => ['stage-owned-by-admin'],
    });
    expect(adminListed).toEqual(['stage-owned-by-admin', stageId]);

    // Logout drops the session.
    await deleteSession(pool, token);
    expect(await readSession(pool, token)).toBeNull();
  });
});
