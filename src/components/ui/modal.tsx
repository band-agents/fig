'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import { X } from 'lucide-react';

/** Native <dialog>: focus trap, Escape and backdrop for free. Marks the page as editing so live
 *  refreshes wait until it closes. */
export function Modal({ title, sub, onClose, children, wide = false }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const onClosed = useEffectEvent(() => onClose());
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    const close = () => onClosed();
    d.addEventListener('close', close);
    return () => d.removeEventListener('close', close);
  }, []);
  return (
    <dialog
      ref={ref}
      data-editing="true"
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className={`m-auto w-[calc(100vw-24px)] ${wide ? 'max-w-[640px]' : 'max-w-[460px]'} rounded-[10px] border-0 bg-elev p-0 text-ink shadow-[0_24px_64px_rgb(0_0_0/0.3)]`}
    >
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-display text-[18px] leading-tight">{title}</h3>
          {sub && <p className="mt-0.5 text-[12.5px] text-ink-3">{sub}</p>}
        </div>
        <button onClick={() => ref.current?.close()} className="btn btn-ghost btn-sm ml-auto !px-2" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
