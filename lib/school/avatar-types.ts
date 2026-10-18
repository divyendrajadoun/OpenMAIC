/**
 * Avatar and narration types shared by the Teacher Studio pages, the
 * classroom player and the school API routes. No Node imports.
 */

export const AVATAR_STATUSES = ['training', 'consent', 'ready', 'failed'] as const;
export type AvatarStatus = (typeof AVATAR_STATUSES)[number];

/** `twin`: trained from the teacher's own footage. `stock`: a HeyGen library look. */
export type AvatarKind = 'twin' | 'stock';

export interface SchoolAvatar {
  id: string;
  schoolId: string;
  ownerUserId: string;
  ownerName: string | null;
  name: string;
  kind: AvatarKind;
  /** HeyGen look id: the `avatar_id` a video is rendered with. */
  lookId: string;
  /** HeyGen avatar group (the character); consent is tracked per group. */
  groupId: string | null;
  voiceId: string | null;
  previewImageUrl: string | null;
  previewVideoUrl: string | null;
  status: AvatarStatus;
  consentStatus: string | null;
  error: string | null;
  /** The "say namaste" sample rendered from this avatar, once requested. */
  sampleVideoId: string | null;
  sampleVideoUrl: string | null;
  createdAt: number;
}

export interface GalleryLook {
  id: string;
  name: string;
  groupId: string | null;
  gender: string | null;
  previewImageUrl: string | null;
  previewVideoUrl: string | null;
  defaultVoiceId: string | null;
  avatarType: string;
}

export interface GalleryVoice {
  id: string;
  name: string;
  language: string;
  gender: string | null;
  previewUrl: string | null;
}

export interface Gallery {
  /** One look per HeyGen library character. */
  looks: GalleryLook[];
  /** Looks already in the connected HeyGen account (twins made outside the app). */
  mine: GalleryLook[];
  voices: GalleryVoice[];
}

export const VOICE_LANGUAGES = ['Hindi', 'English'] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

export type ClipStatus = 'processing' | 'completed' | 'failed';

export interface LessonClip {
  actionId: string;
  textHash: string;
  status: ClipStatus;
  videoUrl: string | null;
  duration: number | null;
  error: string | null;
}

export interface LessonClipsView {
  clips: LessonClip[];
  avatar: { id: string; name: string; previewImageUrl: string | null } | null;
  counts: { completed: number; processing: number; failed: number };
}

/** What narrating a lesson with a given avatar would render. */
export interface NarrationPlan {
  lines: number;
  words: number;
  /** Rough minutes of video at a teacher's speaking pace. */
  minutes: number;
  /** Lines that already have a finished clip from this avatar with the same text. */
  reusable: number;
}

/** Footage uploads travel in chunks of this size so each request stays under the host's body limit. */
export const UPLOAD_CHUNK_BYTES = 4_000_000;
export const UPLOAD_MAX_BYTES = 150_000_000;
