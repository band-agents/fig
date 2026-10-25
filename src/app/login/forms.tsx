'use client';

import { useActionState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { createOwner, signIn, type Result } from '../actions';

export function LoginForm({ next, setup }: { next: string; setup: boolean }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(setup ? createOwner : signIn, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      {setup && (
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-ink-2">Your name</span>
          <input name="name" className="field h-10" autoComplete="name" required />
        </label>
      )}
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] text-ink-2">Work email</span>
        <input name="email" type="email" className="field h-10" autoComplete="email" required />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[12.5px] text-ink-2">Password</span>
        <input name="password" type="password" className="field h-10" autoComplete={setup ? 'new-password' : 'current-password'} required />
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
