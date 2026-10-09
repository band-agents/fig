'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="btn btn-ghost btn-sm !h-7 !px-2"
      aria-label="Copy"
    >
      {done ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
    </button>
  );
}
