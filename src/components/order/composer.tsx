'use client';

import { useState, useTransition } from 'react';
import { Loader2, Send } from 'lucide-react';
import { noteAction } from '@/app/actions';
import { toast } from '@/components/ui/toast';

export function NoteComposer({ target, placeholder = 'Add a note for the team…' }: { target: { orderId?: string; returnId?: string }; placeholder?: string }) {
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await noteAction(target, text);
      if (r.ok) setText('');
      else toast(r.error, { tone: 'error' });
    });
  return (
    <div className="flex items-end gap-2 rounded-xl border border-line-2 bg-inset p-1.5 focus-within:border-line-3" data-editing={text ? 'true' : undefined}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        rows={1}
        placeholder={placeholder}
        className="max-h-32 min-h-[34px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[12.5px] outline-none placeholder:text-ink-4"
      />
      <button onClick={submit} disabled={pending || !text.trim()} className="btn btn-quiet btn-sm !size-8 !p-0" aria-label="Post note">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-3.5" />}
      </button>
    </div>
  );
}
