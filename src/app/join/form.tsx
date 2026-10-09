'use client';

import { useActionState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { acceptInvite, type Result } from '../actions';

export function JoinForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(acceptInvite, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="mb-1.5 block text-xs text-ink-3">Email</span>
        <input value={email} readOnly className="field h-11 text-ink-3" autoComplete="username" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs text-ink-3">New password (10+ characters, letters and numbers)</span>
        <input name="password" type="password" className="field h-11" autoComplete="new-password" required minLength={10} />
      </label>
      {state && !state.ok && <p className="text-sm text-critical">{state.error}</p>}
      <button className="btn btn-primary btn-lg mt-2 w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Join Relay <ArrowRight className="size-4" />
      </button>
    </form>
  );
}
