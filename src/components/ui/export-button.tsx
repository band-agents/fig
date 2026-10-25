'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { fileName, toCsv, toXlsx, XLSX_TYPE, type Sheet } from '@/lib/sheet';

/**
 * Export, on every list and table: Excel (.xlsx) or CSV. Give it the rows the card already holds
 * (`sheets`), or, for a long list where the page only shows the first screen, a route that builds the
 * whole thing on the server (`href`; it is called with ?format=xlsx|csv). The file carries what the
 * person may see: the page or the route has already masked the rest.
 */
export function ExportButton({ name, sheets, href, label = 'Export', quiet = false }: { name: string; sheets?: Sheet[]; href?: string; label?: string; quiet?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const save = (format: 'xlsx' | 'csv') => {
    setOpen(false);
    if (href) {
      const a = document.createElement('a');
      a.href = `${href}${href.includes('?') ? '&' : '?'}format=${format}`;
      a.click();
      return;
    }
    if (!sheets?.length) return;
    const blob = format === 'xlsx' ? new Blob([toXlsx(sheets) as BlobPart], { type: XLSX_TYPE }) : new Blob([toCsv(sheets[0])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(name, format);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className={quiet ? 'inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium text-ink-3 transition hover:bg-elev-2 hover:text-ink' : 'btn btn-quiet btn-sm'} aria-haspopup="menu" aria-expanded={open} title={`Export ${name}`}>
        <Download className="size-3.5" />
        {label}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-[60] w-[190px] overflow-hidden rounded-2xl bg-elev p-1.5 shadow-[var(--shadow-lg)] rise">
          <button role="menuitem" onClick={() => save('xlsx')} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12.5px] hover:bg-elev-2">
            <FileSpreadsheet className="size-4 text-[var(--good)]" /> Excel (.xlsx)
          </button>
          <button role="menuitem" onClick={() => save('csv')} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12.5px] hover:bg-elev-2">
            <FileText className="size-4 text-ink-3" /> CSV
          </button>
        </div>
      )}
    </div>
  );
}
