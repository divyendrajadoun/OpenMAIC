'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BookOpen, GraduationCap, LoaderCircle, Play } from 'lucide-react';

import { Section, Shell } from '@/components/school/shell';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSchoolContext } from '@/lib/hooks/use-school-context';

interface LibraryStage {
  id: string;
  name: string;
  description?: string | null;
  sceneCount?: number;
}

export function StudentHome() {
  const { t } = useI18n();
  const router = useRouter();
  const { loading, enabled, user, school } = useSchoolContext();
  const [stages, setStages] = useState<LibraryStage[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch('/api/stages', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { stages: [] }))
      .then((data: { stages?: LibraryStage[] }) => {
        if (!cancelled) setStages(data.stages ?? []);
      })
      .catch(() => {
        if (!cancelled) setStages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!enabled) return <Shell title={t('school.learn.title')}>{t('school.needsServer')}</Shell>;
  if (!user) {
    router.replace('/login?next=/learn');
    return null;
  }

  return (
    <Shell
      title={t('school.learn.title')}
      icon={<GraduationCap className="h-5 w-5 text-primary" />}
    >
      <div>
        <p className="text-base font-medium">{t('school.learn.hello', { name: user.name })}</p>
        <p className="text-sm text-muted-foreground">
          {school ? school.schoolName : t('school.learn.noSchool')}
        </p>
      </div>

      <Section title={t('school.learn.myCourses')}>
        {stages === null ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('school.learn.noCourses')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {stages.map((stage) => (
              <li
                key={stage.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-border/40 p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-primary/10 p-2 text-primary">
                    <BookOpen className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{stage.name}</p>
                    {stage.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {stage.description}
                      </p>
                    )}
                    {typeof stage.sceneCount === 'number' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('school.learn.scenes', { count: stage.sceneCount })}
                      </p>
                    )}
                  </div>
                </div>
                <Button size="sm" onClick={() => router.push(`/classroom/${stage.id}`)}>
                  <Play className="mr-1 h-4 w-4" />
                  {t('school.learn.open')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Shell>
  );
}
