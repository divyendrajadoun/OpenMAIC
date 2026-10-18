import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the IndexedDB layer so importing AudioPlayer doesn't pull in Dexie.
vi.mock('@/lib/utils/database', () => ({
  db: { audioFiles: { get: vi.fn() } },
}));

class AudioStub {
  play = vi.fn(async () => {});
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  volume = 1;
  preload = 'auto';
  defaultPlaybackRate = 1;
  playbackRate = 1;
  currentTime = 0;
  src = '';
  paused = true;
  onended: (() => void) | null = null;
}

/** Stub Audio; `play` decides how every element's play() behaves. */
function stubAudio(play: () => Promise<void> = async () => {}) {
  const instances: AudioStub[] = [];
  class TrackedAudio extends AudioStub {
    constructor() {
      super();
      this.play = vi.fn(play);
      instances.push(this);
    }
  }
  vi.stubGlobal('Audio', TrackedAudio);
  return instances;
}

describe('AudioPlayer.playUrl (avatar clips)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('streams the clip through the shared element without fetching it first', async () => {
    const instances = stubAudio();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { AudioPlayer } = await import('@/lib/utils/audio-player');
    const player = new AudioPlayer();
    player.setPlaybackRate(1.5);

    const started = await player.playUrl('https://clips.example/line-1.mp4');

    expect(started).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(instances).toHaveLength(1);
    expect(instances[0].src).toBe('https://clips.example/line-1.mp4');
    expect(instances[0].playbackRate).toBe(1.5);
    expect(instances[0].play).toHaveBeenCalledTimes(1);

    const ended = vi.fn();
    player.onEnded(ended);
    instances[0].onended?.();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('gives up on a clip that does not start in time so the line can fall back', async () => {
    vi.useFakeTimers();
    // A stalled network: play() never settles.
    const instances = stubAudio(() => new Promise<void>(() => {}));
    const { AudioPlayer } = await import('@/lib/utils/audio-player');
    const player = new AudioPlayer();
    const pending = player.playUrl('https://clips.example/stalled.mp4', 2_000);
    await vi.advanceTimersByTimeAsync(2_100);

    await expect(pending).resolves.toBe(false);
    expect(instances[0].pause).toHaveBeenCalled();
    expect(instances[0].removeAttribute).toHaveBeenCalledWith('src');
  });

  it('reports false instead of throwing when the clip cannot be played', async () => {
    stubAudio(async () => {
      throw new Error('decode failed');
    });
    const { AudioPlayer } = await import('@/lib/utils/audio-player');
    const player = new AudioPlayer();
    await expect(player.playUrl('https://clips.example/broken.mp4')).resolves.toBe(false);
  });
});
