'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut, School, UserRound } from 'lucide-react';

import { useAccount } from '@/lib/hooks/use-account';
import { useI18n } from '@/lib/hooks/use-i18n';

/**
 * The account entry in the home page's top-right pill: a sign-in link, or the
 * signed-in name with "My school" and "Sign out". Renders nothing on a
 * deployment without accounts.
 */
export function AccountMenu({ onOpen }: { onOpen?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { loading, enabled, user, logout } = useAccount();
  const [open, setOpen] = useState(false);

  if (loading || !enabled) return null;

  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={() => router.push('/login')}
          className="px-3 py-1.5 rounded-full text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 hover:shadow-sm transition-all"
        >
          {t('school.signIn')}
        </button>
        <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            onOpen?.();
            setOpen(!open);
          }}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 hover:shadow-sm transition-all max-w-[160px]"
        >
          <UserRound className="w-4 h-4 shrink-0" />
          <span className="truncate">{user.name}</span>
        </button>
        {open && (
          <div className="absolute top-full mt-2 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[180px]">
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700 truncate">
              {user.email}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push('/school');
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <School className="w-4 h-4" />
              {t('school.mySchool')}
            </button>
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                await logout();
                router.refresh();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <LogOut className="w-4 h-4" />
              {t('school.signOut')}
            </button>
          </div>
        )}
      </div>
      <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700" />
    </>
  );
}
