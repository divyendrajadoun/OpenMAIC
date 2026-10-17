import { Suspense } from 'react';

import { LoginForm } from '@/components/school/login-form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
