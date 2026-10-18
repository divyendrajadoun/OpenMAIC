import { describe, expect, it } from 'vitest';

import {
  avatarClipUrlFor,
  clearAvatarClips,
  publishAvatarClip,
  setAvatarClips,
  subscribeAvatarClip,
} from '@/lib/avatar/narration-clips';
import { narrationTextHash } from '@/lib/avatar/text-hash';
import { stateFromHeyGen } from '@/lib/server/school/avatars';
import {
  collectSpeechLines,
  estimateNarration,
  planNarration,
} from '@/lib/server/school/lesson-clips';

describe('narrationTextHash', () => {
  it('ignores surrounding and repeated whitespace but not words', () => {
    expect(narrationTextHash('  Yeast  makes bread\nrise ')).toBe(
      narrationTextHash('Yeast makes bread rise'),
    );
    expect(narrationTextHash('Yeast makes bread rise')).not.toBe(
      narrationTextHash('Yeast makes bread fall'),
    );
    expect(narrationTextHash('नमस्ते बच्चों')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('collectSpeechLines', () => {
  it('keeps spoken lines in scene order and drops empty or non-speech actions', () => {
    const lines = collectSpeechLines([
      {
        id: 's2',
        title: 'Second',
        order: 2,
        actions: [{ id: 'b', type: 'speech', text: 'Second scene line' }],
      },
      {
        id: 's1',
        title: 'First',
        order: 1,
        actions: [
          { id: 'a', type: 'speech', text: '  First scene line ' },
          { id: 'x', type: 'spotlight' },
          { id: 'blank', type: 'speech', text: '   ' },
        ],
      },
    ]);
    expect(lines.map((line) => line.actionId)).toEqual(['a', 'b']);
    expect(lines[0]).toMatchObject({ sceneTitle: 'First', text: 'First scene line' });
    expect(lines[0].hash).toBe(narrationTextHash('First scene line'));
  });
});

describe('planNarration', () => {
  const lines = collectSpeechLines([
    {
      id: 's',
      order: 1,
      actions: [
        { id: 'a', type: 'speech', text: 'Line A' },
        { id: 'b', type: 'speech', text: 'Line B' },
        { id: 'c', type: 'speech', text: 'Line C' },
      ],
    },
  ]);

  it('reuses finished clips of the same avatar and text, and re-renders the rest', () => {
    const { create, reusable } = planNarration(
      lines,
      [
        {
          action_id: 'a',
          avatar_id: 'av1',
          text_hash: narrationTextHash('Line A'),
          status: 'completed',
        },
        {
          action_id: 'b',
          avatar_id: 'av1',
          text_hash: narrationTextHash('old text'),
          status: 'completed',
        },
        {
          action_id: 'c',
          avatar_id: 'av2',
          text_hash: narrationTextHash('Line C'),
          status: 'completed',
        },
      ],
      'av1',
    );
    expect(create.map((line) => line.actionId)).toEqual(['b', 'c']);
    expect(reusable).toBe(1);
  });

  it('re-renders failed clips', () => {
    const { create } = planNarration(
      lines,
      [
        {
          action_id: 'a',
          avatar_id: 'av1',
          text_hash: narrationTextHash('Line A'),
          status: 'failed',
        },
      ],
      'av1',
    );
    expect(create).toHaveLength(3);
  });

  it('estimates minutes from the word count', () => {
    const plan = estimateNarration(lines, 1);
    expect(plan).toMatchObject({ lines: 3, words: 6, reusable: 1 });
    expect(plan.minutes).toBeCloseTo(6 / 140, 1);
  });
});

describe('stateFromHeyGen', () => {
  it('maps training, consent and ready for a twin', () => {
    expect(
      stateFromHeyGen({ status: 'processing' }, { consent_status: 'pending' }, 'twin').status,
    ).toBe('training');
    expect(
      stateFromHeyGen({ status: 'completed' }, { consent_status: 'pending' }, 'twin').status,
    ).toBe('consent');
    expect(
      stateFromHeyGen({ status: 'completed' }, { consent_status: 'accepted' }, 'twin').status,
    ).toBe('ready');
    expect(stateFromHeyGen({ status: 'completed' }, null, 'twin').status).toBe('consent');
  });

  it('needs no consent for a library look and reports failures', () => {
    expect(stateFromHeyGen({ status: 'completed' }, null, 'stock').status).toBe('ready');
    const failed = stateFromHeyGen(
      { status: 'failed', error: { message: 'footage too dark' } },
      null,
      'twin',
    );
    expect(failed).toMatchObject({ status: 'failed', error: 'footage too dark' });
  });
});

describe('narration clip registry', () => {
  it('offers a clip only while its text still matches, and announces the active clip', () => {
    setAvatarClips([
      { actionId: 'a', textHash: narrationTextHash('Hello class'), url: 'https://x/a.mp4' },
    ]);
    expect(avatarClipUrlFor({ id: 'a', text: 'Hello  class' })).toBe('https://x/a.mp4');
    expect(avatarClipUrlFor({ id: 'a', text: 'Hello class, edited' })).toBeUndefined();
    expect(avatarClipUrlFor({ id: 'b', text: 'Hello class' })).toBeUndefined();

    const seen: (string | null)[] = [];
    const unsubscribe = subscribeAvatarClip((clip) => seen.push(clip?.actionId ?? null));
    publishAvatarClip({ actionId: 'a', url: 'https://x/a.mp4' });
    clearAvatarClips();
    unsubscribe();
    publishAvatarClip({ actionId: 'z', url: 'https://x/z.mp4' });
    expect(seen).toEqual([null, 'a', null]);
    expect(avatarClipUrlFor({ id: 'a', text: 'Hello class' })).toBeUndefined();
  });
});
