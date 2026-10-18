'use client';

/**
 * The teacher's avatar in a picture-in-picture window over the classroom.
 *
 * When the open lesson has avatar clips, this loads them into the narration
 * registry and shows the avatar in the corner: the still look between lines,
 * the clip of the line being spoken while it plays. The clip's audio is what
 * the lesson's narration element plays; this video is its silent mirror, kept
 * in step with that element. Draggable, resizable, hideable.
 */
import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';

import {
  clearAvatarClips,
  setAvatarClips,
  subscribeAvatarClip,
  type ActiveAvatarClip,
} from '@/lib/avatar/narration-clips';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { LessonClipsView } from '@/lib/school/avatar-types';
import { useStageStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/store/settings';
import { cn } from '@/lib/utils';
import type { AudioPlayer } from '@/lib/utils/audio-player';

/** While clips are still rendering at HeyGen, re-read them this often, this many times. */
const POLL_MS = 20_000;
const POLL_LIMIT = 30;
/** Seek the mirror when it drifts from the narration by more than this. */
const MAX_DRIFT_S = 0.35;

export function AvatarPip({ audioPlayer }: { audioPlayer: AudioPlayer }) {
  const stageId = useStageStore((s) => s.stage?.id ?? null);
  const playbackSpeed = useSettingsStore((s) => s.playbackSpeed);
  const { t } = useI18n();
  const [avatar, setAvatar] = useState<LessonClipsView['avatar']>(null);
  const [clip, setClip] = useState<ActiveAvatarClip | null>(null);
  const [hidden, setHidden] = useState(false);
  const [large, setLarge] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const videoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!stageId) return;
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await fetch(`/api/lessons/${encodeURIComponent(stageId)}/avatar-clips`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(String(res.status));
        const view = (await res.json()) as LessonClipsView;
        if (cancelled) return;
        setAvatarClips(
          view.clips.flatMap((c) =>
            c.status === 'completed' && c.videoUrl
              ? [{ actionId: c.actionId, textHash: c.textHash, url: c.videoUrl }]
              : [],
          ),
        );
        setAvatar(view.counts.completed + view.counts.processing > 0 ? view.avatar : null);
        if (view.counts.processing > 0 && polls++ < POLL_LIMIT) timer = setTimeout(load, POLL_MS);
      } catch {
        if (!cancelled) {
          clearAvatarClips();
          setAvatar(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      clearAvatarClips();
    };
  }, [stageId]);

  useEffect(() => subscribeAvatarClip(setClip), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip) return;
    video.src = clip.url;
    video.muted = true;
    video.playbackRate = playbackSpeed || 1;
    let frame = 0;
    const tick = () => {
      const playing = audioPlayer.isPlaying();
      const time = audioPlayer.getCurrentTime() / 1000;
      if (playing && video.paused) video.play().catch(() => {});
      if (!playing && !video.paused) video.pause();
      if (video.readyState >= 1 && Math.abs(video.currentTime - time) > MAX_DRIFT_S) {
        video.currentTime = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      video.pause();
    };
  }, [clip, audioPlayer, playbackSpeed]);

  if (!avatar) return null;

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        title={t('school.avatar.pipShow')}
        className="absolute right-4 bottom-4 z-30 rounded-full shadow-lg ring-2 ring-white/80 transition hover:scale-105"
      >
        {avatar.previewImageUrl ? (
          <img
            src={avatar.previewImageUrl}
            alt=""
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {avatar.name.slice(0, 1)}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={t('school.avatar.pipTitle')}
      className={cn(
        'absolute right-4 bottom-4 z-30 touch-none overflow-hidden rounded-2xl bg-slate-900 shadow-2xl ring-1 ring-white/20 transition-[width,height] duration-300 select-none',
        large ? 'h-72 w-72' : 'h-40 w-40',
        clip && 'ring-2 ring-primary/70',
      )}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setOffset({
          x: drag.current.ox + e.clientX - drag.current.x,
          y: drag.current.oy + e.clientY - drag.current.y,
        });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      {avatar.previewImageUrl && (
        <img
          src={avatar.previewImageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <video
        ref={videoRef}
        playsInline
        muted
        className={cn(
          'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
          clip ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2 text-white">
        <span className="truncate text-xs font-medium drop-shadow">{avatar.name}</span>
        <span className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setLarge((v) => !v)}
            title={large ? t('school.avatar.pipSmaller') : t('school.avatar.pipLarger')}
            className="rounded-full p-1 hover:bg-white/20"
          >
            {large ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setHidden(true)}
            title={t('school.avatar.pipHide')}
            className="rounded-full p-1 hover:bg-white/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}
