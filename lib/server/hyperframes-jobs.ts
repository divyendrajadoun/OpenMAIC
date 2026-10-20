/**
 * Render jobs that HeyGen's HyperFrames cloud runs for the video export, in
 * the job vocabulary the export client already speaks for the render service.
 * A HeyGen job id carries a prefix so the job routes know who to ask.
 */
import type { HyperframesRender } from '@/lib/server/heygen';

const PREFIX = 'heygen:';

export function heygenJobId(renderId: string): string {
  return PREFIX + renderId;
}

/** The HeyGen render id behind a job id, or null for a render-service job. */
export function heygenRenderId(jobId: string): string | null {
  return jobId.startsWith(PREFIX) ? jobId.slice(PREFIX.length) : null;
}

export interface ExportJobStatus {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  currentStage?: string;
  error?: string;
  done: boolean;
}

/** HeyGen's render lifecycle as the export client's job status. */
export function jobStatusFromRender(jobId: string, render: HyperframesRender): ExportJobStatus {
  switch (render.status) {
    case 'completed':
      return { jobId, status: 'succeeded', progress: 1, done: true };
    case 'failed':
      return {
        jobId,
        status: 'failed',
        progress: 0,
        error: render.failure_message ?? 'Render failed',
        done: true,
      };
    case 'rendering':
      // HeyGen reports no percentage; a fixed midpoint keeps the bar moving
      // past "queued" without pretending to know more.
      return { jobId, status: 'running', progress: 0.5, currentStage: 'rendering', done: false };
    default:
      return { jobId, status: 'queued', progress: 0.05, currentStage: 'queued', done: false };
  }
}
