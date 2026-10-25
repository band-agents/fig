import 'server-only';

/**
 * Keeps a slow, read-only view in memory for a few minutes, per key (Dan, 22 Oct: pages must open at
 * once). A visit after it has gone stale still gets the kept copy straight away while a fresh one is
 * read behind it, so only the first visit after a restart waits. Only for views where figures a few
 * minutes old are fine (last year's months, weekly history), never for queues or anything a click
 * changes. The key must carry everything that decides what the person may see.
 */
type Entry = { at: number; v: Promise<unknown>; next?: Promise<unknown> };
const g = globalThis as unknown as { __remember?: Map<string, Entry> };
const MAX = 300;

export function remember<T>(key: string, ttlMs: number, make: () => Promise<T>): Promise<T> {
  const kept = (g.__remember ??= new Map());
  const hit = kept.get(key);
  if (hit && (Date.now() - hit.at < ttlMs || hit.next)) return hit.v as Promise<T>;
  const read = make();
  if (hit) {
    // stale: hand back the kept copy, and swap in the fresh one once it is read
    hit.next = read;
    read.then(
      (v) => kept.set(key, { at: Date.now(), v: Promise.resolve(v) }),
      () => (hit.next = undefined),
    );
    return hit.v as Promise<T>;
  }
  const entry: Entry = { at: Date.now(), v: read };
  kept.set(key, entry);
  read.catch(() => kept.get(key) === entry && kept.delete(key));
  // the oldest go first once there are many people and filters
  if (kept.size > MAX) kept.delete(kept.keys().next().value!);
  return read;
}

/** Drops every kept view whose key starts with this, so a change (an import) shows on the next visit. */
export function forget(prefix: string) {
  const kept = g.__remember;
  if (!kept) return;
  for (const k of [...kept.keys()]) if (k.startsWith(prefix)) kept.delete(k);
}
