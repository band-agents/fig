'use client';

import { useState } from 'react';
import { Check, Copy, Mail, MessageCircle, Phone, Camera, MessagesSquare } from 'lucide-react';
import type { Template } from '@/lib/kb/types';
import { Blanks } from './bits';

const CHANNEL = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  email: { label: 'Email', icon: Mail },
  instagram: { label: 'Instagram', icon: Camera },
  phone: { label: 'Phone', icon: Phone },
  any: { label: 'Any channel', icon: MessagesSquare },
} as const;

/** One ready reply: a chat bubble with its blanks lit up, and one click to copy it. */
export function Reply({ t, from }: { t: Template; from?: { title: string; href: string } }) {
  const [done, setDone] = useState(false);
  const ch = CHANNEL[t.channel] ?? CHANNEL.any;
  const Icon = ch.icon;
  const rtl = t.lang === 'ar';
  return (
    <div className="panel flex flex-col gap-2.5 p-3.5">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
          <Icon className="size-3.5 text-ink-3" />
          {ch.label}
        </span>
        <span className="rounded border border-line px-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">{t.lang}</span>
        <button
          onClick={() =>
            navigator.clipboard?.writeText(t.body).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            })
          }
          className="btn btn-ghost btn-sm ml-auto !h-7 !px-2 text-[12px]"
        >
          {done ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
          {done ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="text-[13px] font-semibold">{t.name}</div>
      <div className="kb-bubble" dir={rtl ? 'rtl' : 'ltr'} lang={t.lang}>
        <Blanks body={t.body} />
      </div>
      {from && (
        <a href={from.href} className="text-[11.5px] text-ink-4 hover:text-ink-2">
          From: {from.title}
        </a>
      )}
    </div>
  );
}
