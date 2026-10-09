'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUp, Loader2, Sparkles, X } from 'lucide-react';
import type { Me } from './nav';
import { useLive } from './live';

type Msg = { role: 'user' | 'assistant'; text: string; links?: { href: string; label: string }[]; tools?: string[] };

const STARTERS = [
  'What needs attention right now?',
  'Which orders are late, and where are they stuck?',
  'Why are COD refusals up this week?',
  'Which products come back the most, and why?',
  'How is Kuwait doing compared with last week?',
];

/** Ask Relay: questions in plain words, answered from live data with the asker's own access. */
export function Copilot({ me }: { me: Me }) {
  const { copilotOpen, closeCopilot, copilotPrompt } = useLive();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (copilotOpen) {
      setTimeout(() => input.current?.focus(), 30);
      if (copilotPrompt) void ask(copilotPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copilotOpen, copilotPrompt]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setQ('');
    const history = [...msgs, { role: 'user' as const, text: question }];
    setMsgs(history);
    setBusy(true);
    try {
      const r = await fetch('/api/copilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, text: m.text })) }) });
      const d = await r.json();
      setMsgs((m) => [...m, { role: 'assistant', text: d.text ?? d.error ?? 'No answer.', links: d.links, tools: d.tools }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: 'I lost the connection. Try again.' }]);
    } finally {
      setBusy(false);
    }
  }

  if (!copilotOpen) return null;
  return (
    <div className="fixed inset-0 z-[65]" role="dialog" aria-modal aria-label="Ask Relay">
      <button className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={closeCopilot} aria-label="Close" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col border-l border-line-2 bg-elev shadow-[var(--shadow-lg)]" style={{ animation: 'rise .35s var(--ease-out-expo)' }}>
        <header className="flex h-14 items-center gap-2.5 border-b border-line px-4">
          <span className="grid size-7 place-items-center rounded-lg bg-signal/15">
            <Sparkles className="size-4 text-signal" />
          </span>
          <div className="leading-tight">
            <div className="text-[14px] font-medium">Ask Relay</div>
            <div className="text-[11px] text-ink-3">Answers from live data, within your access</div>
          </div>
          <button onClick={closeCopilot} className="btn btn-ghost btn-sm ml-auto !px-2" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
          {msgs.length === 0 && (
            <div className="pt-6">
              <p className="font-display text-[30px] leading-tight">
                What do you want to know, {me.name.split(' ')[0]}?
              </p>
              <div className="mt-5 space-y-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => ask(s)} className="block w-full rounded-xl border border-line bg-elev-2 px-3.5 py-2.5 text-left text-[13px] text-ink-2 transition hover:border-line-3 hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, k) =>
            m.role === 'user' ? (
              <div key={k} className="ml-10 rounded-2xl rounded-br-md bg-inv px-3.5 py-2.5 text-[13.5px] text-inv-ink">
                {m.text}
              </div>
            ) : (
              <div key={k} className="space-y-2">
                {m.tools && m.tools.length > 0 && <div className="text-[11px] text-ink-4">Looked at: {m.tools.join(' · ')}</div>}
                <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{m.text}</div>
                {m.links && m.links.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.links.slice(0, 12).map((l) => (
                      <Link key={l.href} href={l.href} onClick={closeCopilot} className="rounded-lg border border-line bg-elev-2 px-2 py-1 font-mono text-[11.5px] text-ink-2 hover:border-line-3 hover:text-ink">
                        {l.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {busy && (
            <div className="flex items-center gap-2 text-[13px] text-ink-3">
              <Loader2 className="size-4 animate-spin" /> Reading the floor…
            </div>
          )}
          <div ref={end} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(q);
          }}
          className="border-t border-line p-3"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-line-2 bg-inset p-2 focus-within:border-line-3">
            <textarea
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(q);
                }
              }}
              rows={1}
              placeholder="Ask about orders, delays, returns, cash…"
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] outline-none placeholder:text-ink-4"
            />
            <button className="btn btn-primary btn-sm !size-9 !rounded-xl !p-0" disabled={busy || !q.trim()} aria-label="Ask">
              <ArrowUp className="size-4" />
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
