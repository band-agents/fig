'use client';

import { useActionState, useTransition } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { createOwner, demoSignIn, signIn, type Result } from '../actions';
import { initials } from '@/lib/format';

export function LoginForm({ next, setup }: { next: string; setup: boolean }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(setup ? createOwner : signIn, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      {setup && (
        <label className="block">
          <span className="mb-1.5 block text-xs text-ink-3">Your name</span>
          <input name="name" className="field h-11" autoComplete="name" required />
        </label>
      )}
      <label className="block">
        <span className="mb-1.5 block text-xs text-ink-3">Work email</span>
        <input name="email" type="email" className="field h-11" autoComplete="email" required />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs text-ink-3">Password</span>
        <input name="password" type="password" className="field h-11" autoComplete={setup ? 'new-password' : 'current-password'} required />
      </label>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-critical">
          {state.error}
        </p>
      )}
      <button className="btn btn-primary btn-lg mt-2 w-full" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {setup ? 'Create owner account' : 'Sign in'}
        {!pending && <ArrowRight className="size-4" />}
      </button>
    </form>
  );
}

export function DemoDoor({ email, name, role, title, hue }: { email: string; name: string; role: string; title: string; hue: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => demoSignIn(email))}
      disabled={pending}
      className="group flex items-center gap-3 rounded-xl border border-line bg-elev px-3 py-2.5 text-left transition hover:border-line-3 hover:bg-elev-2 disabled:opacity-60"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: `oklch(0.55 0.13 ${hue})` }}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : initials(name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{role}</span>
        <span className="block truncate text-xs text-ink-3">
          {name}
          {title && title !== role ? ` · ${title}` : ''}
        </span>
      </span>
      <ArrowRight className="ml-auto size-3.5 text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink-2" />
    </button>
  );
}
