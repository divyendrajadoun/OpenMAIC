'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { GraduationCap, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';

type Mode = 'signin' | 'signup';

/** Only same-origin paths are followed after sign-in. */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(params.get('invite') ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const next = safeNext(params.get('next'));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'signup' ? '/api/auth/register' : '/api/auth/login';
      const body =
        mode === 'signup'
          ? {
              name,
              email,
              password,
              ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
            }
          : { email, password };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          data.error ?? t(mode === 'signup' ? 'school.registerFailed' : 'school.loginFailed'),
        );
        return;
      }
      // Work done before signing in (the anonymous trial) moves into the account.
      await fetch('/api/identity/claim', { method: 'POST' }).catch(() => undefined);
      router.push(next);
      router.refresh();
    } catch {
      setError(t('school.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border/50 bg-card/80 p-8 shadow-xl backdrop-blur-xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <GraduationCap className="h-7 w-7 text-primary" strokeWidth={1.5} />
        </div>
        <h1 className="mb-1 text-center text-lg font-semibold tracking-tight">
          {t(mode === 'signup' ? 'school.signUpTitle' : 'school.signInTitle')}
        </h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">School of AI Classroom</p>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (
            <Input
              placeholder={t('school.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          )}
          <Input
            type="email"
            placeholder={t('school.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <Input
            type="password"
            placeholder={t('school.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            required
          />
          {mode === 'signup' && (
            <div>
              <Input
                placeholder={t('school.inviteCode')}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('school.inviteCodeHint')}</p>
            </div>
          )}
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              t(mode === 'signup' ? 'school.signUp' : 'school.signIn')
            )}
          </Button>
        </form>

        <button
          type="button"
          className="mt-5 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          onClick={() => {
            setError('');
            setMode(mode === 'signup' ? 'signin' : 'signup');
          }}
        >
          {t(mode === 'signup' ? 'school.haveAccount' : 'school.noAccount')}
        </button>
      </div>
    </div>
  );
}
