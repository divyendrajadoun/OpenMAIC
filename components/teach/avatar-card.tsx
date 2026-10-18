'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, Trash2, Volume2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { schoolFetch } from '@/lib/school/api-headers';
import type { SchoolAvatar } from '@/lib/school/avatar-types';
import { cn } from '@/lib/utils';

const SAMPLE_POLL_MS = 6_000;
const SAMPLE_POLL_LIMIT = 40;

const STATUS_STYLE: Record<SchoolAvatar['status'], string> = {
  training: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  consent: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

/** One avatar of the school: its look, state, consent step and a greeting to hear it. */
export function AvatarCard({
  schoolId,
  avatar,
  onChange,
  onRemoved,
}: {
  schoolId: string;
  avatar: SchoolAvatar;
  onChange: (avatar: SchoolAvatar) => void;
  onRemoved: (id: string) => void;
}) {
  const { t } = useI18n();
  const base = `/api/school/${schoolId}/avatars/${avatar.id}`;
  const [busy, setBusy] = useState<'consent' | 'sample' | 'remove' | null>(null);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  // A greeting that was requested but has not finished rendering yet.
  const sampleRendering = !!avatar.sampleVideoId && !avatar.sampleVideoUrl;
  useEffect(() => {
    if (!sampleRendering) return;
    let polls = 0;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (polls++ >= SAMPLE_POLL_LIMIT) return clearInterval(timer);
      try {
        const data = await schoolFetch<{ avatar: SchoolAvatar; status: string; error?: string }>(
          `${base}/sample`,
        );
        if (cancelled) return;
        if (data.status === 'completed') onChange(data.avatar);
        if (data.status === 'failed') {
          setError(data.error || t('school.avatar.sampleFailed'));
          onChange({ ...avatar, sampleVideoId: null });
        }
      } catch {
        /* the next tick retries */
      }
    }, SAMPLE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll only while a greeting renders
  }, [sampleRendering, base]);

  const recordConsent = async () => {
    setBusy('consent');
    setError('');
    try {
      const { url } = await schoolFetch<{ url: string }>(`${base}/consent`, { body: {} });
      window.open(url, '_blank', 'noopener');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const sayHello = async (language: 'Hindi' | 'English') => {
    setBusy('sample');
    setError('');
    try {
      const data = await schoolFetch<{ avatar: SchoolAvatar }>(`${base}/sample`, {
        body: { language },
      });
      onChange(data.avatar);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    try {
      await schoolFetch(base, { method: 'DELETE' });
      onRemoved(avatar.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(null);
    }
  };

  const needsConsent =
    avatar.kind === 'twin' && !!avatar.groupId && avatar.consentStatus !== 'accepted';

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
      <div className="relative aspect-square bg-slate-900">
        {avatar.sampleVideoUrl ? (
          <video
            ref={videoRef}
            src={avatar.sampleVideoUrl}
            poster={avatar.previewImageUrl ?? undefined}
            controls
            playsInline
            className="h-full w-full object-cover"
          />
        ) : avatar.previewImageUrl ? (
          <img src={avatar.previewImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl font-semibold text-white/70">
            {avatar.name.slice(0, 1)}
          </div>
        )}
        <span
          className={cn(
            'absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-medium shadow-sm',
            STATUS_STYLE[avatar.status],
          )}
        >
          {t(`school.avatar.status.${avatar.status}`)}
        </span>
        {sampleRendering && (
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-3 py-2 text-xs text-white">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            {t('school.avatar.sampleRendering')}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div>
          <p className="truncate text-sm font-semibold">{avatar.name}</p>
          <p className="text-xs text-muted-foreground">
            {t(avatar.kind === 'twin' ? 'school.avatar.kindTwin' : 'school.avatar.kindStock')}
            {avatar.ownerName && ` · ${t('school.avatar.by', { name: avatar.ownerName })}`}
          </p>
        </div>
        {avatar.error && <p className="text-xs text-destructive">{avatar.error}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}

        {needsConsent && (
          <div className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
            <p>{t('school.avatar.consentHelp')}</p>
            <Button size="sm" className="mt-2" onClick={recordConsent} disabled={busy !== null}>
              {busy === 'consent' ? (
                <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-1 h-4 w-4" />
              )}
              {t('school.avatar.recordConsent')}
            </Button>
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {avatar.status === 'ready' && !sampleRendering && (
            <>
              <span className="text-xs text-muted-foreground">{t('school.avatar.hear')}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => sayHello('Hindi')}
                disabled={busy !== null}
              >
                <Volume2 className="mr-1 h-4 w-4" />
                हिन्दी
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => sayHello('English')}
                disabled={busy !== null}
              >
                <Volume2 className="mr-1 h-4 w-4" />
                English
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={remove}
            disabled={busy !== null}
            title={t('school.avatar.remove')}
          >
            {busy === 'remove' ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
