'use server';

import { refresh } from 'next/cache';
import { currentUser, assertCanAct } from '@/lib/auth/session';
import { RelayError } from '@/lib/errors';
import { readGrid } from '@/lib/sheet-read';
import { applyImport, isKind, mayImport, previewImport, tempPassword, type Problem, type TeamRow } from '@/lib/imports';
import { saveMemberAction } from '@/app/actions';

const MAX_BYTES = 8 * 1024 * 1024;

async function allowed(kind: string) {
  const u = await currentUser();
  if (!u) throw new RelayError('forbidden', 'You are signed out.');
  assertCanAct(u);
  if (!isKind(kind) || !mayImport(u, kind)) throw new RelayError('forbidden', 'Your access does not include this import.');
  return { u, kind };
}

const fail = (e: unknown) => (e instanceof RelayError ? e.message : (console.error('[relay] import failed', e), 'The file could not be read. Save it as .xlsx or .csv and try again.'));

/** Reads the uploaded sheet and says, row by row, what would change. Nothing is written. */
export async function previewImportAction(kind: string, form: FormData) {
  try {
    const { u, kind: k } = await allowed(kind);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new RelayError('invalid', 'Choose a file.');
    if (file.size > MAX_BYTES) throw new RelayError('invalid', 'That file is over 8 MB: split it and import in parts.');
    const grid = readGrid(new Uint8Array(await file.arrayBuffer()), file.name);
    if (grid.length < 2) throw new RelayError('invalid', 'The first sheet has no rows under its header.');
    const p = await previewImport(u, k, grid);
    return { ok: true as const, ...p, file: file.name };
  } catch (e) {
    return { ok: false as const, error: fail(e) };
  }
}

/** Writes what the preview showed, checking it all again on the server. Teammates come back with their temporary passwords, shown once. */
export async function applyImportAction(kind: string, rows: unknown[]) {
  try {
    const { u, kind: k } = await allowed(kind);
    if (!Array.isArray(rows) || rows.length > 25_000) throw new RelayError('invalid', 'Nothing to import.');
    if (k !== 'team') {
      const message = await applyImport(u, k, rows);
      refresh();
      return { ok: true as const, message, logins: [] as { name: string; email: string; password: string }[], problems: [] as Problem[] };
    }
    const logins: { name: string; email: string; password: string }[] = [];
    const problems: Problem[] = [];
    for (const r of rows as TeamRow[]) {
      const password = r.password || tempPassword();
      const res = await saveMemberAction({ email: r.email, name: r.name, title: r.title ?? undefined, role: r.role, channels: r.channels, brands: r.brands, tempPassword: password });
      if (res.ok) logins.push({ name: r.name, email: r.email, password });
      else problems.push({ line: r.line, message: `${r.email}: ${res.error}` });
    }
    refresh();
    return { ok: true as const, message: `${logins.length} teammates added${problems.length ? `, ${problems.length} not added` : ''}.`, logins, problems };
  } catch (e) {
    return { ok: false as const, error: fail(e) };
  }
}
