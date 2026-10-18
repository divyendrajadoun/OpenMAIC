'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GraduationCap, LogOut, Presentation, School, UserRound } from 'lucide-react';

import { useI18n } from '@/lib/hooks/use-i18n';
import { STAFF_ROLES, useSchoolContext } from '@/lib/hooks/use-school-context';

/**
 * The account entry in the home page's top-right pill: a sign-in link, or the
 * signed-in name with links to the role's home, "My school" and "Sign out".
 * Renders nothing on a deployment without accounts.
 *
 * The home page is the lesson generator, which is a teacher's tool: a signed-in
 * account with only student or parent memberships is sent to My Tutor instead.
 */
export function AccountMenu({ onOpen }: { onOpen?: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { loading, enabled, user, memberships, logout } = useSchoolContext();
  const [open, setOpen] = useState(false);

  const isStaff = memberships.some((m) => STAFF_ROLES.has(m.role));
  const isLearner = !isStaff && memberships.length > 0;

  useEffect(() => {
    if (!loading && user && isLearner && pathname === '/') router.replace('/learn');
  }, [loading, user, isLearner, pathname, router]);

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

  const item = (label: string, icon: React.ReactNode, href: string) => (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        router.push(href);
      }}
      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700"
    >
      {icon}
      {label}
    </button>
  );

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
            {isStaff &&
              item(t('school.teach.title'), <Presentation className="w-4 h-4" />, '/teach')}
            {isLearner &&
              item(t('school.learn.title'), <GraduationCap className="w-4 h-4" />, '/learn')}
            {item(t('school.mySchool'), <School className="w-4 h-4" />, '/school')}
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
