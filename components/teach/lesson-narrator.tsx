'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Clapperboard, LoaderCircle, Play, Trash2 } from 'lucide-react';

import { Section, SelectField } from '@/components/school/shell';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useI18n } from '@/lib/hooks/use-i18n';
import { schoolFetch } from '@/lib/school/api-headers';
import type { LessonClipsView, NarrationPlan, SchoolAvatar } from '@/lib/school/avatar-types';

interface LibraryStage {
  id: string;
  name: string;
  sceneCount?: number;
}

/** While clips render, re-read their state this often, this many times at most. */
const POLL_MS = 8_000;
const POLL_LIMIT = 90;

/** Pick a lesson and a ready avatar; render a clip per line; watch them finish. */
export function LessonNarrator({
  schoolId,
  avatars,
}: {
  schoolId: string;
  avatars: SchoolAvatar[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [stages, setStages] = useState<LibraryStage[] | null>(null);
  const [stageId, setStageId] = useState('');
  const [avatarId, setAvatarId] = useState('');
  const [plan, setPlan] = useState<NarrationPlan | null>(null);
  const [clips, setClips] = useState<LessonClipsView | null>(null);
  const [busy, setBusy] = useState<'narrate' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
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
  }, []);

  const effectiveAvatarId = avatarId || avatars[0]?.id || '';

  const loadClips = useCallback(async () => {
    if (!stageId) return null;
    const view = await schoolFetch<LessonClipsView>(`/api/lessons/${stageId}/avatar-clips`);
    setClips(view);
    return view;
  }, [stageId]);

  useEffect(() => {
    if (!stageId) {
      setPlan(null);
      setClips(null);
      return;
    }
    let cancelled = false;
    setError('');
    setNotice('');
    Promise.all([
      schoolFetch<{ plan: NarrationPlan }>(
        `/api/school/${schoolId}/lessons/${stageId}/narrate?avatarId=${encodeURIComponent(effectiveAvatarId)}`,
      ),
      loadClips(),
    ])
      .then(([data]) => {
        if (!cancelled) setPlan(data.plan);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, stageId, effectiveAvatarId, loadClips]);

  const rendering = (clips?.counts.processing ?? 0) > 0;
  useEffect(() => {
    if (!rendering) return;
    let polls = 0;
    const timer = setInterval(() => {
      if (polls++ >= POLL_LIMIT) return clearInterval(timer);
      void loadClips().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [rendering, loadClips]);

  const narrate = async () => {
    if (!stageId || !effectiveAvatarId) return;
    setBusy('narrate');
    setError('');
    try {
      const result = await schoolFetch<{ created: number; reused: number; failed: number }>(
        `/api/school/${schoolId}/lessons/${stageId}/narrate`,
        { body: { avatarId: effectiveAvatarId } },
      );
      setNotice(t('school.avatar.started', { created: result.created, reused: result.reused }));
      await loadClips();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!stageId) return;
    setBusy('remove');
    setError('');
    try {
      await schoolFetch(`/api/school/${schoolId}/lessons/${stageId}/narrate`, { method: 'DELETE' });
      setNotice(t('school.avatar.removed'));
      await loadClips();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const total = clips?.clips.length ?? 0;
  const done = clips?.counts.completed ?? 0;

  return (
    <Section title={t('school.avatar.narrateTitle')}>
      <p className="text-sm text-muted-foreground">{t('school.avatar.narrateHint')}</p>

      {stages !== null && stages.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('school.avatar.noLessons')}</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">
              {t('school.avatar.lesson')}
            </span>
            <SelectField
              className="w-full"
              value={stageId}
              onChange={setStageId}
              options={[
                { value: '', label: stages === null ? '…' : t('school.avatar.pickLesson') },
                ...(stages ?? []).map((stage) => ({ value: stage.id, label: stage.name })),
              ]}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">
              {t('school.avatar.avatarLabel')}
            </span>
            {avatars.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{t('school.avatar.noReady')}</p>
            ) : (
              <SelectField
                className="w-full"
                value={effectiveAvatarId}
                onChange={setAvatarId}
                options={avatars.map((avatar) => ({ value: avatar.id, label: avatar.name }))}
              />
            )}
          </label>
        </div>
      )}

      {stageId && (
        <div className="mt-4 space-y-3">
          {plan && (
            <p className="text-sm">
              {t('school.avatar.estimate', { lines: plan.lines, minutes: plan.minutes })}
              {plan.reusable > 0 && (
                <span className="text-muted-foreground">
                  {' · '}
                  {t('school.avatar.estimateReuse', { count: plan.reusable })}
                </span>
              )}
            </p>
          )}

          {clips && total > 0 && (
            <div className="rounded-xl border border-border/50 p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  {rendering && (
                    <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {clips.avatar?.name}
                  {' · '}
                  {done === total && !rendering
                    ? t('school.avatar.allReady')
                    : t('school.avatar.progress', { done, total })}
                </span>
                {clips.counts.failed > 0 && (
                  <span className="text-xs text-destructive">
                    {t('school.avatar.failedClips', { count: clips.counts.failed })}
                  </span>
                )}
              </div>
              <Progress value={total ? Math.round((done / total) * 100) : 0} />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={narrate}
              disabled={!effectiveAvatarId || busy !== null || !plan || plan.lines === 0}
            >
              {busy === 'narrate' ? (
                <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Clapperboard className="mr-1 h-4 w-4" />
              )}
              {t('school.avatar.narrate')}
            </Button>
            {done > 0 && (
              <Button variant="outline" onClick={() => router.push(`/classroom/${stageId}`)}>
                <Play className="mr-1 h-4 w-4" />
                {t('school.avatar.openLesson')}
              </Button>
            )}
            {total > 0 && (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={remove}
                disabled={busy !== null}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {t('school.avatar.removeNarration')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
