'use client';

import { useRef, useState, useTransition } from 'react';
import { Check, Download, FileUp, Loader2, Mail, Upload } from 'lucide-react';
import { applyImportAction, previewImportAction } from '@/app/(console)/imports/actions';
import { emailLoginAction } from '@/app/actions';
import { fileName, toXlsx, XLSX_TYPE } from '@/lib/sheet';
import { Modal } from './modal';
import { toast } from './toast';

type Kind = 'costs' | 'targets' | 'team';
type Preview = Extract<Awaited<ReturnType<typeof previewImportAction>>, { ok: true }>;
type Logins = { name: string; email: string; password: string }[];

/**
 * Import, beside Export: download the template (today's figures already in it), fill it in Excel,
 * upload it, see what matched, apply. Nothing changes until Apply.
 */
export function ImportButton({ kind, title, sub, apply, label = 'Import', mailReady = false }: { kind: Kind; title: string; sub: string; apply: string; label?: string; mailReady?: boolean }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [logins, setLogins] = useState<Logins | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [mailed, setMailed] = useState<{ done: number; failed: string[] } | null>(null);
  const [mailing, setMailing] = useState(false);
  // each new teammate gets their own login by email, one after the other
  const mailAll = async () => {
    if (!logins) return;
    setMailing(true);
    let done = 0;
    const failed: string[] = [];
    for (const l of logins) {
      const r = await emailLoginAction({ email: l.email, password: l.password });
      if (r.ok) done++;
      else failed.push(`${l.email}: ${r.error}`);
      setMailed({ done, failed: [...failed] });
    }
    setMailing(false);
    toast(failed.length ? `${done} emailed, ${failed.length} not` : `${done} logins emailed`, { tone: failed.length ? 'error' : 'ok' });
  };
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPreview(null);
    setError(null);
    setLogins(null);
    if (input.current) input.current.value = '';
  };
  const read = (file: File) =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.set('file', file);
      const r = await previewImportAction(kind, fd);
      if (r.ok) setPreview(r);
      else setError(r.error);
    });
  const save = () =>
    start(async () => {
      if (!preview) return;
      const r = await applyImportAction(kind, preview.rows);
      if (!r.ok) return setError(r.error);
      toast(r.message);
      if (r.logins.length) setLogins(r.logins);
      else {
        setOpen(false);
        reset();
      }
      if (r.problems.length) setError(r.problems.map((p) => p.message).join(' · '));
    });
  const saveLogins = () => {
    if (!logins) return;
    const blob = new Blob([toXlsx([{ name: 'Logins', columns: [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'password', label: 'Temporary password' }, { key: 'link', label: 'Sign in at' }], rows: logins.map((l) => ({ ...l, link: `${location.origin}/login` })) }]) as BlobPart], { type: XLSX_TYPE });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName('new-logins', 'xlsx');
    a.click();
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-quiet btn-sm" title={title}>
        <Upload className="size-3.5" /> {label}
      </button>
      {open && (
        <Modal
          title={title}
          sub={sub}
          wide
          onClose={() => {
            setOpen(false);
            reset();
          }}
        >
          {logins ? (
            <div className="space-y-3">
              <p className="text-[12.5px] text-ink-2">Send each person their login. The temporary passwords are shown only now: save them before closing.</p>
              <div className="scroll-thin max-h-[300px] overflow-auto rounded-xl border border-line">
                <table className="table text-[12px]">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Temporary password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logins.map((l) => (
                      <tr key={l.email}>
                        <td>{l.name}</td>
                        <td>{l.email}</td>
                        <td className="font-mono">{l.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mailed && mailed.failed.length > 0 && <p className="text-[11.5px] text-critical">{mailed.failed.join(' · ')}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={saveLogins} className="btn btn-quiet btn-sm">
                  <Download className="size-3.5" /> Download the logins
                </button>
                {mailReady ? (
                  <button onClick={mailAll} disabled={mailing || (mailed?.done ?? 0) === logins.length} className="btn btn-primary btn-sm">
                    {mailing ? <Loader2 className="size-3.5 animate-spin" /> : mailed && mailed.done === logins.length ? <Check className="size-3.5" /> : <Mail className="size-3.5" />}
                    {mailed ? `${mailed.done} of ${logins.length} emailed` : 'Email everyone their login'}
                  </button>
                ) : (
                  <span className="btn btn-primary btn-sm pointer-events-none opacity-45" title="Set up email first: SMTP settings in relay/.env.local">
                    <Mail className="size-3.5" /> Email everyone their login
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <ol className="space-y-3 text-[12.5px]">
                <li className="flex items-center justify-between gap-3">
                  <span>
                    <b className="mr-1.5 text-ink-3">1</b> Download the template, with today’s figures in it
                  </span>
                  <a href={`/imports/${kind}/template`} className="btn btn-quiet btn-sm shrink-0">
                    <Download className="size-3.5" /> Template
                  </a>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span>
                    <b className="mr-1.5 text-ink-3">2</b> Fill it in and upload it (.xlsx or .csv)
                  </span>
                  <label className="btn btn-quiet btn-sm shrink-0 cursor-pointer">
                    {pending && !preview ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />} Choose file
                    <input ref={input} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
                  </label>
                </li>
              </ol>

              {preview && (
                <div className="space-y-2 rounded-xl bg-elev-2 p-3.5">
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="truncate font-medium">{preview.file}</span>
                    <button onClick={reset} className="text-[11.5px] text-ink-3 hover:text-ink">
                      Choose another
                    </button>
                  </div>
                  {preview.missing.length > 0 ? (
                    <p className="text-[12.5px] text-critical">Missing column{preview.missing.length > 1 ? 's' : ''}: {preview.missing.join(', ')}. Use the template’s headers.</p>
                  ) : (
                    <p className="text-[12.5px] text-ink-2">{preview.summary}</p>
                  )}
                  {preview.problems.length > 0 && (
                    <ul className="scroll-thin max-h-[140px] space-y-0.5 overflow-auto text-[11.5px] text-ink-3">
                      {preview.problems.slice(0, 200).map((p) => (
                        <li key={`${p.line}${p.message}`}>
                          Row {p.line}: {p.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {error && <p className="text-[12px] text-critical">{error}</p>}

              <div className="flex justify-end gap-2">
                <button onClick={save} disabled={pending || !preview || !preview.rows.length} className="btn btn-primary btn-sm">
                  {pending && preview ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  {apply}
                  {preview?.rows.length ? ` (${preview.rows.length})` : ''}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
