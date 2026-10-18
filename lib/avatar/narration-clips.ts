/**
 * The avatar clips of the lesson currently open, for the playback engine.
 *
 * The classroom loads a lesson's clips (one per speech line) into this
 * registry; the engine asks for the clip of each line it is about to speak and
 * announces which clip is playing so the picture-in-picture window can show
 * it. A clip is only offered when its text hash still matches the line, so an
 * edited line is narrated the ordinary way rather than by a stale clip.
 */
import { narrationTextHash } from './text-hash';

export interface AvatarClipRef {
  actionId: string;
  textHash: string;
  url: string;
}

export interface ActiveAvatarClip {
  actionId: string;
  url: string;
}

type Listener = (clip: ActiveAvatarClip | null) => void;

const clips = new Map<string, { textHash: string; url: string }>();
const listeners = new Set<Listener>();
let active: ActiveAvatarClip | null = null;

export function setAvatarClips(entries: readonly AvatarClipRef[]): void {
  clips.clear();
  for (const entry of entries)
    clips.set(entry.actionId, { textHash: entry.textHash, url: entry.url });
}

export function clearAvatarClips(): void {
  clips.clear();
  publishAvatarClip(null);
}

/** The clip URL for a speech line, when one exists for exactly this text. */
export function avatarClipUrlFor(action: { id: string; text: string }): string | undefined {
  const clip = clips.get(action.id);
  if (!clip) return undefined;
  return clip.textHash === narrationTextHash(action.text) ? clip.url : undefined;
}

export function publishAvatarClip(clip: ActiveAvatarClip | null): void {
  active = clip;
  for (const listener of listeners) listener(clip);
}

/** Subscribe to the clip being spoken; the listener is called with the current one at once. */
export function subscribeAvatarClip(listener: Listener): () => void {
  listeners.add(listener);
  listener(active);
  return () => {
    listeners.delete(listener);
  };
}
