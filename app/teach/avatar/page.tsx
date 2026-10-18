import { Suspense } from 'react';

import { AvatarStudio } from '@/components/teach/avatar-studio';

export const dynamic = 'force-dynamic';

export default function AvatarPage() {
  return (
    <Suspense fallback={null}>
      <AvatarStudio />
    </Suspense>
  );
}
