'use client';

import { useCallback, useState } from 'react';

import { useAccount, type AccountMembership } from '@/lib/hooks/use-account';

const STORAGE_KEY = 'soai.school.current';

export const STAFF_ROLES: ReadonlySet<AccountMembership['role']> = new Set(['admin', 'teacher']);

/** Where a signed-in account lands: teachers and admins teach, everyone else learns. */
export function homeForMemberships(memberships: readonly AccountMembership[]): string {
  if (memberships.some((m) => STAFF_ROLES.has(m.role))) return '/teach';
  if (memberships.some((m) => m.role === 'student' || m.role === 'parent')) return '/learn';
  return '/school';
}

/**
 * The account plus the school the pages act on: the one remembered in this
 * browser, else the first membership. `staff` filters to admin/teacher
 * memberships for the Teacher Studio pages.
 */
export function useSchoolContext(options: { staff?: boolean } = {}) {
  const account = useAccount();
  const memberships = account.user?.memberships ?? [];
  const candidates = options.staff
    ? memberships.filter((m) => STAFF_ROLES.has(m.role))
    : memberships;
  const [storedId, setStoredId] = useState<string | null>(() => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const school = candidates.find((m) => m.schoolId === storedId) ?? candidates[0] ?? null;

  const setSchoolId = useCallback((schoolId: string) => {
    setStoredId(schoolId);
    try {
      window.localStorage.setItem(STORAGE_KEY, schoolId);
    } catch {
      /* storage unavailable */
    }
  }, []);

  return { ...account, memberships, schools: candidates, school, setSchoolId };
}
