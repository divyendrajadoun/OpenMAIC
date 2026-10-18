import { Suspense } from 'react';

import { StudentHome } from '@/components/learn/student-home';

export const dynamic = 'force-dynamic';

export default function LearnPage() {
  return (
    <Suspense fallback={null}>
      <StudentHome />
    </Suspense>
  );
}
