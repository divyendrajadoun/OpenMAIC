import { describe, expect, it } from 'vitest';

import { heygenJobId, heygenRenderId, jobStatusFromRender } from '@/lib/server/hyperframes-jobs';

describe('HeyGen render jobs', () => {
  it('round-trips a render id through the job id and leaves service ids alone', () => {
    expect(heygenRenderId(heygenJobId('hfr_abc123'))).toBe('hfr_abc123');
    expect(heygenRenderId('job-from-render-service')).toBeNull();
  });

  it('maps HeyGen statuses to the export client vocabulary', () => {
    const id = heygenJobId('hfr_1');
    expect(jobStatusFromRender(id, { render_id: 'hfr_1', status: 'queued' })).toMatchObject({
      status: 'queued',
      done: false,
    });
    expect(jobStatusFromRender(id, { render_id: 'hfr_1', status: 'rendering' })).toMatchObject({
      status: 'running',
      progress: 0.5,
      done: false,
    });
    expect(jobStatusFromRender(id, { render_id: 'hfr_1', status: 'completed' })).toMatchObject({
      status: 'succeeded',
      progress: 1,
      done: true,
    });
    expect(
      jobStatusFromRender(id, {
        render_id: 'hfr_1',
        status: 'failed',
        failure_message: 'bundle has no index.html',
      }),
    ).toMatchObject({ status: 'failed', error: 'bundle has no index.html', done: true });
  });
});
