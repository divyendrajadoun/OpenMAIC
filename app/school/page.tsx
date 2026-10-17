import { Suspense } from 'react';

import { SchoolDashboard } from '@/components/school/school-dashboard';

export const dynamic = 'force-dynamic';

export default function SchoolPage() {
  return (
    <Suspense fallback={null}>
      <SchoolDashboard />
    </Suspense>
  );
}
