'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';

import { Section, Shell } from '@/components/school/shell';
import { AvatarCard } from '@/components/teach/avatar-card';
import { AvatarGallery } from '@/components/teach/avatar-gallery';
import { LessonNarrator } from '@/components/teach/lesson-narrator';
import { TwinRecorder } from '@/components/teach/twin-recorder';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSchoolContext } from '@/lib/hooks/use-school-context';
import { schoolFetch } from '@/lib/school/api-headers';
import type { SchoolAvatar } from '@/lib/school/avatar-types';

/** While an avatar is training or awaiting consent, re-read the list this often. */
const REFRESH_MS = 15_000;

export function AvatarStudio() {
  const { t } = useI18n();
  const router = useRouter();
  const consentDone = useSearchParams().get('consent') === 'done';
  const { loading, enabled, user, school } = useSchoolContext({ staff: true });
  const schoolId = school?.schoolId;
  const [avatars, setAvatars] = useState<SchoolAvatar[] | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!schoolId) return;
    try {
      const data = await schoolFetch<{ avatars: SchoolAvatar[] }>(
        `/api/school/${schoolId}/avatars`,
      );
      setAvatars(data.avatars);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setAvatars((current) => current ?? []);
    }
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    schoolFetch<{ avatars: SchoolAvatar[] }>(`/api/school/${schoolId}/avatars`)
      .then((data) => {
        if (!cancelled) setAvatars(data.avatars);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setAvatars([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const pending = avatars?.some((a) => a.status === 'training' || a.status === 'consent') ?? false;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  const upsert = useCallback((avatar: SchoolAvatar) => {
    setAvatars((current) => [
      avatar,
      ...(current ?? []).filter((existing) => existing.id !== avatar.id),
    ]);
  }, []);

  const remove = useCallback((id: string) => {
    setAvatars((current) => (current ?? []).filter((avatar) => avatar.id !== id));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!enabled) return <Shell title={t('school.avatar.title')}>{t('school.needsServer')}</Shell>;
  if (!user) {
    router.replace('/login?next=/teach/avatar');
    return null;
  }
  if (!school || !schoolId) {
    return (
      <Shell title={t('school.avatar.title')} back={() => router.push('/teach')}>
        <Section title={t('school.avatar.title')}>
          <p className="text-sm text-muted-foreground">{t('school.teach.notStaff')}</p>
          <Button className="mt-3" variant="outline" onClick={() => router.push('/school')}>
            {t('school.mySchool')}
          </Button>
        </Section>
      </Shell>
    );
  }

  const ready = (avatars ?? []).filter((avatar) => avatar.status === 'ready');

  return (
    <Shell
      title={t('school.avatar.title')}
      back={() => router.push('/teach')}
      icon={<Sparkles className="h-5 w-5 text-primary" />}
    >
      <p className="text-sm text-muted-foreground">{t('school.avatar.intro')}</p>
      {consentDone && (
        <p className="rounded-lg border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          {t('school.avatar.consentThanks')}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Section title={t('school.avatar.yours')}>
        {avatars === null ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : avatars.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('school.avatar.none')}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {avatars.map((avatar) => (
              <AvatarCard
                key={avatar.id}
                schoolId={schoolId}
                avatar={avatar}
                onChange={upsert}
                onRemoved={remove}
              />
            ))}
          </div>
        )}
      </Section>

      <TwinRecorder schoolId={schoolId} defaultName={user.name} onCreated={upsert} />
      <AvatarGallery schoolId={schoolId} onAdded={upsert} />
      <LessonNarrator schoolId={schoolId} avatars={ready} />
    </Shell>
  );
}
