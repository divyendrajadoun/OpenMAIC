import { Suspense } from 'react';

import { PaperBuilder } from '@/components/teach/paper-builder';

export const dynamic = 'force-dynamic';

export default function PaperPage() {
  return (
    <Suspense fallback={null}>
      <PaperBuilder />
    </Suspense>
  );
}
