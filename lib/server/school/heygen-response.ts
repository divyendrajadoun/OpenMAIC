/**
 * Turn a HeyGen failure into the school routes' error envelope. Anything that
 * is not a {@link HeyGenError} is rethrown for the route runner's 500 path.
 */
import type { NextResponse } from 'next/server';

import { ownerApiError } from '@/lib/server/agent-runtime/route-response';
import { HeyGenError } from '@/lib/server/heygen';

export function heygenFailure(error: unknown, headers: Headers): NextResponse {
  if (error instanceof HeyGenError) {
    return ownerApiError(
      'UPSTREAM_ERROR',
      error.status === 503 ? 503 : 502,
      error.message,
      headers,
    );
  }
  throw error;
}
