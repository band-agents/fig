'use client';

import { Sparkles } from 'lucide-react';
import { useLive } from '@/components/shell/live';

export function AskButton() {
  const { openCopilot } = useLive();
  return (
    <button onClick={() => openCopilot()} className="group flex items-center gap-3 self-start rounded-2xl border border-line-2 bg-elev px-4 py-3 text-left transition hover:border-line-3 lg:self-auto">
      <span className="grid size-8 place-items-center rounded-xl bg-signal/15">
        <Sparkles className="size-4 text-signal" />
      </span>
      <span>
        <span className="block text-[13.5px] font-medium">Ask Relay anything</span>
        <span className="block text-[12px] text-ink-3">“Which Kuwait orders are late?”</span>
      </span>
      <span className="ml-3 hidden gap-0.5 sm:flex">
        <span className="kbd">⌘</span>
        <span className="kbd">J</span>
      </span>
    </button>
  );
}
