'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  FileText,
  GraduationCap,
  Library,
  Presentation,
  School,
  Sparkles,
  Users,
  WandSparkles,
} from 'lucide-react';

import { useI18n } from '@/lib/hooks/use-i18n';
import { STAFF_ROLES, useSchoolContext } from '@/lib/hooks/use-school-context';
import { cn } from '@/lib/utils';

/**
 * The buttons that take a signed-in teacher or student to every tool: shown
 * on the home dashboard and on each school page, so nothing needs a typed
 * address. Renders nothing for visitors without an account.
 */
export function SchoolNav({ className }: { className?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { loading, enabled, user, memberships } = useSchoolContext();
  if (loading || !enabled || !user || memberships.length === 0) return null;

  const isStaff = memberships.some((m) => STAFF_ROLES.has(m.role));
  const items: { href: string; label: string; icon: React.ReactNode }[] = isStaff
    ? [
        {
          href: '/',
          label: t('school.teach.newLesson'),
          icon: <WandSparkles className="h-4 w-4" />,
        },
        {
          href: '/teach',
          label: t('school.teach.title'),
          icon: <Presentation className="h-4 w-4" />,
        },
        {
          href: '/teach/paper',
          label: t('school.teach.paper'),
          icon: <FileText className="h-4 w-4" />,
        },
        {
          href: '/teach/bank',
          label: t('school.teach.bank'),
          icon: <Library className="h-4 w-4" />,
        },
        {
          href: '/teach/avatar',
          label: t('school.teach.avatar'),
          icon: <Sparkles className="h-4 w-4" />,
        },
        { href: '/school', label: t('school.teach.classes'), icon: <Users className="h-4 w-4" /> },
      ]
    : [
        {
          href: '/learn',
          label: t('school.learn.title'),
          icon: <GraduationCap className="h-4 w-4" />,
        },
        { href: '/school', label: t('school.mySchool'), icon: <School className="h-4 w-4" /> },
      ];

  return (
    <nav
      aria-label={t('school.dashboard')}
      className={cn('flex flex-wrap justify-center gap-2', className)}
    >
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <button
            key={item.href}
            type="button"
            onClick={() => router.push(item.href)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-sm transition',
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border/60 bg-white/80 text-foreground hover:border-primary/50 hover:bg-white dark:bg-slate-900/70 dark:hover:bg-slate-900',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
