'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BookOpenCheck, FileText, Library, LoaderCircle, Presentation, Users } from 'lucide-react';

import { Section, SelectField, Shell } from '@/components/school/shell';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSchoolContext } from '@/lib/hooks/use-school-context';
import { schoolFetch } from '@/lib/school/api-headers';
import type { SavedPaperSummary } from '@/lib/school/question-types';

function Tile({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-2xl border border-border/50 bg-card/80 p-5 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md"
    >
      <span className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</span>
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

export function TeacherHome() {
  const { t } = useI18n();
  const router = useRouter();
  const { loading, enabled, user, school, schools, setSchoolId } = useSchoolContext({
    staff: true,
  });
  const [papers, setPapers] = useState<SavedPaperSummary[] | null>(null);

  useEffect(() => {
    if (!school) return;
    let cancelled = false;
    schoolFetch<{ papers: SavedPaperSummary[] }>(`/api/school/${school.schoolId}/papers`)
      .then((data) => {
        if (!cancelled) setPapers(data.papers);
      })
      .catch(() => {
        if (!cancelled) setPapers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [school]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!enabled) return <Shell title={t('school.teach.title')}>{t('school.needsServer')}</Shell>;
  if (!user) {
    router.replace('/login?next=/teach');
    return null;
  }
  if (!school) {
    return (
      <Shell title={t('school.teach.title')}>
        <Section title={t('school.teach.title')}>
          <p className="text-sm text-muted-foreground">{t('school.teach.notStaff')}</p>
          <Button className="mt-3" variant="outline" onClick={() => router.push('/school')}>
            {t('school.mySchool')}
          </Button>
        </Section>
      </Shell>
    );
  }

  return (
    <Shell title={t('school.teach.title')} icon={<Presentation className="h-5 w-5 text-primary" />}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-medium">{t('school.teach.hello', { name: user.name })}</p>
          <p className="text-sm text-muted-foreground">{school.schoolName}</p>
        </div>
        {schools.length > 1 && (
          <SelectField
            ariaLabel={t('school.teach.pickSchool')}
            value={school.schoolId}
            onChange={setSchoolId}
            options={schools.map((m) => ({ value: m.schoolId, label: m.schoolName }))}
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Tile
          icon={<Presentation className="h-5 w-5" />}
          title={t('school.teach.newLesson')}
          hint={t('school.teach.newLessonHint')}
          onClick={() => router.push('/')}
        />
        <Tile
          icon={<FileText className="h-5 w-5" />}
          title={t('school.teach.paper')}
          hint={t('school.teach.paperHint')}
          onClick={() => router.push('/teach/paper')}
        />
        <Tile
          icon={<Library className="h-5 w-5" />}
          title={t('school.teach.bank')}
          hint={t('school.teach.bankHint')}
          onClick={() => router.push('/teach/bank')}
        />
        <Tile
          icon={<Users className="h-5 w-5" />}
          title={t('school.teach.classes')}
          hint={t('school.teach.classesHint')}
          onClick={() => router.push('/school')}
        />
      </div>

      <Section title={t('school.teach.recentPapers')}>
        {papers === null ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : papers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('school.teach.noPapers')}</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {papers.slice(0, 8).map((paper) => (
              <li key={paper.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{paper.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[paper.classLabel, paper.subject].filter(Boolean).join(' · ')} ·{' '}
                    {paper.totalMarks} {t('school.teach.marks')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(`/teach/paper?paper=${paper.id}`)}
                >
                  <BookOpenCheck className="mr-1 h-4 w-4" />
                  {t('school.teach.open')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Shell>
  );
}
