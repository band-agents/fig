'use client';

import { useState, useTransition } from 'react';
import { Loader2, Send } from 'lucide-react';
import { testMailAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';

/** Setup → Channels: send one test email to any address, to see the mail settings work end to end. */
export function MailTest() {
  const [to, setTo] = useState('');
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await testMailAction(to);
          toast(r.ok ? (r.message ?? 'Sent') : r.error, { tone: r.ok ? 'ok' : 'error' });
        });
      }}
    >
      <input value={to} onChange={(e) => setTo(e.target.value)} type="email" required placeholder="Send a test to…" className="field !h-8 text-[12px]" />
      <button disabled={pending || !to} className="btn btn-quiet btn-sm shrink-0">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send test
      </button>
    </form>
  );
}
