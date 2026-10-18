'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, School } from 'lucide-react';

import { useI18n } from '@/lib/hooks/use-i18n';

/** The page frame shared by the school, teacher and student pages. */
export function Shell({
  title,
  back,
  icon,
  children,
}: {
  title: string;
  back?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 md:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={back ?? (() => router.push('/'))}
            className="rounded-full p-2 text-muted-foreground hover:bg-white dark:hover:bg-gray-800"
            aria-label={t('school.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          {icon ?? <School className="h-5 w-5 text-primary" />}
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="space-y-5">{children}</div>
      </div>
    </div>
  );
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card/80 p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A native select styled like the Input component; enough for short option lists. */
export function SelectField({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[] | readonly string[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={`h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 ${className ?? ''}`}
    >
      {options.map((option) => {
        const item = typeof option === 'string' ? { value: option, label: option } : option;
        return (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        );
      })}
    </select>
  );
}
