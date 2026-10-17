'use client';

import { useCallback, useEffect, useState } from 'react';

export interface AccountMembership {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  role: 'admin' | 'teacher' | 'student' | 'parent';
}

export interface Account {
  id: string;
  email: string;
  name: string;
  memberships: AccountMembership[];
}

interface AccountState {
  loading: boolean;
  /** False on a deployment without server persistence: there are no accounts. */
  enabled: boolean;
  user: Account | null;
}

/** The signed-in account from `/api/auth/me`, with refresh and sign-out. */
export function useAccount() {
  const [state, setState] = useState<AccountState>({ loading: true, enabled: false, user: null });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { enabled: boolean; user: Account | null };
      setState({ loading: false, enabled: data.enabled, user: data.user });
    } catch {
      setState({ loading: false, enabled: false, user: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setState((previous) => ({ ...previous, user: null }));
  }, []);

  return { ...state, refresh, logout };
}
