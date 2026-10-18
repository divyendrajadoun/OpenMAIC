'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, LoaderCircle, Plus } from 'lucide-react';

import { Section, Shell } from '@/components/school/shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAccount, type AccountMembership } from '@/lib/hooks/use-account';
import { useI18n } from '@/lib/hooks/use-i18n';

type Role = AccountMembership['role'];

interface SchoolInfo {
  id: string;
  name: string;
  code: string;
  board: string | null;
  language: string;
}
interface ClassInfo {
  id: string;
  name: string;
  grade: string | null;
  section: string | null;
  studentCount?: number;
  teacherCount?: number;
  courseCount?: number;
}
interface MemberInfo {
  userId: string;
  name: string;
  email: string;
  role: Role;
}
interface InviteInfo {
  code: string;
  role: Role;
  classId: string | null;
  uses: number;
  maxUses: number | null;
}
interface SchoolDetail {
  school: SchoolInfo;
  role: Role;
  classes: ClassInfo[];
  members?: MemberInfo[];
  invites?: InviteInfo[];
}
interface ClassDetail {
  class: ClassInfo;
  canManage: boolean;
  members: { userId: string; name: string; email?: string; role: 'teacher' | 'student' }[];
  courses: { stageId: string; name: string; sceneCount: number }[];
}
interface LibraryStage {
  id: string;
  name: string;
}
interface CreatedStudent {
  name: string;
  email: string;
  password: string;
}

async function postJson<T>(url: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? t('school.copied') : t('school.copy')}
    </button>
  );
}

export function SchoolDashboard() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const account = useAccount();
  // The school shown: the one the user picked, else their first membership.
  // Derived rather than synced into state, so a refreshed account (after
  // creating or joining a school) is reflected without an effect.
  const [pickedSchoolId, setSchoolId] = useState<string | null>(null);
  const schoolId = pickedSchoolId ?? account.user?.memberships[0]?.schoolId ?? null;
  const classId = params.get('class');

  useEffect(() => {
    if (account.loading || !account.enabled || account.user) return;
    router.replace('/login?next=/school');
  }, [account.loading, account.enabled, account.user, router]);

  if (account.loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!account.enabled) {
    return <Shell title={t('school.dashboard')}>{t('school.needsServer')}</Shell>;
  }
  if (!account.user) return null;

  if (!schoolId) {
    return (
      <Shell title={t('school.dashboard')}>
        <NoSchoolYet
          onCreated={(id) => {
            setSchoolId(id);
            void account.refresh();
          }}
        />
      </Shell>
    );
  }

  if (classId) {
    return (
      <Shell title={t('school.dashboard')} back={() => router.push('/school')}>
        <ClassView schoolId={schoolId} classId={classId} />
      </Shell>
    );
  }

  return (
    <Shell title={t('school.dashboard')}>
      {account.user.memberships.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {account.user.memberships.map((membership) => (
            <Button
              key={membership.schoolId}
              size="sm"
              variant={membership.schoolId === schoolId ? 'default' : 'outline'}
              onClick={() => setSchoolId(membership.schoolId)}
            >
              {membership.schoolName}
            </Button>
          ))}
        </div>
      )}
      <SchoolView schoolId={schoolId} onOpenClass={(id) => router.push(`/school?class=${id}`)} />
    </Shell>
  );
}

function NoSchoolYet({ onCreated }: { onCreated: (schoolId: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [board, setBoard] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await postJson<{ school: SchoolInfo }>('/api/school', {
        name,
        ...(board ? { board } : {}),
      });
      onCreated(data.school.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function join(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await postJson<{ schools: AccountMembership[] }>('/api/school/join', {
        inviteCode,
      });
      const first = data.schools[data.schools.length - 1];
      if (first) onCreated(first.schoolId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title={t('school.createSchoolTitle')}>
        <p className="mb-3 text-sm text-muted-foreground">{t('school.createSchoolHint')}</p>
        <form onSubmit={create} className="flex flex-col gap-2 md:flex-row">
          <Input
            placeholder={t('school.schoolName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            placeholder={t('school.board')}
            value={board}
            onChange={(e) => setBoard(e.target.value)}
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            {t('school.create')}
          </Button>
        </form>
      </Section>
      <Section title={t('school.joinWithInvite')}>
        <form onSubmit={join} className="flex flex-col gap-2 md:flex-row">
          <Input
            placeholder={t('school.inviteCode')}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
          />
          <Button type="submit" variant="outline" disabled={busy || !inviteCode.trim()}>
            {t('school.join')}
          </Button>
        </form>
      </Section>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}

function SchoolView({
  schoolId,
  onOpenClass,
}: {
  schoolId: string;
  onOpenClass: (classId: string) => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<SchoolDetail | null>(null);
  const [error, setError] = useState('');
  const [className, setClassName] = useState('');
  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('teacher');
  const [inviteClass, setInviteClass] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await getJson<SchoolDetail>(`/api/school/${schoolId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [schoolId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!detail) return <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />;

  const staff = detail.role === 'admin' || detail.role === 'teacher';
  const roleLabel = t(`school.role.${detail.role}`);

  async function createClass(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await postJson(`/api/school/${schoolId}/classes`, {
        name: className,
        ...(grade ? { grade } : {}),
        ...(section ? { section } : {}),
      });
      setClassName('');
      setGrade('');
      setSection('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await postJson(`/api/school/${schoolId}/invites`, {
        role: inviteRole,
        ...(inviteClass ? { classId: inviteClass } : {}),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section title={detail.school.name}>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            {t('school.schoolCode')}: <code className="font-mono">{detail.school.code}</code>
          </span>
          <span>
            {t('school.yourRole')}: {roleLabel}
          </span>
          {detail.school.board && <span>{detail.school.board}</span>}
        </div>
      </Section>

      <Section title={t('school.classes')}>
        {detail.classes.length === 0 && (
          <p className="mb-3 text-sm text-muted-foreground">{t('school.noClasses')}</p>
        )}
        <ul className="mb-4 grid gap-2 md:grid-cols-2">
          {detail.classes.map((klass) => (
            <li key={klass.id}>
              <button
                type="button"
                onClick={() => onOpenClass(klass.id)}
                className="w-full rounded-xl border border-border/60 bg-background/60 p-3 text-left hover:border-primary/40 hover:bg-background"
              >
                <div className="font-medium">{klass.name}</div>
                {staff && (
                  <div className="text-xs text-muted-foreground">
                    {klass.studentCount ?? 0} {t('school.students')} · {klass.courseCount ?? 0}{' '}
                    {t('school.courses')}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
        {staff && (
          <form onSubmit={createClass} className="flex flex-col gap-2 md:flex-row">
            <Input
              placeholder={t('school.className')}
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              required
            />
            <Input
              placeholder={t('school.grade')}
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="md:w-24"
            />
            <Input
              placeholder={t('school.section')}
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="md:w-24"
            />
            <Button type="submit" disabled={busy || !className.trim()}>
              <Plus className="h-4 w-4" /> {t('school.newClass')}
            </Button>
          </form>
        )}
      </Section>

      {detail.role === 'admin' && (
        <>
          <Section title={t('school.invites')}>
            <form onSubmit={createInvite} className="mb-3 flex flex-col gap-2 md:flex-row">
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
              >
                {(['teacher', 'student', 'admin', 'parent'] as Role[]).map((role) => (
                  <option key={role} value={role}>
                    {t(`school.role.${role}`)}
                  </option>
                ))}
              </select>
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={inviteClass}
                onChange={(e) => setInviteClass(e.target.value)}
              >
                <option value="">{t('school.anyClass')}</option>
                {detail.classes.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline" disabled={busy}>
                <Plus className="h-4 w-4" /> {t('school.createInvite')}
              </Button>
            </form>
            <ul className="space-y-1 text-sm">
              {(detail.invites ?? []).map((invite) => {
                const origin = typeof window === 'undefined' ? '' : window.location.origin;
                const link = `${origin}/login?mode=signup&invite=${invite.code}`;
                return (
                  <li key={invite.code} className="flex flex-wrap items-center gap-3">
                    <code className="font-mono font-semibold">{invite.code}</code>
                    <span className="text-muted-foreground">
                      {t(`school.role.${invite.role}`)}
                      {invite.classId &&
                        ` · ${detail.classes.find((klass) => klass.id === invite.classId)?.name ?? ''}`}
                      {` · ${invite.uses}${invite.maxUses ? `/${invite.maxUses}` : ''} ${t('school.uses')}`}
                    </span>
                    <CopyButton text={link} />
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title={t('school.members')}>
            <ul className="divide-y divide-border/50 text-sm">
              {(detail.members ?? []).map((member) => (
                <li key={member.userId} className="flex items-center justify-between py-1.5">
                  <span>
                    {member.name} <span className="text-muted-foreground">· {member.email}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`school.role.${member.role}`)}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </>
  );
}

function ClassView({ schoolId, classId }: { schoolId: string; classId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [library, setLibrary] = useState<LibraryStage[]>([]);
  const [error, setError] = useState('');
  const [roster, setRoster] = useState('');
  const [created, setCreated] = useState<CreatedStudent[]>([]);
  const [stageId, setStageId] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/school/${schoolId}/classes/${classId}`;

  const load = useCallback(async () => {
    try {
      setDetail(await getJson<ClassDetail>(base));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);

  useEffect(() => {
    void load();
    getJson<{ stages: LibraryStage[] }>('/api/stages')
      .then((data) => setLibrary(data.stages))
      .catch(() => setLibrary([]));
  }, [load]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!detail) return <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />;

  const students = detail.members.filter((member) => member.role === 'student');
  const teachers = detail.members.filter((member) => member.role === 'teacher');
  const assignedIds = new Set(detail.courses.map((course) => course.stageId));
  const assignable = library.filter((stage) => !assignedIds.has(stage.id));

  async function addStudents(event: React.FormEvent) {
    event.preventDefault();
    const list = roster
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, email] = line.split(',').map((part) => part.trim());
        return { name: name ?? '', ...(email ? { email } : {}) };
      })
      .filter((student) => student.name);
    if (list.length === 0) return;
    setBusy(true);
    try {
      const data = await postJson<{ created: CreatedStudent[] }>(`${base}/students`, {
        students: list,
      });
      setCreated((previous) => [...previous, ...data.created]);
      setRoster('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function assign(event: React.FormEvent) {
    event.preventDefault();
    if (!stageId) return;
    setBusy(true);
    try {
      await postJson(`${base}/courses`, { stageId });
      setStageId('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unassign(id: string) {
    setBusy(true);
    try {
      await postJson(`${base}/courses`, { stageId: id }, 'DELETE');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const credentialsText = created.map((s) => `${s.name}\t${s.email}\t${s.password}`).join('\n');

  return (
    <>
      <Section title={detail.class.name}>
        <p className="text-sm text-muted-foreground">
          {students.length} {t('school.students')} · {teachers.length} {t('school.teachers')} ·{' '}
          {detail.courses.length} {t('school.courses')}
        </p>
      </Section>

      <Section title={t('school.courses')}>
        {detail.courses.length === 0 && (
          <p className="mb-3 text-sm text-muted-foreground">{t('school.noCourses')}</p>
        )}
        <ul className="mb-3 space-y-1 text-sm">
          {detail.courses.map((course) => (
            <li key={course.stageId} className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => router.push(`/classroom/${course.stageId}`)}
              >
                {course.name}
              </button>
              {detail.canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => unassign(course.stageId)}
                >
                  {t('school.unassign')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {detail.canManage && (
          <form onSubmit={assign} className="flex flex-col gap-2 md:flex-row">
            <select
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
            >
              <option value="">{t('school.pickCourse')}</option>
              {assignable.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={busy || !stageId}>
              {t('school.assign')}
            </Button>
          </form>
        )}
      </Section>

      <Section title={t('school.students')}>
        <ul className="mb-4 divide-y divide-border/50 text-sm">
          {students.map((student) => (
            <li key={student.userId} className="flex items-center justify-between py-1.5">
              <span>{student.name}</span>
              {student.email && (
                <span className="text-xs text-muted-foreground">{student.email}</span>
              )}
            </li>
          ))}
        </ul>
        {detail.canManage && (
          <form onSubmit={addStudents} className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('school.addStudentsHint')}</p>
            <Textarea
              rows={4}
              placeholder={t('school.bulkPlaceholder')}
              value={roster}
              onChange={(e) => setRoster(e.target.value)}
            />
            <Button type="submit" disabled={busy || !roster.trim()}>
              <Plus className="h-4 w-4" /> {t('school.addStudents')}
            </Button>
          </form>
        )}
        {created.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/30">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">{t('school.newLogins')}</span>
              <CopyButton text={credentialsText} />
            </div>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1">{t('school.name')}</th>
                  <th className="py-1">{t('school.loginId')}</th>
                  <th className="py-1">{t('school.password')}</th>
                </tr>
              </thead>
              <tbody>
                {created.map((student) => (
                  <tr key={student.email}>
                    <td className="py-1">{student.name}</td>
                    <td className="py-1 font-mono">{student.email}</td>
                    <td className="py-1 font-mono">{student.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">{t('school.newLoginsHint')}</p>
          </div>
        )}
      </Section>

      {teachers.length > 0 && (
        <Section title={t('school.teachers')}>
          <ul className="text-sm">
            {teachers.map((teacher) => (
              <li key={teacher.userId}>{teacher.name}</li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
