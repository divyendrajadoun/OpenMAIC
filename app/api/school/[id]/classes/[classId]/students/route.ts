/**
 * POST /api/school/[id]/classes/[classId]/students — add students in bulk.
 *
 * Body: { students: [{ name, email?, password? }] }, up to 200 at once. A
 * student without an email gets a login id of the form
 * `<name>.<n>@<school code>`, and one without a password gets a readable
 * generated one. The response lists every created login with its password
 * exactly once, for the teacher to hand out; nothing stores it in clear.
 * An email that already belongs to an account in this school is simply
 * enrolled in the class.
 */
import type { NextRequest } from 'next/server';

import { isServerPersistenceConfigured } from '@/lib/config/feature-flags';
import { ownerApiError, ownerJson, ownerNotFound } from '@/lib/server/agent-runtime/route-response';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import {
  EMAIL_MAX_LENGTH,
  EmailTakenError,
  NAME_MAX_LENGTH,
  createUser,
  findUserByEmail,
  isUsableEmail,
  normalizeEmail,
} from '@/lib/server/school/accounts';
import { classAccess } from '@/lib/server/school/class-access';
import { getSchoolDb } from '@/lib/server/school/db';
import { optionalString, readJsonObject, requireAccount } from '@/lib/server/school/http';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  generateReadablePassword,
} from '@/lib/server/school/passwords';
import {
  addClassMember,
  addSchoolMember,
  getSchool,
  roleInSchool,
} from '@/lib/server/school/schools';

export const runtime = 'nodejs';

const MAX_STUDENTS_PER_REQUEST = 200;

type Params = { params: Promise<{ id: string; classId: string }> };

interface StudentInput {
  name: string;
  email?: string;
  password?: string;
}

function parseStudents(value: unknown): StudentInput[] | string {
  if (!Array.isArray(value) || value.length === 0) return 'students must be a non-empty array';
  if (value.length > MAX_STUDENTS_PER_REQUEST) {
    return `at most ${MAX_STUDENTS_PER_REQUEST} students per request`;
  }
  const students: StudentInput[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'object' || item === null) return `students[${index}] must be an object`;
    const record = item as Record<string, unknown>;
    const name = optionalString(record.name, NAME_MAX_LENGTH);
    if (!name) return `students[${index}].name is required`;
    const email = optionalString(record.email, EMAIL_MAX_LENGTH);
    if (email !== undefined && !isUsableEmail(normalizeEmail(email))) {
      return `students[${index}].email is not usable`;
    }
    const password = typeof record.password === 'string' ? record.password : undefined;
    if (
      password !== undefined &&
      (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)
    ) {
      return `students[${index}].password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`;
    }
    students.push({ name, ...(email ? { email } : {}), ...(password ? { password } : {}) });
  }
  return students;
}

/** `aarav.sharma` from `Aarav Sharma`; ASCII letters and digits only. */
function loginSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '.')
    .slice(0, 40);
  return slug || 'student';
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!isServerPersistenceConfigured()) return new Response('Not found', { status: 404 });
  const { id, classId } = await params;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return parsed.response;
  const students = parseStudents(parsed.body.students);

  return withRequestOwner(req, async (principal, headers) => {
    const refused = requireAccount(principal, headers);
    if (refused) return refused;
    if (typeof students === 'string') {
      return ownerApiError('INVALID_REQUEST', 400, students, headers);
    }
    const db = await getSchoolDb();
    const access = await classAccess(db, id, classId, principal);
    if (!access?.canManage) return ownerNotFound(headers);
    const school = await getSchool(db, id);
    if (!school) return ownerNotFound(headers);

    const created: { userId: string; name: string; email: string; password: string }[] = [];
    const enrolled: { userId: string; name: string; email: string }[] = [];
    const failed: { name: string; email?: string; reason: string }[] = [];

    for (const student of students) {
      if (student.email) {
        const existing = await findUserByEmail(db, student.email);
        if (existing) {
          const role = await roleInSchool(db, id, existing.id);
          if (role && role !== 'student') {
            failed.push({ name: student.name, email: student.email, reason: 'not a student' });
            continue;
          }
          if (!role) {
            failed.push({
              name: student.name,
              email: student.email,
              reason: 'account belongs to another school',
            });
            continue;
          }
          await addClassMember(db, classId, existing.id, 'student');
          enrolled.push({ userId: existing.id, name: existing.name, email: existing.email });
          continue;
        }
      }
      const password = student.password ?? generateReadablePassword();
      let email = student.email ? normalizeEmail(student.email) : undefined;
      let user;
      for (let attempt = 0; attempt < 5 && !user; attempt += 1) {
        const candidate =
          email ??
          `${loginSlug(student.name)}.${100 + Math.floor(Math.random() * 900)}@${school.code}`;
        try {
          user = await createUser(db, { name: student.name, email: candidate, password });
        } catch (error) {
          if (!(error instanceof EmailTakenError)) throw error;
          if (email) break; // a given email that is taken is reported, not retried
          email = undefined;
        }
      }
      if (!user) {
        failed.push({ name: student.name, email: student.email, reason: 'login already taken' });
        continue;
      }
      await addSchoolMember(db, id, user.id, 'student');
      await addClassMember(db, classId, user.id, 'student');
      created.push({ userId: user.id, name: user.name, email: user.email, password });
    }
    return ownerJson({ created, enrolled, failed }, 201, headers);
  });
}
