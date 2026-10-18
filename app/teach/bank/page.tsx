import { Suspense } from 'react';

import { QuestionBank } from '@/components/teach/question-bank';

export const dynamic = 'force-dynamic';

export default function BankPage() {
  return (
    <Suspense fallback={null}>
      <QuestionBank />
    </Suspense>
  );
}
