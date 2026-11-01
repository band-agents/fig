'use client';

import { useState, useTransition } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { resetAllPasswordsAction } from '@/app/actions';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';

/**
 * Team & access → "New password for everyone" (Dan, 1 Nov): one click emails every active teammate
 * except you a new temporary password. The window names everyone first and says what happens to them;
 * nothing is sent until "Email the new passwords".
 */
export function ResetAllButton({ people, mailReady }: { people: { name: string; email: string }[]; mailReady: boolean }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!people.length) return null;
  const close = () => {
    setOpen(false);
    setDone(null);
  };
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-quiet btn-sm">
        <KeyRound className="size-3.5" /> New password for everyone
      </button>
      {open && (
        <Modal title="New password for everyone" sub={`${people.length} teammates get an email with a new temporary password.`} onClose={close} wide>
          {done ? (
            <div className="grid gap-4">
              <p className="text-[13px]">{done}</p>
              <div className="flex justify-end">
                <button onClick={close} className="btn btn-primary">
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="rounded-[6px] border-l-[3px] border-[#fab219] bg-elev-2 px-3 py-2.5 text-[12.5px] leading-relaxed">
                Each of them is signed out and their current password stops working. They sign in with the password in the email (it comes from no-reply@dagher-hinnawi.com, so ask them to check spam) and then choose their own. You stay signed in, and the console&apos;s own @dh-dco.local accounts are left out.
              </div>
              <ul className="scroll-thin max-h-[300px] divide-y divide-[var(--line)] overflow-auto rounded-[6px] border border-line">
                {people.map((p) => (
                  <li key={p.email} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="truncate text-ink-3">{p.email}</span>
                  </li>
                ))}
              </ul>
              {!mailReady && <p className="text-[12.5px] text-critical">Email is not set up on this server, so nothing can be sent.</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={close} className="btn btn-quiet" disabled={pending}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  disabled={pending || !mailReady}
                  onClick={() =>
                    start(async () => {
                      const r = await resetAllPasswordsAction();
                      if (r.ok) {
                        setDone(r.message ?? 'Sent.');
                        toast(r.message ?? 'Sent.');
                      } else toast(r.error, { tone: 'error' });
                    })
                  }
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  {pending ? 'Sending…' : `Email the new passwords (${people.length})`}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
