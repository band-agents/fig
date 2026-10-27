'use server';

import { refresh } from 'next/cache';
import { assertCanAct, currentUser } from '@/lib/auth/session';
import { RelayError } from '@/lib/errors';
import { cancelJob, importFromExport, reanalyse, startExport, startImport, startRevert, startRun, type ExportJobOptions, type ImportJobOptions } from '@/lib/catalog/jobs';

// Catalogue import & export (Dan, 27 Oct). Every action checks the person again on the server; the
// jobs run in the background and the page follows them live.

const MAX_BYTES = 8 * 1024 * 1024;

async function who() {
  const u = await currentUser();
  if (!u) throw new RelayError('forbidden', 'You are signed out.');
  return u;
}

const fail = (e: unknown) => ({ ok: false as const, error: e instanceof RelayError ? e.message : (console.error('[relay] catalogue action failed', e), e instanceof Error ? e.message : 'That did not work. Try again.') });

/** Upload + dry run: the file is read and checked against the chosen stores. Nothing is written. */
export async function startImportAction(form: FormData) {
  try {
    const u = await who();
    assertCanAct(u);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new RelayError('invalid', 'Choose a file.');
    if (file.size > MAX_BYTES) throw new RelayError('invalid', 'That file is over 8 MB: split it and import it in parts.');
    const stores = form.getAll('store').map(String);
    const options = JSON.parse(String(form.get('options') ?? '{}')) as Partial<ImportJobOptions>;
    const id = await startImport(u, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, stores, options);
    refresh();
    return { ok: true as const, id };
  } catch (e) {
    return fail(e);
  }
}

export async function reanalyseAction(id: string, change: { mapping?: Record<number, string>; stores?: string[]; options?: Partial<ImportJobOptions> }) {
  try {
    const u = await who();
    assertCanAct(u);
    await reanalyse(u, id, change);
    refresh();
    return { ok: true as const };
  } catch (e) {
    return fail(e);
  }
}

export async function runImportAction(id: string) {
  try {
    const u = await who();
    assertCanAct(u);
    await startRun(u, id);
    refresh();
    return { ok: true as const };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelJobAction(id: string) {
  try {
    const u = await who();
    assertCanAct(u);
    await cancelJob(u, id);
    refresh();
    return { ok: true as const };
  } catch (e) {
    return fail(e);
  }
}

export async function startExportAction(store: string, options: Partial<ExportJobOptions>) {
  try {
    const u = await who();
    const id = await startExport(u, store, options);
    refresh();
    return { ok: true as const, id };
  } catch (e) {
    return fail(e);
  }
}

/** An export's products into other stores: a new import (with its own dry run) made from the export. */
export async function copyExportAction(exportId: string, stores: string[]) {
  try {
    const u = await who();
    assertCanAct(u);
    const id = await importFromExport(u, exportId, stores);
    refresh();
    return { ok: true as const, id };
  } catch (e) {
    return fail(e);
  }
}

export async function revertAction(importId: string) {
  try {
    const u = await who();
    assertCanAct(u);
    const id = await startRevert(u, importId);
    refresh();
    return { ok: true as const, id };
  } catch (e) {
    return fail(e);
  }
}
