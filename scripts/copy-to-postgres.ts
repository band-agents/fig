// Moves the console's whole database from PGlite (the folder the self-hosted server uses) into a
// Postgres server (Neon on Vercel). The target gets the same migrations first, is emptied, and then
// receives every table in an order that respects the foreign keys. Counts are compared at the end.
//
//   npx tsx scripts/copy-to-postgres.ts <pglite folder>            dry run: counts only, nothing written
//   npx tsx scripts/copy-to-postgres.ts <pglite folder> --apply    copy for real
//
// The target is MIGRATE_DATABASE_URL (from .env.migrate or the environment), never DATABASE_URL, so the
// local console cannot be pointed at it by accident. Run it on a stopped copy (a backup unpacked, or the
// live folder while the server is stopped): PGlite has one owner.
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const BATCH = 500;

/** The target from .env.migrate: MIGRATE_DATABASE_URL, or Neon's snippet pasted as it is (the direct, unpooled address first). */
function targetUrl() {
  const file = path.join(process.cwd(), '.env.migrate');
  const found = new Map<string, string>();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)$/);
      if (m) found.set(m[1], m[2].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return found.get('MIGRATE_DATABASE_URL') || found.get('DATABASE_URL_UNPOOLED') || found.get('DATABASE_URL') || process.env.MIGRATE_DATABASE_URL?.trim();
}

(async () => {
  const dir = process.argv[2];
  const apply = process.argv.includes('--apply');
  const url = targetUrl();
  if (!dir || !fs.existsSync(dir)) throw new Error('usage: copy-to-postgres.ts <pglite folder> [--apply]');
  if (!url) throw new Error('MIGRATE_DATABASE_URL is not set (put it in relay/.env.migrate)');
  const src = new PGlite(dir);
  const pool = new Pool({ connectionString: url, max: 4, ssl: url.includes('sslmode=disable') ? false : { rejectUnauthorized: false } });
  const host = new URL(url).host;
  console.log(`source ${dir}\ntarget ${host}`);

  // the same schema on the target, from the same migrations
  await migrate(drizzle(pool), { migrationsFolder: path.join(process.cwd(), 'drizzle') });

  const tables = (await src.query<{ t: string }>(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name not like '__drizzle%' order by 1`)).rows.map((r) => r.t);
  // parents before children: a topological order over the foreign keys
  const fks = (await pool.query<{ child: string; parent: string }>(`
    select tc.table_name as child, ccu.table_name as parent
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`)).rows;
  const order: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => !fks.some((f) => f.child === t && f.parent !== t && left.has(f.parent)));
    if (!ready.length) throw new Error(`foreign keys go round in a circle among: ${[...left].join(', ')}`);
    for (const t of ready.sort()) {
      order.push(t);
      left.delete(t);
    }
  }

  const counts: { table: string; source: number; target?: number }[] = [];
  for (const t of order) counts.push({ table: t, source: Number((await src.query<{ n: string }>(`select count(*) as n from "${t}"`)).rows[0].n) });
  if (!apply) {
    for (const c of counts) console.log(`${c.table.padEnd(22)} ${c.source}`);
    console.log(`dry run: ${counts.reduce((a, c) => a + c.source, 0)} rows in ${counts.length} tables would be copied (add --apply)`);
    await pool.end();
    await src.close();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`truncate ${order.map((t) => `"${t}"`).join(', ')} cascade`);
    for (const t of order) {
      // json columns are sent as text: node-postgres would turn a JS array into a Postgres array
      const cols = (await client.query<{ c: string; type: string }>(`select column_name as c, data_type as type from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).rows;
      const json = new Set(cols.filter((c) => c.type === 'json' || c.type === 'jsonb').map((c) => c.c));
      const names = cols.map((c) => c.c);
      let done = 0;
      for (let offset = 0; ; offset += BATCH) {
        const rows = (await src.query<Record<string, unknown>>(`select ${names.map((n) => `"${n}"`).join(', ')} from "${t}" order by 1 limit ${BATCH} offset ${offset}`)).rows;
        if (!rows.length) break;
        const values: unknown[] = [];
        const tuples = rows.map((r, i) => `(${names.map((n, j) => {
          const v = r[n];
          values.push(v != null && json.has(n) ? JSON.stringify(v) : v);
          return `$${i * names.length + j + 1}`;
        }).join(', ')})`);
        await client.query(`insert into "${t}" (${names.map((n) => `"${n}"`).join(', ')}) values ${tuples.join(', ')}`, values);
        done += rows.length;
      }
      process.stdout.write(`${t}: ${done}\n`);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  let ok = true;
  for (const c of counts) {
    c.target = Number((await pool.query<{ n: string }>(`select count(*) as n from "${c.table}"`)).rows[0].n);
    if (c.target !== c.source) ok = false;
  }
  for (const c of counts) console.log(`${c.table.padEnd(22)} ${String(c.source).padStart(8)} → ${String(c.target).padStart(8)}${c.target === c.source ? '' : '  MISMATCH'}`);
  console.log(ok ? 'copied: every table matches' : 'MISMATCH: see above');
  await pool.end();
  await src.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
