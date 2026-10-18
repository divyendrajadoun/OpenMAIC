import { Suspense } from 'react';

import { TeacherHome } from '@/components/teach/teacher-home';

export const dynamic = 'force-dynamic';

export default function TeachPage() {
  return (
    <Suspense fallback={null}>
      <TeacherHome />
    </Suspense>
  );
}
