'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Play, Plus, Square } from 'lucide-react';

import { Section } from '@/components/school/shell';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { schoolFetch } from '@/lib/school/api-headers';
import {
  VOICE_LANGUAGES,
  type Gallery,
  type GalleryLook,
  type GalleryVoice,
  type SchoolAvatar,
} from '@/lib/school/avatar-types';
import { cn } from '@/lib/utils';

function LookTile({
  look,
  selected,
  onSelect,
}: {
  look: GalleryLook;
  selected: boolean;
  onSelect: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => void videoRef.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const video = videoRef.current;
        if (video) {
          video.pause();
          video.currentTime = 0;
        }
      }}
      className={cn(
        'group relative aspect-[4/5] overflow-hidden rounded-xl bg-slate-900 text-left ring-2 transition',
        selected ? 'ring-primary shadow-lg' : 'ring-transparent hover:ring-primary/40',
      )}
      aria-pressed={selected}
    >
      {look.previewImageUrl && (
        <img src={look.previewImageUrl} alt="" className="h-full w-full object-cover" />
      )}
      {look.previewVideoUrl && (
        <video
          ref={videoRef}
          src={look.previewVideoUrl}
          muted
          loop
          playsInline
          preload="none"
          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-xs font-medium text-white">
        {look.name}
      </span>
      {selected && (
        <span className="absolute top-2 right-2 rounded-full bg-primary p-1 text-primary-foreground shadow">
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

/** Ready-made HeyGen looks and voices; one pick becomes an avatar of the school. */
export function AvatarGallery({
  schoolId,
  onAdded,
}: {
  schoolId: string;
  onAdded: (avatar: SchoolAvatar) => void;
}) {
  const { t } = useI18n();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [error, setError] = useState('');
  const [look, setLook] = useState<GalleryLook | null>(null);
  const [voice, setVoice] = useState<GalleryVoice | null>(null);
  const [language, setLanguage] = useState<(typeof VOICE_LANGUAGES)[number]>('Hindi');
  const [playing, setPlaying] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    schoolFetch<Gallery>(`/api/school/${schoolId}/avatars/gallery`)
      .then((data) => {
        if (!cancelled) setGallery(data);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [schoolId]);

  const toggleVoice = (candidate: GalleryVoice) => {
    const audio = (audioRef.current ??= new Audio());
    if (playing === candidate.id) {
      audio.pause();
      setPlaying(null);
      return;
    }
    if (!candidate.previewUrl) return;
    audio.src = candidate.previewUrl;
    audio.onended = () => setPlaying(null);
    void audio.play().catch(() => setPlaying(null));
    setPlaying(candidate.id);
  };

  const add = async () => {
    if (!look) return;
    setAdding(true);
    setError('');
    try {
      const data = await schoolFetch<{ avatar: SchoolAvatar }>(`/api/school/${schoolId}/avatars`, {
        body: {
          lookId: look.id || undefined,
          groupId: look.groupId,
          voiceId: voice?.id ?? null,
          name: look.name,
        },
      });
      onAdded(data.avatar);
      setAdded(true);
      setTimeout(() => setAdded(false), 2500);
      setLook(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAdding(false);
    }
  };

  const voices = gallery?.voices.filter((v) => v.language === language) ?? [];

  return (
    <Section title={t('school.avatar.galleryTitle')}>
      <p className="text-sm text-muted-foreground">{t('school.avatar.galleryHint')}</p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {gallery === null && !error && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t('school.avatar.galleryLoading')}
        </p>
      )}
      {gallery && (
        <div className="mt-4 space-y-5">
          {gallery.mine.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('school.avatar.fromAccount')}
              </p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {gallery.mine.map((candidate) => (
                  <LookTile
                    key={candidate.id || candidate.groupId}
                    look={candidate}
                    selected={look === candidate}
                    onSelect={() => setLook(candidate)}
                  />
                ))}
              </div>
            </div>
          )}
          <div>
            {gallery.mine.length > 0 && (
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('school.avatar.library')}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {gallery.looks.map((candidate) => (
                <LookTile
                  key={candidate.id || candidate.groupId}
                  look={candidate}
                  selected={look === candidate}
                  onSelect={() => setLook(candidate)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t('school.avatar.voicesLabel')}
              </p>
              <span className="flex gap-1 text-xs">
                {VOICE_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    className={cn(
                      'rounded-full px-2 py-0.5',
                      language === lang ? 'bg-primary text-primary-foreground' : 'bg-muted',
                    )}
                  >
                    {lang === 'Hindi' ? 'हिन्दी' : lang}
                  </button>
                ))}
              </span>
              <span className="text-xs text-muted-foreground">{t('school.avatar.voiceHint')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {voices.map((candidate) => (
                <span
                  key={candidate.id}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-3 text-xs transition',
                    voice?.id === candidate.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 hover:border-primary/40',
                  )}
                >
                  <button type="button" onClick={() => setVoice(candidate)} className="py-1">
                    {candidate.name}
                    {candidate.gender && (
                      <span className="ml-1 text-muted-foreground">
                        · {candidate.gender === 'female' ? '♀' : '♂'}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleVoice(candidate)}
                    className="rounded-full p-1 hover:bg-muted"
                    title={t('school.avatar.voicePreview')}
                  >
                    {playing === candidate.id ? (
                      <Square className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={add} disabled={!look || adding}>
              {adding ? (
                <LoaderCircle className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              {t('school.avatar.addToSchool')}
            </Button>
            {look && (
              <span className="text-sm text-muted-foreground">
                {look.name}
                {voice ? ` · ${voice.name}` : ''}
              </span>
            )}
            {added && (
              <span className="text-sm text-emerald-700 dark:text-emerald-300">
                {t('school.avatar.added')}
              </span>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
